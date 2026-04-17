import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const connection = await mysql.createConnection(dbConfig);
        const { pharmacy_id } = req.query; // get pharmacy_id from URL

        // Base SQL query
        let query = `
            SELECT 
                per.request_id,
                per.request_date,
                per.status,
                per.remarks,
                p.pharmacy_name,
                GROUP_CONCAT(
                        JSON_OBJECT(
                            'medicine_id', peri.medicine_id,
                            'generic_id', peri.generic_id,
                            'name', COALESCE(m.name, g.generic_name),
                            'dosage', m.dosage,
                            'unit', m.unit,
                            'quantity_requested', peri.quantity_requested
                        )
                    ) AS medicines
            FROM pharmacy_emergency_requests per
            LEFT JOIN pharmacy_emergency_request_items peri ON per.request_id = peri.request_id
            LEFT JOIN medicines m ON peri.medicine_id = m.medicine_id
            LEFT JOIN generic_medicines g ON peri.generic_id = g.generic_id
            LEFT JOIN pharmacy p ON per.pharmacy_id = p.pharmacy_id
        `;

        const params = [];

        // Add WHERE clause only if pharmacy_id is passed
        if (pharmacy_id) {
            query += ` WHERE per.pharmacy_id = ?`;
            params.push(pharmacy_id);
        }

        // Final grouping and ordering
        query += `
            GROUP BY per.request_id
            ORDER BY per.request_date DESC
        `;

        // Execute the query safely with parameters
        const [requests] = await connection.execute(query, params);

        // Parse JSON array of medicines
        const formattedRequests = requests.map(request => ({
            ...request,
            medicines: request.medicines ? JSON.parse(`[${request.medicines}]`) : []
        }));

        await connection.end();

        // Return formatted response
        return res.status(200).json({
            success: true,
            requests: formattedRequests
        });

    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching emergency requests',
            error: error.message
        });
    }
}
