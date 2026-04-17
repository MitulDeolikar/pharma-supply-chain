import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { opd_number } = req.query;
  if (!opd_number) {
    return res.status(400).json({ success: false, message: 'opd_number is required' });
  }

  try {
    const connection = await mysql.createConnection(dbConfig);

    // fetch patient basic info
    const [patients] = await connection.execute('SELECT opd_id, opd_number, patient_name, age, gender FROM opd_patients WHERE opd_number = ?', [opd_number]);
    const patient = patients && patients[0] ? patients[0] : null;

    // Fetch prescriptions and their medicines for this OPD number
    const [prescriptions] = await connection.execute(`
      SELECT 
        op.prescription_id,
        op.opd_number,
        op.doctor_id,
        op.pharmacy_id,
        p.pharmacy_name,
        op.diagnosis,
        op.created_at,
        GROUP_CONCAT(
          JSON_OBJECT(
            'id', opm.id,
            'medicine_id', opm.medicine_id,
            'frequency', opm.frequency,
            'times_per_day', opm.times_per_day,
            'duration_days', opm.duration_days,
            'quantity', opm.quantity,
            'instructions', opm.instructions,
            'name', m.name,
            'dosage', m.dosage,
            'unit', m.unit
          )
        ) AS medicines
      FROM opd_prescriptions op
      LEFT JOIN opd_prescription_medicines opm ON op.prescription_id = opm.prescription_id
      LEFT JOIN medicines m ON opm.medicine_id = m.medicine_id
      LEFT JOIN pharmacy p ON op.pharmacy_id = p.pharmacy_id
      WHERE op.opd_number = ?
      GROUP BY op.prescription_id
      ORDER BY op.created_at DESC
    `, [opd_number]);

    const formattedPrescriptions = prescriptions.map(p => {
      try {
        return {
          ...p,
          medicines: p.medicines ? JSON.parse(`[${p.medicines}]`) : []
        };
      } catch (err) {
        console.error('Error parsing medicines for prescription', p.prescription_id, err);
        return { ...p, medicines: [] };
      }
    });

    await connection.end();

    return res.status(200).json({ success: true, patient, prescriptions: formattedPrescriptions });
  } catch (error) {
    console.error('Error fetching patient prescriptions:', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
  }
}
