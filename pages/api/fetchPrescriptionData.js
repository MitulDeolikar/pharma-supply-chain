import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const data = await getOrSet('prescription_form_data', 21600, async () => {
            const connection = await mysql.createConnection(dbConfig);

            const [patients] = await connection.execute(
                'SELECT opd_number, patient_name, age, gender FROM opd_patients ORDER BY created_at DESC'
            );
            const [medicines] = await connection.execute(
                'SELECT medicine_id, name, dosage, unit, manufacturer FROM medicines'
            );
            const [pharmacies] = await connection.execute(
                'SELECT pharmacy_id, username FROM pharmacy'
            );

            await connection.end();
            return { patients, medicines, pharmacies };
        });

        return res.status(200).json({
            success: true,
            patients: data.patients,
            medicines: data.medicines,
            pharmacies: data.pharmacies
        });

    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching data',
            error: error.message
        });
    }
}