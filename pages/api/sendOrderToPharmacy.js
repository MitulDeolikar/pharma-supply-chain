import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { recordRequestOnBlockchain, verifyRequestIntegrity, recordTamperingIncident } = require('./blockchainHelper');
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, invalidatePattern, publish } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { requestId, acceptingPharmacyId, acceptingWarehouseId } = req.body;

    if (!requestId || (!acceptingPharmacyId && !acceptingWarehouseId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Request ID and either Accepting Pharmacy ID or Accepting Warehouse ID are required' 
      });
    }

    const isWarehouse = !!acceptingWarehouseId;
    const acceptingEntityId = isWarehouse ? acceptingWarehouseId : acceptingPharmacyId;

    const connection = await mysql.createConnection(dbConfig);

    // Start transaction
    await connection.beginTransaction();

    try {
      // First, verify that the request exists and is in pending_approval_from_cmo status
      const [requestCheck] = await connection.execute(`
        SELECT request_id, pharmacy_id, status, remarks 
        FROM pharmacy_emergency_requests 
        WHERE request_id = ? AND status = 'pending_approval_from_cmo'
      `, [requestId]);

      if (requestCheck.length === 0) {
        await connection.rollback();
        await connection.end();
        return res.status(400).json({ 
          success: false, 
          message: 'Request not found or not in valid status for sending order' 
        });
      }

      // Verify that the accepting pharmacy/warehouse exists
      let entityCheck, entityName, entityContactNumber;
      if (isWarehouse) {
        [entityCheck] = await connection.execute(`
          SELECT warehouse_id, name, contact_number 
          FROM warehouse 
          WHERE warehouse_id = ?
        `, [acceptingWarehouseId]);
        if (entityCheck.length > 0) {
          entityName = entityCheck[0].name;
          entityContactNumber = entityCheck[0].contact_number;
        }
      } else {
        [entityCheck] = await connection.execute(`
          SELECT pharmacy_id, username, pharmacy_name, contact_number 
          FROM pharmacy 
          WHERE pharmacy_id = ?
        `, [acceptingPharmacyId]);
        if (entityCheck.length > 0) {
          entityName = entityCheck[0].pharmacy_name || entityCheck[0].username;
          entityContactNumber = entityCheck[0].contact_number;
        }
      }

      if (entityCheck.length === 0) {
        await connection.rollback();
        await connection.end();
        return res.status(400).json({ 
          success: false, 
          message: `Accepting ${isWarehouse ? 'warehouse' : 'pharmacy'} not found` 
        });
      }

      const originPharmacyId = requestCheck[0].pharmacy_id;
      const originalRemarks = requestCheck[0].remarks || '';

      // Fetch medicine items for blockchain verification and recording
      const [medicineItems] = await connection.execute(
        'SELECT medicine_id, generic_id, quantity_requested FROM pharmacy_emergency_request_items WHERE request_id = ?',
        [requestId]
      );

      const requestIdNum = parseInt(requestId, 10);

      const normalizedMedicines = medicineItems.map(m => ({
        medicine_id: m.medicine_id ? Number(m.medicine_id) : null,
        generic_id: m.generic_id ? Number(m.generic_id) : null,
        quantity_requested: Number(m.quantity_requested)
      }));

      // 🔐 SECURITY: Verify blockchain integrity before approving
      console.log(`🔒 Running integrity verification for request #${requestId}...`);
      const verificationResult = await verifyRequestIntegrity(requestIdNum, {
        requestId: requestIdNum,
        pharmacyId: originPharmacyId,
        status: 'order_sent',  // NEW status we're transitioning to (not the old status)
        medicines: normalizedMedicines,
        remarks: originalRemarks,
        actorId: originPharmacyId,
        acceptingPharmacyId: null,
        acceptingWarehouseId: null,
        acceptingEntityType: null
      }, connection);  // Pass connection for DB metadata lookup

      // Block transaction only if tampering is definitively detected
      // Allow if: verification skipped (blockchain unavailable), not found (first record), or valid
      if (verificationResult.isValid === false && !verificationResult.skipped && !verificationResult.notFound && verificationResult.error == null) {
        await connection.rollback();
        await connection.end();
        console.error(`🚨 SECURITY ALERT: Request #${requestId} failed integrity verification!`);
        console.error(`   ${verificationResult.message}`);
        
        // Log tampering incident
        try {
          await recordTamperingIncident(requestIdNum, verificationResult, connection);
        } catch (logErr) {
          console.error('Failed to log tampering incident:', logErr.message);
        }
        
        return res.status(403).json({
          success: false,
          message: verificationResult.message || '🚨 Data integrity check failed - possible tampering detected. This request has been flagged for investigation.',
          securityAlert: true,
          verificationFailure: true
        });
      }

      if (verificationResult.skipped || verificationResult.notFound) {
        console.log(`⚠️ Request #${requestId}: ${verificationResult.message} - proceeding anyway`);
      } else if (verificationResult.isValid) {
        console.log(`✅ Request #${requestId}: Data integrity verified - ${verificationResult.message}`);
      } else {
        console.warn(`⚠️ Request #${requestId}: Verification error (non-blocking) - ${verificationResult.message}`);
      }
      // Prepare new remarks for blockchain recording
      const newRemarks = `Order sent to ${isWarehouse ? 'warehouse' : 'pharmacy'} ${acceptingEntityId} (${entityName})`;

      const updateQuery = isWarehouse 
        ? `UPDATE pharmacy_emergency_requests 
           SET accepting_warehouse_id = ?, status = 'order_sent', remarks = ?
           WHERE request_id = ?`
        : `UPDATE pharmacy_emergency_requests 
           SET accepting_pharmacy_id = ?, status = 'order_sent', remarks = ?
           WHERE request_id = ?`;

      const [updateResult] = await connection.execute(updateQuery, [acceptingEntityId, newRemarks, requestId]);

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        await connection.end();
        return res.status(400).json({ 
          success: false, 
          message: 'Failed to update emergency request' 
        });
      }

      await connection.commit();

      // 🔗 BLOCKCHAIN: Record order sent with warehouse/pharmacy details
      const blockchainResult = await recordRequestOnBlockchain({
          requestId: requestIdNum,
          pharmacyId: originPharmacyId,
          status: 'order_sent',
          medicines: normalizedMedicines,
          remarks: newRemarks,  // Use the same remarks we stored in DB
          actorId: originPharmacyId, // CMO or system
          acceptingPharmacyId: isWarehouse ? null : acceptingPharmacyId,
          acceptingWarehouseId: isWarehouse ? acceptingWarehouseId : null,
          acceptingEntityType: isWarehouse ? 'warehouse' : 'pharmacy'
      });

      // Store blockchain metadata in DB BEFORE sending response
      if (blockchainResult.success) {
          try {
              const blockchainConnection = await mysql.createConnection(dbConfig);
              await blockchainConnection.execute(`
                  UPDATE pharmacy_emergency_requests 
                  SET blockchain_timestamp = ?, blockchain_txhash = ?
                  WHERE request_id = ?
              `, [blockchainResult.timestamp, blockchainResult.txHash, requestId]);
              console.log(`💾 Stored blockchain metadata for request #${requestId} approval`);
              await blockchainConnection.end();
          } catch (dbErr) {
              console.error('⚠️ Failed to store blockchain metadata:', dbErr.message);
              // Non-blocking - don't fail the response
          }
      }

      // fetch originating pharmacy name and total items for SMS (use new connection after commit)
      const smsConnection = await mysql.createConnection(dbConfig);
      const [originRows] = await smsConnection.execute('SELECT pharmacy_name FROM pharmacy WHERE pharmacy_id = ?', [originPharmacyId]);
      const originName = (originRows && originRows[0] && originRows[0].pharmacy_name) || `Pharmacy ${originPharmacyId}`;
      const [itemsRows] = await smsConnection.execute('SELECT SUM(quantity_requested) as total_items FROM pharmacy_emergency_request_items WHERE request_id = ?', [requestId]);
      const totalItems = (itemsRows && itemsRows[0] && itemsRows[0].total_items) || 0;

        // Send SMS to accepting pharmacy/warehouse (best-effort) informing them of approved request
        try {
          const toNumber = entityContactNumber;
          const accountSid = process.env.TWILIO_ACCOUNT_SID;
          const authToken = process.env.TWILIO_AUTH_TOKEN;
          const fromNumber = process.env.TWILIO_FROM_NUMBER;

          if (toNumber && accountSid && authToken && fromNumber) {
            let mobile = (toNumber || '').toString().replace(/[^0-9]/g, '');
            if (mobile.length === 10) mobile = '91' + mobile;
            if (!mobile.startsWith('+')) mobile = '+' + mobile;

            const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
            const body = `Emergency request #${requestId} of ${totalItems} item(s) from ${originName} has been approved by CMO and assigned to your ${isWarehouse ? 'warehouse' : 'pharmacy'} (${entityName}). Please prepare the stock.`;
            const payload = new URLSearchParams({ To: mobile, From: fromNumber, Body: body });

            let resp;
            if (typeof fetch === 'function') {
              resp = await fetch(url, {
                method: 'POST',
                headers: {
                  Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: payload
              });
            } else {
              const nodeFetch = await import('node-fetch');
              resp = await nodeFetch.default(url, {
                method: 'POST',
                headers: {
                  Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: payload
              });
            }
            const text = await resp.text();
            if (!resp.ok) console.error(`Twilio error sending to accepting ${isWarehouse ? 'warehouse' : 'pharmacy'}:`, resp.status, text);
            else console.log(`Twilio sent to accepting ${isWarehouse ? 'warehouse' : 'pharmacy'}:`, text);
          } else {
            console.warn(`Missing accepting ${isWarehouse ? 'warehouse' : 'pharmacy'} contact or Twilio creds; skipping SMS`);
          }
      } catch (smsErr) {
        console.error(`Error sending SMS to accepting ${isWarehouse ? 'warehouse' : 'pharmacy'}:`, smsErr);
      } finally {
        await smsConnection.end();
      }

      invalidate('emergency_requests:all');
      invalidatePattern('analytics:cmo:*');
      publish('pharma:events', { type: 'emergency:approved', request_id: requestId, pharmacy_id: originPharmacyId, accepting_pharmacy_id: isWarehouse ? null : acceptingPharmacyId, accepting_warehouse_id: isWarehouse ? acceptingWarehouseId : null });

      logActivity({
        actor_type: 'cmo', actor_id: 1, actor_name: 'CMO',
        action: 'EMERGENCY_REQUEST_APPROVED', entity_type: 'emergency_request', entity_id: requestId,
        description: `CMO approved emergency request #${requestId} → assigned to ${isWarehouse ? 'Warehouse' : 'Pharmacy'}: ${entityName}`,
        metadata: { assigned_to: entityName, is_warehouse: isWarehouse }
      }).catch(() => {});

      res.status(200).json({
          success: true,
          message: `Order successfully sent to ${entityName}`,
          data: {
            requestId,
            acceptingPharmacyId: isWarehouse ? null : acceptingPharmacyId,
            acceptingPharmacyName: isWarehouse ? null : entityName,
            acceptingWarehouseId: isWarehouse ? acceptingWarehouseId : null,
            acceptingWarehouseName: isWarehouse ? entityName : null,
            status: 'order_sent'
          }
        });

    } catch (transactionError) {
      await connection.rollback();
      await connection.end();
      throw transactionError;
    }

  } catch (error) {
    console.error('Error sending order to pharmacy:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while sending order'
    });
  }
}