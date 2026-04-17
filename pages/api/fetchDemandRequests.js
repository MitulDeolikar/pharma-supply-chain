import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { pharmacy_id } = req.query;

  if (!pharmacy_id) {
    return res.status(400).json({ 
      success: false, 
      message: 'Pharmacy ID is required' 
    });
  }

  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);

    // Fetch demand requests with their items
    const [requests] = await connection.execute(`
      SELECT 
        dr.request_id,
        dr.pharmacy_id,
        dr.remarks,
        dr.status,
        dr.request_date,
        dr.comments_from_approver,
        COUNT(dri.request_item_id) as items_count,
        SUM(dri.quantity_requested) as total_quantity
      FROM pharmacy_demand_request dr
      LEFT JOIN pharmacy_demand_request_items dri ON dr.request_id = dri.request_id
      WHERE dr.pharmacy_id = ?
      GROUP BY dr.request_id
      ORDER BY dr.request_date DESC
    `, [pharmacy_id]);

    // Fetch detailed items for each request
    const requestsWithItems = await Promise.all(
      requests.map(async (request) => {
        const [items] = await connection.execute(`
          SELECT 
            dri.request_item_id,
            dri.request_id,
            dri.medicine_id,
            dri.quantity_requested,
            m.name as medicine_name,
            m.dosage,
            m.unit
          FROM pharmacy_demand_request_items dri
          LEFT JOIN medicines m ON dri.medicine_id = m.medicine_id
          WHERE dri.request_id = ?
          ORDER BY m.name
        `, [request.request_id]);

        return {
          ...request,
          items
        };
      })
    );

    res.status(200).json({
      success: true,
      requests: requestsWithItems
    });

  } catch (error) {
    console.error('Error fetching demand requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch demand requests',
      error: error.message
    });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}