import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

// Protected endpoint to set password '123' for existing opd patients (use carefully)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { secret_key } = req.body;
  if (secret_key !== 'update_opd_passwords_2025') {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const plain = '123';
    const hashed = await bcrypt.hash(plain, 10);

    // Update all existing opd_patients to have password = hashed
    const [result] = await connection.execute('UPDATE opd_patients SET password = ?', [hashed]);

    await connection.end();
    return res.status(200).json({ success: true, message: 'Passwords updated', affectedRows: result.affectedRows });
  } catch (error) {
    console.error('Error updating OPD passwords:', error);
    if (connection) await connection.end();
    return res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
  }
}
