import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { patient_name, age, gender, password } = req.body;

  if (!patient_name || !age || !gender) {
    return res.status(400).json({ success: false, message: 'patient_name, age and gender are required' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    await connection.beginTransaction();

    // Determine next OPD number (format OPD###)
    const [rows] = await connection.execute(
      'SELECT opd_number FROM opd_patients ORDER BY opd_id DESC LIMIT 1'
    );

    let nextNum = 1;
    if (rows && rows.length > 0 && rows[0].opd_number) {
      const last = rows[0].opd_number;
      const match = last.match(/OPD(\d+)/i);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }

    const opd_number = `OPD${String(nextNum).padStart(3, '0')}`;

    const plainPassword = password && String(password).trim().length > 0 ? password : '123';
    const hashed = await bcrypt.hash(plainPassword, 10);

    const [result] = await connection.execute(
      `INSERT INTO opd_patients (opd_number, patient_name, age, gender, password) VALUES (?, ?, ?, ?, ?)`,
      [opd_number, patient_name, age, gender, hashed]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Patient registered successfully',
      patient: {
        opd_id: result.insertId,
        opd_number,
        patient_name,
        age,
        gender
      }
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error registering patient:', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
  } finally {
    if (connection) await connection.end();
  }
}
