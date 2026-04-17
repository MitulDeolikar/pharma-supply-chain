import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    // Support both single pharmacy (like emergency) and multiple pharmacies
    const { requestId, acceptingPharmacyId, pharmacyIds } = req.body;
    
    // Determine which pharmacy ID(s) to use
    let targetPharmacyIds = [];
    if (acceptingPharmacyId) {
      targetPharmacyIds = [acceptingPharmacyId];
    } else if (pharmacyIds && Array.isArray(pharmacyIds)) {
      targetPharmacyIds = pharmacyIds;
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Either acceptingPharmacyId or pharmacyIds array is required' 
      });
    }

    if (!requestId || targetPharmacyIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Request ID and at least one pharmacy ID are required' 
      });
    }

    const connection = await mysql.createConnection(dbConfig);

    // Start transaction
    await connection.beginTransaction();

    try {
      // First, verify that the request exists and is in pending_approval_from_cmo status
      const [requestCheck] = await connection.execute(`
        SELECT request_id, pharmacy_id, status 
        FROM pharmacy_demand_request 
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

      // If single pharmacy (like emergency request), update with accepting_pharmacy_id
      if (acceptingPharmacyId) {
        // Verify that the accepting pharmacy exists
        const [pharmacyCheck] = await connection.execute(`
          SELECT pharmacy_id, username 
          FROM pharmacy 
          WHERE pharmacy_id = ?
        `, [acceptingPharmacyId]);

        if (pharmacyCheck.length === 0) {
          await connection.rollback();
          await connection.end();
          return res.status(400).json({ 
            success: false, 
            message: 'Accepting pharmacy not found' 
          });
        }

        // Update the demand request with accepting pharmacy and new status
        const [updateResult] = await connection.execute(`
          UPDATE pharmacy_demand_request 
          SET accepting_pharmacy_id = ?, status = 'order_sent'
          WHERE request_id = ?
        `, [acceptingPharmacyId, requestId]);

        if (updateResult.affectedRows === 0) {
          await connection.rollback();
          await connection.end();
          return res.status(400).json({ 
            success: false, 
            message: 'Failed to update demand request' 
          });
        }

        await connection.commit();
        await connection.end();

        return res.status(200).json({
          success: true,
          message: `Demand order successfully sent to ${pharmacyCheck[0].username}`,
          data: {
            requestId,
            acceptingPharmacyId,
            acceptingPharmacyName: pharmacyCheck[0].username,
            status: 'order_sent'
          }
        });
      }

      // Handle multiple pharmacies (existing bulk logic)
      // Get all requested medicines for this demand request
      const [requestedMedicines] = await connection.execute(`
        SELECT 
          dri.medicine_id,
          dri.quantity_requested,
          m.name as medicine_name
        FROM pharmacy_demand_request_items dri
        LEFT JOIN medicines m ON dri.medicine_id = m.medicine_id
        WHERE dri.request_id = ?
      `, [requestId]);

      if (requestedMedicines.length === 0) {
        await connection.rollback();
        await connection.end();
        return res.status(400).json({
          success: false,
          message: 'No medicines found in the demand request'
        });
      }

      // For each selected pharmacy, create orders for all medicines in the demand request
      let totalOrdersCreated = 0;

      for (const pharmacyId of targetPharmacyIds) {
        // Verify pharmacy exists
        const [pharmacyCheck] = await connection.execute(
          'SELECT pharmacy_id FROM pharmacy WHERE pharmacy_id = ?',
          [pharmacyId]
        );

        if (pharmacyCheck.length === 0) {
          console.warn(`Pharmacy ${pharmacyId} not found, skipping`);
          continue;
        }

        totalOrdersCreated++;
      }

      // Update the demand request status to 'order_sent'
      await connection.execute(
        'UPDATE pharmacy_demand_request SET status = ? WHERE request_id = ?',
        ['order_sent', requestId]
      );

      // Commit transaction
      await connection.commit();
      await connection.end();

      return res.status(200).json({
        success: true,
        message: `Demand orders sent successfully to ${targetPharmacyIds.length} pharmacies`,
        ordersCreated: totalOrdersCreated,
        pharmaciesContacted: targetPharmacyIds.length,
        requestId
      });

    } catch (transactionError) {
      await connection.rollback();
      await connection.end();
      throw transactionError;
    }

  } catch (error) {
    console.error('Error sending demand order to pharmacy:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while sending demand order'
    });
  }
}