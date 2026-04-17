import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  let connection;
  try {
    const { request_id, action, stock_ids } = req.body;

    if (!request_id || !action || !stock_ids || stock_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'request_id, action (add/remove), and stock_ids are required'
      });
    }

    connection = await mysql.createConnection(dbConfig);

    if (action === 'add') {
      // Add stock items to pending disposal request
      for (const stock_id of stock_ids) {
        // Check if already exists
        const [existing] = await connection.execute(
          `SELECT item_id FROM disposal_stock_items WHERE request_id = ? AND stock_id = ?`,
          [request_id, stock_id]
        );

        if (existing.length === 0) {
          await connection.execute(
            `INSERT INTO disposal_stock_items (stock_id, request_id) VALUES (?, ?)`,
            [stock_id, request_id]
          );
        }
      }
    } else if (action === 'remove') {
      // Remove stock items from pending disposal request
      const placeholders = stock_ids.map(() => '?').join(',');
      await connection.execute(
        `DELETE FROM disposal_stock_items WHERE request_id = ? AND stock_id IN (${placeholders})`,
        [request_id, ...stock_ids]
      );
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "add" or "remove"'
      });
    }

    await connection.end();

    res.status(200).json({
      success: true,
      message: `Items ${action}ed successfully to disposal request`,
      request_id
    });

  } catch (error) {
    console.error('Error updating disposal request:', error);
    if (connection) await connection.end();
    res.status(500).json({
      success: false,
      message: 'Error updating disposal request',
      error: error.message
    });
  }
}
