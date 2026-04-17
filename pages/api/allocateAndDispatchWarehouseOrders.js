import mysql from "mysql2";
import dbConfig from "../../middleware/dbConfig";
const { recordRequestOnBlockchain, verifyRequestIntegrity } = require('./blockchainHelper');
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, invalidatePattern, publish } = require('../../lib/cache');

// POST /api/allocateAndDispatchWarehouseOrders
// Body: { 
//   warehouse_id: number,
//   dispatches: [{
//     request_id: number,
//     request_type: 'emergency' | 'demand',
//     allocations: [{
//       request_item_index: number,
//       medicine_allocations: [{
//         medicine_id: number,
//         quantity: number
//       }]
//     }]
//   }]
// }
// Allocates and dispatches multiple requests from warehouse stock

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const { warehouse_id, dispatches } = req.body || {};
  
  if (!warehouse_id || !Array.isArray(dispatches) || dispatches.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: "Missing warehouse_id or dispatches array" 
    });
  }

  const connection = mysql.createConnection(dbConfig);

  try {
    connection.connect();
    await connection.promise().beginTransaction();

    const results = [];
    const errors = [];

    for (const dispatch of dispatches) {
      const { request_id, request_type, allocations } = dispatch;

      if (!request_id || !request_type || !Array.isArray(allocations)) {
        errors.push({ 
          request_id, 
          error: "Invalid dispatch structure" 
        });
        continue;
      }

      try {
        // Verify request exists and is in valid status
        let requestCheck = [];
        let tableName = '';
        
        if (request_type === 'emergency') {
          [requestCheck] = await connection.promise().query(
            `SELECT request_id, accepting_warehouse_id, status 
             FROM pharmacy_emergency_requests 
             WHERE request_id = ? AND accepting_warehouse_id = ? AND status = 'order_sent'`,
            [request_id, warehouse_id]
          );
          tableName = 'pharmacy_emergency_requests';
        } else if (request_type === 'demand') {
          [requestCheck] = await connection.promise().query(
            `SELECT request_id, accepting_warehouse_id, status 
             FROM pharmacy_demand_request 
             WHERE request_id = ? AND accepting_warehouse_id = ? AND status = 'approved'`,
            [request_id, warehouse_id]
          );
          tableName = 'pharmacy_demand_request';
        } else {
          errors.push({ 
            request_id, 
            error: "Invalid request_type" 
          });
          continue;
        }

        if (requestCheck.length === 0) {
          errors.push({ 
            request_id, 
            error: "Request not found, not assigned to this warehouse, or not in valid status" 
          });
          continue;
        }

        // 🔐 BLOCKCHAIN VERIFICATION
        // SKIPPED FOR NOW
        /*
        const itemsTableName = request_type === 'emergency' 
          ? 'pharmacy_emergency_request_items' 
          : 'pharmacy_demand_request_items';
        
        const [medicineItems] = await connection.promise().query(
          `SELECT medicine_id, generic_id, quantity_requested FROM ${itemsTableName} WHERE request_id = ?`,
          [request_id]
        );

        const [requestInfo] = await connection.promise().query(
          `SELECT pharmacy_id, accepting_warehouse_id FROM ${tableName} WHERE request_id = ?`,
          [request_id]
        );
        
        const originPharmacyId = requestInfo[0]?.pharmacy_id || null;
        const acceptingWarehouseId = requestInfo[0]?.accepting_warehouse_id || warehouse_id;

        const verificationResult = await verifyRequestIntegrity(request_id, {
          requestId: request_id,
          pharmacyId: originPharmacyId,
          status: request_type === 'emergency' ? 'order_sent' : 'approved',
          medicines: medicineItems.map(m => ({
            medicine_id: m.medicine_id,
            generic_id: m.generic_id,
            quantity_requested: m.quantity_requested
          })),
          remarks: `${request_type === 'emergency' ? 'Emergency' : 'Demand'} order sent to warehouse ${acceptingWarehouseId}`,
          actorId: originPharmacyId,
          acceptingWarehouseId: acceptingWarehouseId,
          acceptingEntityType: 'warehouse'
        });

        if (!verificationResult.isValid && !verificationResult.skipped && !verificationResult.notFound) {
          errors.push({ 
            request_id, 
            error: verificationResult.message || 'Blockchain integrity check failed' 
          });
          continue;
        }

        console.log(`✅ Integrity check passed for ${request_type} request #${request_id}`);
        */

        // Get medicine items for blockchain recording later
        const itemsTableName = request_type === 'emergency' 
          ? 'pharmacy_emergency_request_items' 
          : 'pharmacy_demand_request_items';
        
        const [medicineItems] = await connection.promise().query(
          `SELECT medicine_id, generic_id, quantity_requested FROM ${itemsTableName} WHERE request_id = ?`,
          [request_id]
        );

        const [requestInfo] = await connection.promise().query(
          `SELECT pharmacy_id, accepting_warehouse_id FROM ${tableName} WHERE request_id = ?`,
          [request_id]
        );
        
        const originPharmacyId = requestInfo[0]?.pharmacy_id || null;

        // Collect all medicine allocations for this request
        const allMedicineAllocations = [];
        for (const allocation of allocations) {
          for (const medAlloc of allocation.medicine_allocations || []) {
            allMedicineAllocations.push({
              medicine_id: medAlloc.medicine_id,
              quantity: Number(medAlloc.quantity || 0)
            });
          }
        }

        // First pass: validate stock availability
        const shortages = [];
        for (const medAlloc of allMedicineAllocations) {
          const { medicine_id, quantity } = medAlloc;
          if (!medicine_id || quantity <= 0) continue;

          const [rows] = await connection.promise().query(
            `SELECT stock_id, quantity
             FROM stock
             WHERE warehouse_id = ? AND medicine_id = ? AND quantity > 0 AND expiry_date > NOW()`,
            [warehouse_id, medicine_id]
          );

          const totalAvailable = rows.reduce((s, r) => s + parseFloat(r.quantity || 0), 0);
          if (totalAvailable < quantity) {
            shortages.push({ 
              medicine_id, 
              needed: quantity, 
              available: totalAvailable 
            });
          }
        }

        if (shortages.length > 0) {
          errors.push({ 
            request_id, 
            error: "Insufficient stock", 
            shortages 
          });
          continue;
        }

        // Second pass: allocate using FEFO
        const allocationDetails = {};
        
        for (const medAlloc of allMedicineAllocations) {
          const { medicine_id, quantity } = medAlloc;
          let remaining = quantity;

          const [rows] = await connection.promise().query(
            `SELECT stock_id, quantity, batch_number, expiry_date, price_per_unit
             FROM stock
             WHERE warehouse_id = ? AND medicine_id = ? AND quantity > 0 AND expiry_date > NOW()
             ORDER BY expiry_date ASC`,
            [warehouse_id, medicine_id]
          );

          for (const row of rows) {
            if (remaining <= 0) break;
            const available = parseFloat(row.quantity || 0);
            if (available <= 0) continue;

            const allocateQty = Math.min(available, remaining);
            const newQty = parseFloat((available - allocateQty).toFixed(2));

            // Update stock
            await connection.promise().query(
              `UPDATE stock SET quantity = ? WHERE stock_id = ?`,
              [newQty, row.stock_id]
            );

            // Record which batch was used so requesting pharmacy gets exact same batch on receipt
            await connection.promise().query(
              `INSERT INTO request_dispatch_items
                (request_id, request_type, medicine_id, batch_number, quantity, price_per_unit, expiry_date, source_warehouse_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [request_id, request_type, medicine_id, row.batch_number, allocateQty, row.price_per_unit, row.expiry_date, warehouse_id]
            );

            // Record allocation detail
            if (!allocationDetails[medicine_id]) {
              allocationDetails[medicine_id] = { allocations: [] };
            }
            allocationDetails[medicine_id].allocations.push({
              stock_id: row.stock_id,
              batch_number: row.batch_number,
              expiry_date: row.expiry_date,
              price_per_unit: row.price_per_unit,
              allocated: allocateQty,
              previous_quantity: available,
              new_quantity: newQty
            });

            remaining -= allocateQty;
          }

          if (remaining > 0) {
            throw new Error(`Allocation failed for medicine ${medicine_id} in request ${request_id}`);
          }

          // Record warehouse sales history
          // Note: pharmacy_sales_history uses pharmacy_id, but warehouses dispatch to pharmacies
          // For warehouse dispatches, we record with NULL pharmacy_id or skip this insert
          // Commenting out for now as warehouse_id column doesn't exist
          /*
          await connection.promise().query(
            `INSERT INTO pharmacy_sales_history (pharmacy_id, medicine_id, quantity_sold, transaction_date, sale_type) 
             VALUES (?, ?, ?, CURDATE(), ?)`,
            [warehouse_id, medicine_id, quantity, request_type === 'emergency' ? 'emergency' : 'demand']
          );
          */
        }

        // Update request status
        await connection.promise().query(
          `UPDATE ${tableName} SET status = 'order_successful' WHERE request_id = ?`,
          [request_id]
        );

        // Record blockchain transaction for dispatch
        // SKIPPED FOR NOW
        /*
        await recordRequestOnBlockchain({
          requestId: request_id,
          pharmacyId: originPharmacyId,
          status: 'order_successful',
          medicines: medicineItems.map(m => ({
            medicine_id: m.medicine_id,
            generic_id: m.generic_id,
            quantity_requested: m.quantity_requested
          })),
          remarks: `${request_type === 'emergency' ? 'Emergency' : 'Demand'} order dispatched from warehouse ${warehouse_id}`,
          actorId: warehouse_id,
          acceptingWarehouseId: warehouse_id,
          acceptingEntityType: 'warehouse'
        });
        */

        results.push({
          request_id,
          request_type,
          status: 'success',
          allocations: allocationDetails
        });

      } catch (error) {
        console.error(`Error processing ${request_type} request #${request_id}:`, error);
        errors.push({ 
          request_id, 
          request_type,
          error: error.message 
        });
      }
    }

    // Commit if at least one succeeded
    if (results.length > 0) {
      await connection.promise().commit();

      // Build allocation summary per dispatched request
      const whAllocSummary = results.map(r => {
        const batches = [];
        if (r.allocations) {
          for (const medId of Object.keys(r.allocations)) {
            for (const a of (r.allocations[medId].allocations || [])) {
              batches.push({ medicine_id: Number(medId), batch_number: a.batch_number, quantity: a.allocated, expiry_date: a.expiry_date });
            }
          }
        }
        return { request_id: r.request_id, request_type: r.request_type, batches };
      });

      // Invalidate warehouse stock (deducted), request lists, and CMO analytics
      invalidate(`wh_stock:${warehouse_id}`, 'demand_requests:all', 'emergency_requests:all');
      invalidatePattern('analytics:cmo:*');
      publish('pharma:events', { type: 'warehouse:dispatched', warehouse_id, dispatched_count: results.length });

      logActivity({
        actor_type: 'warehouse', actor_id: warehouse_id, actor_name: `Warehouse #${warehouse_id}`,
        action: 'WAREHOUSE_ORDER_DISPATCHED', entity_type: 'warehouse_dispatch', entity_id: warehouse_id,
        description: `Warehouse #${warehouse_id} dispatched stock for ${results.length} request(s)`,
        metadata: { dispatched_requests: whAllocSummary }
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: `Successfully dispatched ${results.length} request(s)`,
        results,
        errors: errors.length > 0 ? errors : undefined
      });
    } else {
      await connection.promise().rollback();
      return res.status(400).json({
        success: false,
        message: "All dispatches failed",
        errors
      });
    }

  } catch (error) {
    console.error("Error in warehouse dispatch:", error);
    try {
      await connection.promise().rollback();
    } catch (e) {
      console.error("Rollback error:", e);
    }
    return res.status(500).json({ 
      success: false, 
      message: "Internal Server Error", 
      error: error.message 
    });
  } finally {
    connection.end();
  }
};

export default handler;
