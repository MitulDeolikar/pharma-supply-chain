import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const medicines = await getOrSet('medicines:all', 86400, async () => {
            const connection = await mysql.createConnection(dbConfig);
            const query = `
                SELECT
                    m.medicine_id,
                    m.name as medicine_name,
                    m.dosage,
                    m.unit,
                    m.manufacturer,
                    m.description,
                    gm.generic_name
                FROM medicines m
                LEFT JOIN generic_medicines gm ON m.generic_id = gm.generic_id
                ORDER BY m.name
            `;
            const [rows] = await connection.execute(query);
            await connection.end();
            return rows;
        });

        return res.status(200).json({
            success: true,
            medicines
        });

    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Error fetching medicines', 
            error: error.message 
        });
    }
}