import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { pharmacy_id } = req.query;

        if (!pharmacy_id) {
            return res.status(400).json({ success: false, message: 'Pharmacy ID is required' });
        }

        const connection = await mysql.createConnection(dbConfig);

        const commonCols = `
            s.stock_id, s.pharmacy_id, s.medicine_id, s.batch_number,
            s.quantity, s.price_per_unit, s.expiry_date, s.is_nsq,
            m.name as medicine_name, m.dosage, m.unit as unit_type,
            m.manufacturer, m.description
        `;

        // Expired medicines (by date)
        const [expiredMedicines] = await connection.execute(`
            SELECT ${commonCols}
            FROM stock s
            JOIN medicines m ON s.medicine_id = m.medicine_id
            WHERE s.pharmacy_id = ? AND s.expiry_date < CURDATE() AND s.quantity > 0
            ORDER BY s.expiry_date ASC, m.name
        `, [pharmacy_id]);

        // NSQ-flagged medicines that are NOT already expired (expired ones show in expiredMedicines)
        const [nsqMedicines] = await connection.execute(`
            SELECT ${commonCols}
            FROM stock s
            JOIN medicines m ON s.medicine_id = m.medicine_id
            WHERE s.pharmacy_id = ? AND s.is_nsq = 1 AND s.expiry_date >= CURDATE() AND s.quantity > 0
            ORDER BY m.name, s.batch_number
        `, [pharmacy_id]);

        await connection.end();

        res.status(200).json({
            success: true,
            expiredMedicines,
            nsqMedicines,
        });

    } catch (error) {
        console.error('Error fetching expired medicines:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching expired medicines'
        });
    }
}