import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { warehouse_id, status = 'request_sent' } = req.query;

    if (!warehouse_id) {
      return res.status(400).json({ success: false, message: 'Warehouse ID is required' });
    }

    const connection = await mysql.createConnection(dbConfig);

    // Fetch all disposal requests with specified status for this warehouse
    const disposalQuery = `
      SELECT 
        pdr.request_id,
        pdr.pharmacy_id,
        pdr.disposal_token,
        pdr.remarks,
        pdr.status,
        pdr.request_date,
        p.pharmacy_name,
        COUNT(DISTINCT dsi.item_id) as item_count,
        GROUP_CONCAT(
          DISTINCT JSON_OBJECT(
            'item_id', dsi.item_id,
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
      LEFT JOIN pharmacy p ON pdr.pharmacy_id = p.pharmacy_id
      LEFT JOIN disposal_stock_items dsi ON pdr.request_id = dsi.request_id
      LEFT JOIN stock s ON dsi.stock_id = s.stock_id
      LEFT JOIN medicines m ON s.medicine_id = m.medicine_id
      WHERE pdr.status = ?
      GROUP BY pdr.request_id
      ORDER BY pdr.request_date DESC
    `;

    const [results] = await connection.execute(disposalQuery, [status]);

    // Parse items JSON for each request
    const disposalRequests = results.map(req => ({
      request_id: req.request_id,
      pharmacy_id: req.pharmacy_id,
      pharmacy_name: req.pharmacy_name,
      disposal_token: req.disposal_token,
      remarks: req.remarks,
      status: req.status,
      item_count: req.item_count,
      request_date: req.request_date,
      items: req.items ? JSON.parse(`[${req.items}]`) : []
    }));

    await connection.end();

    res.status(200).json({
      success: true,
      requests: disposalRequests,
      total: disposalRequests.length
    });

  } catch (error) {
    console.error('Error fetching warehouse disposal requests:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching disposal requests',
      error: error.message
    });
  }
}
