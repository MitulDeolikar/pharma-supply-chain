import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, publish } = require('../../lib/cache');

export default async function handler(req, res) {
    if (req.method !== 'PUT') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const connection = await mysql.createConnection(dbConfig);

        // Verify stock exists
        const [existingStock] = await connection.execute(
            'SELECT stock_id FROM stock WHERE stock_id = ?',
            [req.body.stock_id]
        );

        if (existingStock.length === 0) {
            await connection.end();
            return res.status(404).json({
                success: false,
                message: 'Stock not found'
            });
        }

        const {
            stock_id,
            batch_number,
            quantity,
            price_per_unit,
            expiry_date
        } = req.body;

        const query = `
            UPDATE stock 
            SET 
                batch_number = ?,
                quantity = ?,
                price_per_unit = ?,
                expiry_date = ?
            WHERE stock_id = ?
        `;

        await connection.execute(query, [
            batch_number,
            quantity,
            price_per_unit,
            expiry_date,
            stock_id
        ]);

        await connection.end();

        // Invalidate cached stock for this pharmacy if pharmacy_id provided
        if (req.body.pharmacy_id) {
          invalidate(`stock:${req.body.pharmacy_id}`);
          publish('pharma:events', { type: 'stock:updated', pharmacy_id: req.body.pharmacy_id, stock_id });
        }

        logActivity({
          actor_type: 'pharmacy', actor_id: req.body.pharmacy_id || stock_id, actor_name: req.body.pharmacy_id ? `Pharmacy #${req.body.pharmacy_id}` : `Stock #${stock_id}`,
          action: 'STOCK_UPDATED', entity_type: 'stock', entity_id: stock_id,
          description: `Stock #${stock_id} updated — batch ${batch_number}, qty: ${quantity}, expiry: ${expiry_date}`,
          metadata: { stock_id, batch_number, quantity, price_per_unit, expiry_date }
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            message: 'Stock updated successfully'
        });

    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating stock',
            error: error.message
        });
    }
}