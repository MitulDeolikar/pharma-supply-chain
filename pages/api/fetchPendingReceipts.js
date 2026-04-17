import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

// GET /api/fetchPendingReceipts?pharmacy_id=X
// Returns demand + emergency requests with status = 'order_successful' for the given pharmacy
// These are orders dispatched but not yet confirmed received by the pharmacy

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { pharmacy_id } = req.query;
  if (!pharmacy_id) {
    return res.status(400).json({ success: false, message: 'pharmacy_id is required' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    // Demand requests dispatched by warehouse, awaiting pharmacy confirmation
    const [demandRequests] = await connection.execute(`
      SELECT
        dr.request_id,
        dr.pharmacy_id,
        dr.remarks,
        dr.status,
        dr.request_date,
        dr.accepting_warehouse_id,
        w.name AS warehouse_name
      FROM pharmacy_demand_request dr
      LEFT JOIN warehouse w ON dr.accepting_warehouse_id = w.warehouse_id
      WHERE dr.pharmacy_id = ? AND dr.status = 'order_successful'
      ORDER BY dr.request_date DESC
    `, [pharmacy_id]);

    // Fetch items for each demand request
    const demandWithItems = await Promise.all(
      demandRequests.map(async (req) => {
        // Original requested items
        const [items] = await connection.execute(`
          SELECT
            dri.request_item_id,
            dri.medicine_id,
            dri.quantity_requested,
            m.name AS medicine_name,
            m.dosage,
            m.unit
          FROM pharmacy_demand_request_items dri
          LEFT JOIN medicines m ON dri.medicine_id = m.medicine_id
          WHERE dri.request_id = ?
          ORDER BY m.name
        `, [req.request_id]);

        // Actual dispatched items (what warehouse really sent, may include alternatives)
        const [dispatched_items] = await connection.execute(`
          SELECT
            rdi.medicine_id,
            rdi.batch_number,
            rdi.quantity,
            rdi.price_per_unit,
            rdi.expiry_date,
            m.name AS medicine_name,
            m.dosage,
            m.unit
          FROM request_dispatch_items rdi
          LEFT JOIN medicines m ON rdi.medicine_id = m.medicine_id
          WHERE rdi.request_id = ? AND rdi.request_type = 'demand'
          ORDER BY m.name, rdi.batch_number
        `, [req.request_id]);

        return { ...req, request_type: 'demand', items, dispatched_items };
      })
    );

    // Emergency requests fulfilled by either a pharmacy or a warehouse, awaiting receipt confirmation
    const [emergencyRequests] = await connection.execute(`
      SELECT
        er.request_id,
        er.pharmacy_id,
        er.remarks,
        er.status,
        er.request_date,
        er.accepting_pharmacy_id,
        er.accepting_warehouse_id,
        p.pharmacy_name  AS accepting_pharmacy_name,
        w.name           AS accepting_warehouse_name
      FROM pharmacy_emergency_requests er
      LEFT JOIN pharmacy  p ON er.accepting_pharmacy_id  = p.pharmacy_id
      LEFT JOIN warehouse w ON er.accepting_warehouse_id = w.warehouse_id
      WHERE er.pharmacy_id = ? AND er.status = 'order_successful'
      ORDER BY er.request_date DESC
    `, [pharmacy_id]);

    // Fetch items for each emergency request
    const emergencyWithItems = await Promise.all(
      emergencyRequests.map(async (req) => {
        // Original requested items (what the pharmacy asked for)
        const [items] = await connection.execute(`
          SELECT
            peri.request_item_id,
            peri.medicine_id,
            peri.generic_id,
            peri.quantity_requested,
            COALESCE(m.name, gm.generic_name) AS medicine_name,
            m.dosage,
            m.unit
          FROM pharmacy_emergency_request_items peri
          LEFT JOIN medicines m ON peri.medicine_id = m.medicine_id
          LEFT JOIN generic_medicines gm ON peri.generic_id = gm.generic_id
          WHERE peri.request_id = ?
          ORDER BY medicine_name
        `, [req.request_id]);

        // Actual dispatched items (what was really sent — may be alternatives)
        const [dispatched_items] = await connection.execute(`
          SELECT
            rdi.medicine_id,
            rdi.batch_number,
            rdi.quantity,
            rdi.price_per_unit,
            rdi.expiry_date,
            m.name AS medicine_name,
            m.dosage,
            m.unit
          FROM request_dispatch_items rdi
          LEFT JOIN medicines m ON rdi.medicine_id = m.medicine_id
          WHERE rdi.request_id = ? AND rdi.request_type = 'emergency'
          ORDER BY m.name, rdi.batch_number
        `, [req.request_id]);

        return { ...req, request_type: 'emergency', items, dispatched_items };
      })
    );

    return res.status(200).json({
      success: true,
      demand: demandWithItems,
      emergency: emergencyWithItems,
    });

  } catch (error) {
    console.error('Error fetching pending receipts:', error);
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  } finally {
    if (connection) await connection.end();
  }
}
