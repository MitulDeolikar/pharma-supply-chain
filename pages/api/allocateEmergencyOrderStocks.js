import mysql from "mysql2/promise";
import dbConfig from "../../middleware/dbConfig";
const { recordRequestOnBlockchain, verifyRequestIntegrity } = require('./blockchainHelper');
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, invalidatePattern, publish } = require('../../lib/cache');

// POST /api/allocateEmergencyOrderStocks
// Body: { 
//   pharmacy_id: number, 
//   request_id: number, 
//   allocations: [{
//     request_item_index: number,  // Index in original request
//     medicine_allocations: [{      // Can have multiple medicines for one request item
//       medicine_id: number,
//       quantity: number
//     }]
//   }]
// }
// Supports generic medicine allocation with quantity distribution across alternatives

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const { pharmacy_id, request_id, allocations } = req.body || {};
  if (!pharmacy_id || !request_id || !Array.isArray(allocations) || allocations.length === 0) {
    return res.status(400).json({ success: false, message: "Missing pharmacy_id, request_id or allocations in request body" });
  }

  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
    await connection.beginTransaction();

    // First verify that this is a valid emergency request and pharmacy can fulfill it
    const [requestCheck] = await connection.execute(
      `SELECT request_id, pharmacy_id, accepting_pharmacy_id, accepting_warehouse_id, status, remarks
       FROM pharmacy_emergency_requests 
       WHERE request_id = ? AND accepting_pharmacy_id = ? AND status = 'order_sent'`,
      [request_id, pharmacy_id]
    );

    if (requestCheck.length === 0) {
      await connection.rollback();
      await connection.end();
      return res.status(400).json({ 
        success: false, 
        message: "Emergency request not found, not assigned to this pharmacy, or not in valid status" 
      });
    }

    // 🔐 BLOCKCHAIN VERIFICATION: Check data integrity BEFORE allocating stocks
    console.log(`🔒 Running integrity verification for request #${request_id} before stock allocation...`);
    
    const requestInfo = requestCheck[0];
    const originPharmacyId = requestInfo.pharmacy_id;
    const acceptingPharmacyId = requestInfo.accepting_pharmacy_id || null;
    const acceptingWarehouseId = requestInfo.accepting_warehouse_id || null;
    const acceptingEntityType = acceptingWarehouseId ? 'warehouse' : 'pharmacy';
    const originalRemarks = requestInfo.remarks || '';

    // Fetch medicine items for verification
    const [medicineItems] = await connection.execute(
      'SELECT medicine_id, generic_id, quantity_requested FROM pharmacy_emergency_request_items WHERE request_id = ?',
      [request_id]
    );

    const requestIdNum = parseInt(request_id, 10);
    const normalizedMedicines = medicineItems.map(m => ({
      medicine_id: m.medicine_id ? Number(m.medicine_id) : null,
      generic_id: m.generic_id ? Number(m.generic_id) : null,
      quantity_requested: Number(m.quantity_requested)
    }));

    // Verify integrity against blockchain before proceeding
    // Pass the NEW status we're transitioning to (like sendOrderToPharmacy does)
    const verificationResult = await verifyRequestIntegrity(requestIdNum, {
      requestId: requestIdNum,
      pharmacyId: originPharmacyId,  // Original requesting pharmacy
      status: 'order_successful',     // NEW status we're transitioning to
      medicines: normalizedMedicines,
      remarks: originalRemarks,
      actorId: originPharmacyId,
      acceptingPharmacyId: acceptingPharmacyId,
      acceptingWarehouseId: acceptingWarehouseId,
      acceptingEntityType: acceptingEntityType
    }, connection);

    // Block if tampering is definitively detected
    if (verificationResult.isValid === false && !verificationResult.skipped && !verificationResult.notFound && verificationResult.error == null) {
      await connection.rollback();
      await connection.end();
      console.error(`🚨 SECURITY ALERT: Request #${request_id} failed integrity verification before allocation!`);
      console.error(`   ${verificationResult.message}`);
      
      return res.status(403).json({
        success: false,
        message: verificationResult.message || '🚨 Data integrity check failed - possible tampering detected. Stock allocation blocked.',
        securityAlert: true,
        verificationFailure: true
      });
    }

    if (verificationResult.skipped || verificationResult.notFound) {
      console.log(`⚠️ Request #${request_id}: ${verificationResult.message} - proceeding with allocation`);
    } else if (verificationResult.isValid) {
      console.log(`✅ Request #${request_id}: Data integrity verified before allocation - ${verificationResult.message}`);
    } else {
      console.warn(`⚠️ Request #${request_id}: Verification error (non-blocking) - proceeding with allocation`);
    }

    const allocationResults = {};
    const shortages = [];

    // First pass: check availability for ALL medicine allocations
    for (const allocation of allocations) {
      const { medicine_allocations } = allocation;
      
      for (const medAlloc of medicine_allocations) {
        const { medicine_id, quantity } = medAlloc;
        const needed = Number(quantity || 0);
        
        if (!medicine_id || needed <= 0) continue;

        const [rows] = await connection.execute(
          `SELECT stock_id, quantity, batch_number, expiry_date, price_per_unit
           FROM stock
           WHERE pharmacy_id = ? AND medicine_id = ? AND quantity > 0 AND expiry_date > NOW()
           ORDER BY expiry_date ASC`,
          [pharmacy_id, medicine_id]
        );

        const totalAvailable = rows.reduce((s, r) => s + parseFloat(r.quantity || 0), 0);
        if (totalAvailable < needed) {
          shortages.push({ 
            medicine_id, 
            needed, 
            available: totalAvailable
          });
        }
        
        // Store for second pass
        if (!allocationResults[medicine_id]) {
          allocationResults[medicine_id] = { rows, allocations: [] };
        }
      }
    }

    if (shortages.length > 0) {
      await connection.rollback();
      await connection.end();
      return res.status(400).json({
        success: false,
        message: "Insufficient stock for one or more medicines",
        shortages,
      });
    }

    // Second pass: perform allocations using FEFO
    const allMedicineAllocations = [];
    
    for (const allocation of allocations) {
      const { medicine_allocations } = allocation;
      
      for (const medAlloc of medicine_allocations) {
        const { medicine_id, quantity } = medAlloc;
        allMedicineAllocations.push({ medicine_id, quantity: Number(quantity || 0) });
      }
    }

    for (const medAlloc of allMedicineAllocations) {
      const { medicine_id, quantity } = medAlloc;
      let remaining = quantity;

      const [rows] = await connection.execute(
        `SELECT stock_id, quantity, batch_number, expiry_date, price_per_unit
         FROM stock
         WHERE pharmacy_id = ? AND medicine_id = ? AND quantity > 0 AND expiry_date > NOW()
         ORDER BY expiry_date ASC`,
        [pharmacy_id, medicine_id]
      );

      for (const row of rows) {
        if (remaining <= 0) break;
        const available = parseFloat(row.quantity || 0);
        if (available <= 0) continue;

        const allocateQty = Math.min(available, remaining);
        const newQty = parseFloat((available - allocateQty).toFixed(2));

        // Update DB
        await connection.execute(
          `UPDATE stock SET quantity = ? WHERE stock_id = ?`,
          [newQty, row.stock_id]
        );

        // Record which batch was used so requesting pharmacy gets exact same batch on receipt
        await connection.execute(
          `INSERT INTO request_dispatch_items
            (request_id, request_type, medicine_id, batch_number, quantity, price_per_unit, expiry_date, source_pharmacy_id)
           VALUES (?, 'emergency', ?, ?, ?, ?, ?, ?)`,
          [request_id, medicine_id, row.batch_number, allocateQty, row.price_per_unit, row.expiry_date, pharmacy_id]
        );

        // Record allocation detail
        if (!allocationResults[medicine_id]) {
          allocationResults[medicine_id] = { allocations: [] };
        }
        allocationResults[medicine_id].allocations.push({
          stock_id: row.stock_id,
          batch_number: row.batch_number,
          expiry_date: row.expiry_date,
          price_per_unit: row.price_per_unit,
          allocated: allocateQty,
          previous_quantity: available,
          new_quantity: newQty,
        });

        remaining -= allocateQty;
      }

      // Sanity check
      if (remaining > 0) {
        await connection.rollback();
        await connection.end();
        return res.status(500).json({ 
          success: false, 
          message: `Allocation failed for medicine ${medicine_id}` 
        });
      }

      // Log sales history with sale_type = 'emergency'
      await connection.execute(
        `INSERT INTO pharmacy_sales_history (pharmacy_id, medicine_id, quantity_sold, transaction_date, sale_type) 
         VALUES (?, ?, ?, CURDATE(), 'emergency')`,
        [pharmacy_id, medicine_id, quantity]
      );
    }

    // Update the emergency request status to order_successful
    await connection.execute(
      `UPDATE pharmacy_emergency_requests SET status = 'order_successful' WHERE request_id = ?`,
      [request_id]
    );

    // Commit the transaction
    await connection.commit();

    // 🔗 BLOCKCHAIN: Record order successful with allocation details
    const blockchainResult = await recordRequestOnBlockchain({
        requestId: requestIdNum,
        pharmacyId: originPharmacyId,
        status: 'order_successful',
        medicines: normalizedMedicines,
        remarks: `Order successfully fulfilled by ${acceptingEntityType === 'warehouse' ? 'warehouse' : 'pharmacy'} ${acceptingPharmacyId || acceptingWarehouseId}. Stocks allocated.`,
        actorId: pharmacy_id,  // Fulfilling pharmacy/warehouse is the actor
        acceptingPharmacyId: acceptingPharmacyId,
        acceptingWarehouseId: acceptingWarehouseId,
        acceptingEntityType: acceptingEntityType
    });

    // Store blockchain metadata in DB BEFORE sending response
    if (blockchainResult.success) {
        try {
            const blockchainConnection = await mysql.createConnection(dbConfig);
            await blockchainConnection.execute(`
                UPDATE pharmacy_emergency_requests 
                SET blockchain_timestamp = ?, blockchain_txhash = ?
                WHERE request_id = ?
            `, [blockchainResult.timestamp, blockchainResult.txHash, request_id]);
            console.log(`💾 Stored blockchain metadata for request #${request_id} order_successful`);
            await blockchainConnection.end();
        } catch (dbErr) {
            console.error('⚠️ Failed to store blockchain metadata:', dbErr.message);
            // Non-blocking - don't fail the response
        }
    }

    await connection.end();

    // Invalidate: supplier pharmacy stock (deducted), emergency list, sales analytics, CMO analytics
    invalidate(`stock:${pharmacy_id}`, `sales:${pharmacy_id}`, 'emergency_requests:all');
    invalidatePattern('analytics:cmo:*');
    publish('pharma:events', { type: 'emergency:allocated', request_id, pharmacy_id: originPharmacyId, accepting_pharmacy_id: acceptingPharmacyId, accepting_warehouse_id: acceptingWarehouseId });

    // Fetch medicine names for audit metadata
    const emMedIds = Object.keys(allocationResults).filter(k => allocationResults[k].allocations?.length > 0);
    let emMedNameMap = {};
    if (emMedIds.length > 0) {
      try {
        const medConn = await mysql.createConnection(dbConfig);
        const [medRows] = await medConn.execute(
          `SELECT medicine_id, name, dosage FROM medicines WHERE medicine_id IN (${emMedIds.map(() => '?').join(',')})`,
          emMedIds
        );
        medRows.forEach(r => { emMedNameMap[r.medicine_id] = `${r.name}${r.dosage ? ' ' + r.dosage : ''}`; });
        await medConn.end();
      } catch (_) {}
    }

    const emAllocSummary = emMedIds.map(medId => ({
      medicine_id: Number(medId),
      medicine_name: emMedNameMap[medId] || `Medicine #${medId}`,
      batches: (allocationResults[medId].allocations || []).map(a => ({
        batch_number: a.batch_number,
        quantity: a.allocated,
        expiry_date: a.expiry_date,
      })),
    }));

    logActivity({
      actor_type: 'pharmacy', actor_id: pharmacy_id, actor_name: `Pharmacy #${pharmacy_id}`,
      action: 'STOCK_ALLOCATED_EMERGENCY', entity_type: 'emergency_request', entity_id: request_id,
      description: `Pharmacy #${pharmacy_id} allocated and dispatched stock for emergency request #${request_id}`,
      metadata: { medicines_count: emMedIds.length, allocations: emAllocSummary }
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "Emergency order allocation successful",
      allocations: allocationResults
    });

  } catch (error) {
    console.error("Error allocating emergency order stocks:", error);
    try {
      if (connection) {
        await connection.rollback();
      }
    } catch (e) {
      console.error("Rollback error:", e);
    }
    if (connection) {
      await connection.end();
    }
    return res.status(500).json({ 
      success: false, 
      message: "Internal Server Error", 
      error: error.message 
    });
  }
};

export default handler;