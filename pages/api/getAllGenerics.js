import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const generics = await getOrSet('generics:all', 86400, async () => {
      const connection = await mysql.createConnection(dbConfig);
      const [rows] = await connection.execute('SELECT generic_id, generic_name, category FROM generic_medicines ORDER BY generic_name');
      await connection.end();
      return rows;
    });
    return res.status(200).json({ success: true, generics });
  } catch (err) {
    console.error('Error fetching generics', err);
    return res.status(500).json({ success: false, message: 'Error fetching generics' });
  }
}
