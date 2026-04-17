import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const pharmacyId = req.query.pharmacyId;
    if (!pharmacyId) {
        return res.status(400).json({ success: false, message: 'Pharmacy ID is required' });
    }

    try {
        const stocks = await getOrSet(`stock:${pharmacyId}`, 300, async () => {
            const connection = await mysql.createConnection(dbConfig);
            const query = `
                SELECT
                    s.stock_id,
                    s.pharmacy_id,
                    s.medicine_id,
                    s.batch_number,
                    s.quantity,
                    s.price_per_unit,
                    s.expiry_date,
                    s.is_nsq,
                    m.name as medicine_name,
                    m.dosage,
                    m.unit as unit_type,
                    m.manufacturer,
                    m.description,
                    gm.generic_name
                FROM stock s
                JOIN medicines m ON s.medicine_id = m.medicine_id
                LEFT JOIN generic_medicines gm ON m.generic_id = gm.generic_id
                WHERE s.pharmacy_id = ?
                ORDER BY m.name, s.expiry_date
            `;
            const [rows] = await connection.execute(query, [pharmacyId]);
            await connection.end();
            return rows;
        });

        return res.status(200).json({ success: true, stocks });

    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching pharmacy stock',
            error: error.message
        });
    }
}