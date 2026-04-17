import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

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

  try {
    const result = await getOrSet(`auto_order:${pharmacy_id}`, 3600, async () => {
      const connection = await mysql.createConnection(dbConfig);
      // Ensure column exists (guard for older schema)
      try {
        await connection.execute(`ALTER TABLE pharmacy ADD COLUMN auto_order_enabled BOOLEAN DEFAULT FALSE`);
      } catch (_) {}
      const [rows] = await connection.execute(
        'SELECT auto_order_enabled FROM pharmacy WHERE pharmacy_id = ?',
        [pharmacy_id]
      );
      await connection.end();
      if (rows.length === 0) return null;
      return { auto_order_enabled: Boolean(rows[0].auto_order_enabled) };
    });

    if (!result) {
      return res.status(404).json({ success: false, message: 'Pharmacy not found' });
    }

    res.status(200).json({ success: true, auto_order_enabled: result.auto_order_enabled });

  } catch (error) {
    console.error('Error fetching auto order setting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch auto order setting',
      error: error.message
    });
  }
}