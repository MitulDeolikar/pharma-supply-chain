import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logLogin } = require('../../lib/auditLogger');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { opd_number, password } = req.body;
  if (!opd_number || !password) {
    return res.status(400).json({ success: false, message: 'opd_number and password are required' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT * FROM opd_patients WHERE opd_number = ?', [opd_number]);
    if (!rows || rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const patient = rows[0];
    const match = await bcrypt.compare(password, patient.password || '');
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { opd_id: patient.opd_id, opd_number: patient.opd_number, role: 'patient' },
      process.env.JWT_SECRET || 'hello',
      { expiresIn: '1h' }
    );

    logLogin({ user_type: 'patient', user_id: patient.opd_id, user_name: patient.patient_name || patient.opd_number }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      patient: {
        opd_id: patient.opd_id,
        opd_number: patient.opd_number,
        patient_name: patient.patient_name,
        age: patient.age,
        gender: patient.gender
      },
      token
    });
  } catch (error) {
    console.error('Patient login error:', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
  } finally {
    if (connection) await connection.end();
  }
}
