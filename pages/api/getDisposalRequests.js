import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  let connection;
  try {
    const { pharmacy_id } = req.query;

    if (!pharmacy_id) {
      return res.status(400).json({
        success: false,
        message: 'pharmacy_id is required'
      });
    }

    connection = await mysql.createConnection(dbConfig);

    // Fetch disposal requests
    const [requests] = await connection.execute(
      `SELECT 
         pdr.request_id,
         pdr.pharmacy_id,
         pdr.remarks,
         pdr.status,
         pdr.disposal_token,
         pdr.evidence_img,
         pdr.request_date,
         COUNT(dsi.item_id) as item_count
       FROM pharmacy_disposal_request pdr
       LEFT JOIN disposal_stock_items dsi ON pdr.request_id = dsi.request_id
       WHERE pdr.pharmacy_id = ?
       GROUP BY pdr.request_id
       ORDER BY pdr.request_date DESC`,
      [pharmacy_id]
    );

    // For each request, fetch associated stock items
    const requestsWithItems = await Promise.all(
      requests.map(async (request) => {
        const [items] = await connection.execute(
          `SELECT 
             dsi.item_id,
             dsi.stock_id,
             s.medicine_id,
             s.batch_number,
             s.quantity,
             s.expiry_date,
             m.name as medicine_name,
             m.dosage,
             m.unit as unit_type
           FROM disposal_stock_items dsi
           JOIN stock s ON dsi.stock_id = s.stock_id
           JOIN medicines m ON s.medicine_id = m.medicine_id
           WHERE dsi.request_id = ?`,
          [request.request_id]
        );

        return {
          ...request,
          items: items.map(item => ({
            item_id: item.item_id,
            stock_id: item.stock_id,
            medicine_name: item.medicine_name,
            dosage: item.dosage,
            batch_number: item.batch_number,
            quantity: item.quantity,
            unit_type: item.unit_type,
            expiry_date: item.expiry_date
          }))
        };
      })
    );

    await connection.end();

    res.status(200).json({
      success: true,
      requests: requestsWithItems
    });

  } catch (error) {
    console.error('Error fetching disposal requests:', error);
    if (connection) await connection.end();
    res.status(500).json({
      success: false,
      message: 'Error fetching disposal requests',
      error: error.message
    });
  }
}
