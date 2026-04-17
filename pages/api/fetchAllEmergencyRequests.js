import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const requests = await getOrSet('emergency_requests:all', 300, async () => {
            const connection = await mysql.createConnection(dbConfig);
            const [rows] = await connection.execute(`
                SELECT
                    per.request_id,
                    per.request_date,
                    per.status,
                    per.remarks,
                    per.pharmacy_id,
                    per.accepting_warehouse_id,
                    p.pharmacy_name,
                    ap.pharmacy_name as accepting_pharmacy_name,
                    GROUP_CONCAT(
                        JSON_OBJECT(
                            'medicine_id', peri.medicine_id,
                            'generic_id', peri.generic_id,
                            'name', COALESCE(m.name, g.generic_name),
                            'generic_name', g.generic_name,
                            'dosage', m.dosage,
                            'unit', m.unit,
                            'quantity_requested', peri.quantity_requested
                        )
                    ) as medicines
                FROM pharmacy_emergency_requests per
                LEFT JOIN pharmacy_emergency_request_items peri ON per.request_id = peri.request_id
                LEFT JOIN medicines m ON peri.medicine_id = m.medicine_id
                LEFT JOIN generic_medicines g ON peri.generic_id = g.generic_id
                LEFT JOIN pharmacy p ON per.pharmacy_id = p.pharmacy_id
                LEFT JOIN pharmacy ap ON per.accepting_pharmacy_id = ap.pharmacy_id
                GROUP BY per.request_id, per.request_date, per.status, per.remarks, per.pharmacy_id, per.accepting_pharmacy_id, p.pharmacy_name, ap.pharmacy_name
                ORDER BY per.request_date DESC
            `);
            await connection.end();
            return rows.map(r => ({
                ...r,
                medicines: r.medicines ? JSON.parse(`[${r.medicines}]`) : []
            }));
        });

        return res.status(200).json({ success: true, requests });

    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching emergency requests',
            error: error.message
        });
    }
}
