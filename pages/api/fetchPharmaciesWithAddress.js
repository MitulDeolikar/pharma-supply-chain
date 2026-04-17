import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const connection = await mysql.createConnection(dbConfig);

    const query = `
      SELECT
        pharmacy_id,
        name as pharmacy_name,
        address
      FROM pharmacies
      ORDER BY name
    `;

    const [rows] = await connection.execute(query);
    await connection.end();

    return res.status(200).json({ success: true, pharmacies: rows });
  } catch (error) {
    console.error('Database error (fetchPharmaciesWithAddress):', error);
    return res.status(500).json({ success: false, message: 'Error fetching pharmacies', error: error.message });
  }
}
