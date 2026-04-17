import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    // Display only unassigned prescriptions (pharmacy_id IS NULL)
    // `pharmacy_id` query parameter is ignored for listing available orders

    try {
        const connection = await mysql.createConnection(dbConfig);

        // Fetch prescriptions with patient, doctor, and medicine details for this pharmacy
        const [prescriptions] = await connection.execute(`
            SELECT 
                op.prescription_id,
                op.opd_number,
                op.diagnosis,
                op.created_at,
                pat.patient_name,
                doc.username as doctor_name,
                GROUP_CONCAT(
                    JSON_OBJECT(
                        'medicine_id', m.medicine_id,
                            'name', m.name,
                            'dosage', m.dosage,
                            'unit', m.unit,
                        'quantity', opm.quantity,
                        'frequency', opm.frequency,
                        'duration_days', opm.duration_days,
                        'instructions', opm.instructions
                    )
                ) as medicines
            FROM opd_prescriptions op
            JOIN opd_patients pat ON op.opd_number = pat.opd_number
            JOIN doctor doc ON op.doctor_id = doc.doctor_id
            LEFT JOIN opd_prescription_medicines opm ON op.prescription_id = opm.prescription_id
            LEFT JOIN medicines m ON opm.medicine_id = m.medicine_id
            WHERE op.pharmacy_id IS NULL
            GROUP BY op.prescription_id
            ORDER BY op.created_at DESC
        `);

        // Parse the medicines string to JSON for each prescription
        const formattedPrescriptions = prescriptions.map(prescription => ({
            ...prescription,
            medicines: prescription.medicines ? JSON.parse(`[${prescription.medicines}]`) : []
        }));

        await connection.end();

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