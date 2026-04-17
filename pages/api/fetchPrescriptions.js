import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { doctor_id } = req.query;

    if (!doctor_id) {
        return res.status(400).json({
            success: false,
            message: 'Doctor ID is required'
        });
    }

    try {
        const connection = await mysql.createConnection(dbConfig);
        console.log('Fetching prescriptions for doctor_id:', doctor_id);

        // Fetch prescriptions with patient details and medicines
        const [prescriptions] = await connection.execute(`
            SELECT 
                op.prescription_id,
                op.opd_number,
                op.pharmacy_id,
                op.NAC,
                p.pharmacy_name as pharmacy_name,
                pat.patient_name,
                pat.age,
                pat.gender,
                op.diagnosis,
                op.created_at,
                GROUP_CONCAT(
                    JSON_OBJECT(
                        'medicine_id', m.medicine_id,
                        'name', m.name,
                        'dosage', m.dosage,
                        'unit', m.unit,
                        'frequency', opm.frequency,
                        'times_per_day', opm.times_per_day,
                        'duration_days', opm.duration_days,
                        'quantity', opm.quantity,
                        'instructions', opm.instructions
                    )
                ) as medicines
            FROM opd_prescriptions op
            JOIN opd_patients pat ON op.opd_number = pat.opd_number
            LEFT JOIN opd_prescription_medicines opm ON op.prescription_id = opm.prescription_id
            LEFT JOIN medicines m ON opm.medicine_id = m.medicine_id
            LEFT JOIN pharmacy p ON op.pharmacy_id = p.pharmacy_id
            WHERE op.doctor_id = ?
            GROUP BY op.prescription_id
            ORDER BY op.created_at DESC
        `, [doctor_id]);

        // Parse the medicines string to JSON for each prescription
        const formattedPrescriptions = prescriptions.map(prescription => {
            try {
                return {
                    ...prescription,
                    medicines: prescription.medicines ? JSON.parse(`[${prescription.medicines}]`) : []
                };
            } catch (error) {
                console.error('Error parsing medicines for prescription:', prescription.prescription_id);
                return {
                    ...prescription,
                    medicines: []
                };
            }
        });

        await connection.end();
        console.log('Fetched prescriptions:', formattedPrescriptions);

        return res.status(200).json({
            success: true,
            prescriptions: formattedPrescriptions
        });

    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching prescriptions',
            error: error.message
        });
    }
}