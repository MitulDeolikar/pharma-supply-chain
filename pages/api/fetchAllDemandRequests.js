import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const requests = await getOrSet('demand_requests:all', 300, async () => {
      const connection = await mysql.createConnection(dbConfig);
      try {
        const [rows] = await connection.execute(`
          SELECT
            dr.request_id,
            dr.pharmacy_id,
            dr.remarks,
            dr.status,
            dr.request_date,
            dr.comments_from_approver,
            dr.accepting_warehouse_id,
            p.pharmacy_name as pharmacy_name,
            p.address as pharmacy_address,
            COUNT(dri.request_item_id) as items_count,
            SUM(dri.quantity_requested) as total_quantity
          FROM pharmacy_demand_request dr
          LEFT JOIN pharmacy p ON dr.pharmacy_id = p.pharmacy_id
          LEFT JOIN pharmacy_demand_request_items dri ON dr.request_id = dri.request_id
          GROUP BY dr.request_id
          ORDER BY dr.request_date DESC
        `);

        const requestsWithMedicines = await Promise.all(
          rows.map(async (request) => {
            const [medicines] = await connection.execute(`
              SELECT
                dri.request_item_id,
                dri.medicine_id,
                dri.generic_id,
                dri.quantity_requested,
                COALESCE(m.name, g.generic_name) as medicine_name,
                g.generic_name,
                m.dosage,
                m.unit
              FROM pharmacy_demand_request_items dri
              LEFT JOIN medicines m ON dri.medicine_id = m.medicine_id
              LEFT JOIN generic_medicines g ON dri.generic_id = g.generic_id
              WHERE dri.request_id = ?
              ORDER BY COALESCE(m.name, g.generic_name)
            `, [request.request_id]);

            return {
              ...request,
              medicines: medicines.map(med => ({
                id: med.medicine_id,
                generic_id: med.generic_id,
                name: med.medicine_name,
                generic_name: med.generic_name,
                dosage: med.dosage,
                unit: med.unit,
                quantity_requested: med.quantity_requested
              }))
            };
          })
        );

        return requestsWithMedicines;
      } finally {
        await connection.end();
      }
    });

    res.status(200).json({ success: true, requests });

  } catch (error) {
    console.error('Error fetching demand requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch demand requests',
      error: error.message
    });
  }
}