import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const pharmacies = await getOrSet('pharmacies:all', 86400, async () => {
      const connection = await mysql.createConnection(dbConfig);
      const [rows] = await connection.execute(`
        SELECT
          pharmacy_id,
          pharmacy_name,
          username,
          contact_number,
          district,
          block,
          address,
          created_at,
          auto_order_enabled
        FROM pharmacy
        ORDER BY district ASC, block ASC, pharmacy_name ASC
      `);
      await connection.end();
      return rows;
    });

    res.status(200).json({
      success: true,
      pharmacies,
      total_count: pharmacies.length,
      message: 'Pharmacies fetched successfully'
    });

  } catch (error) {
    console.error('Error fetching all pharmacies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pharmacies',
      error: error.message
    });
  }
}