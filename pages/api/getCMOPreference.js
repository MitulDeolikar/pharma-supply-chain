import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed'
    });
  }

  const { cmo_id } = req.query;

  if (!cmo_id) {
    return res.status(400).json({
      success: false,
      message: 'CMO ID is required'
    });
  }

  try {
    const cmo = await getOrSet(`cmo_pref:${cmo_id}`, 3600, async () => {
      const connection = await mysql.createConnection(dbConfig);
      const [cmos] = await connection.execute(
        'SELECT cmo_id, name, auto_approval_enabled FROM cmo WHERE cmo_id = ?',
        [cmo_id]
      );
      await connection.end();
      if (cmos.length === 0) return null;
      return {
        cmo_id: cmos[0].cmo_id,
        name: cmos[0].name,
        auto_approval_enabled: Boolean(cmos[0].auto_approval_enabled)
      };
    });

    if (!cmo) {
      return res.status(404).json({ success: false, message: 'CMO not found' });
    }

    return res.status(200).json({ success: true, ...cmo });

  } catch (error) {
    console.error('Error fetching CMO preference:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CMO preference',
      error: error.message
    });
  }
}
