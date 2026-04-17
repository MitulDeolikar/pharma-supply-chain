import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { doctorId } = req.query;
    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'doctorId is required' });
    }

    const doctor = await getOrSet(`doctor:${doctorId}`, 43200, async () => {
      const connection = await mysql.createConnection(dbConfig);
      const [rows] = await connection.execute(
        `SELECT doctor_id, username as name, address, district, block, contact_number, pharmacy_id
         FROM doctor
         WHERE doctor_id = ?`,
        [doctorId]
      );
      await connection.end();
      if (!rows || rows.length === 0) return null;
      const { doctor_id, name, address, district, block, contact_number, pharmacy_id } = rows[0];
      return { doctor_id, name, address, district, block, contact_number, pharmacy_id };
    });

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    return res.status(200).json({ success: true, doctor });
  } catch (error) {
    console.error('getDoctorInfo error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
