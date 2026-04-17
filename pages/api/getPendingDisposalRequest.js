import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { pharmacy_id } = req.query;

    if (!pharmacy_id) {
      return res.status(400).json({ success: false, message: 'Pharmacy ID is required' });
    }

    const connection = await mysql.createConnection(dbConfig);

    // Fetch current pending disposal request with items
    const pendingQuery = `
      SELECT 
        pdr.request_id,
        pdr.pharmacy_id,
        pdr.disposal_token,
        pdr.remarks,
        pdr.status,
        pdr.request_date,
        COUNT(dsi.item_id) as item_count,
        GROUP_CONCAT(
          JSON_OBJECT(
            'stock_id', dsi.stock_id,
            'medicine_id', s.medicine_id,
            'medicine_name', m.name,
            'dosage', m.dosage,
            'batch_number', s.batch_number,
            'quantity', s.quantity,
            'unit_type', m.unit,
            'expiry_date', s.expiry_date
          )
        ) as items
      FROM pharmacy_disposal_request pdr
      LEFT JOIN disposal_stock_items dsi ON pdr.request_id = dsi.request_id
      LEFT JOIN stock s ON dsi.stock_id = s.stock_id
      LEFT JOIN medicines m ON s.medicine_id = m.medicine_id
      WHERE pdr.pharmacy_id = ? AND pdr.status = 'pending'
      GROUP BY pdr.request_id
      ORDER BY pdr.request_date DESC
      LIMIT 1
    `;

    const [results] = await connection.execute(pendingQuery, [pharmacy_id]);

    await connection.end();

    if (results.length === 0) {
      return res.status(200).json({
        success: true,
        pendingRequest: null
      });
    }

    const pendingRequest = results[0];
    const items = pendingRequest.items ? JSON.parse(`[${pendingRequest.items}]`) : [];

    res.status(200).json({
      success: true,
      pendingRequest: {
        request_id: pendingRequest.request_id,
        disposal_token: pendingRequest.disposal_token,
        remarks: pendingRequest.remarks,
        status: pendingRequest.status,
        item_count: pendingRequest.item_count,
        items
      }
    });

  } catch (error) {
    console.error('Error fetching pending disposal request:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending disposal request',
      error: error.message
    });
  }
}
