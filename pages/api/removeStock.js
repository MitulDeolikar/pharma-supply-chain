import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, publish } = require('../../lib/cache');

export default async function handler(req, res) {
    if (req.method !== 'DELETE') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const connection = await mysql.createConnection(dbConfig);
        const { stock_id } = req.query;

        // Verify stock exists
        const [existingStock] = await connection.execute(
            'SELECT stock_id FROM stock WHERE stock_id = ?',
            [stock_id]
        );

        if (existingStock.length === 0) {
            await connection.end();
            return res.status(404).json({
                success: false,
                message: 'Stock not found'
            });
        }

        // Delete the stock
        await connection.execute('DELETE FROM stock WHERE stock_id = ?', [stock_id]);

        await connection.end();

        // Invalidate cached stock for this pharmacy if pharmacy_id provided
        if (req.query.pharmacy_id) {
          invalidate(`stock:${req.query.pharmacy_id}`);
          publish('pharma:events', { type: 'stock:removed', pharmacy_id: req.query.pharmacy_id, stock_id });
        }

        logActivity({
          actor_type: 'pharmacy', actor_id: req.query.pharmacy_id || stock_id, actor_name: req.query.pharmacy_id ? `Pharmacy #${req.query.pharmacy_id}` : `Stock #${stock_id}`,
          action: 'STOCK_REMOVED', entity_type: 'stock', entity_id: stock_id,
          description: `Stock entry #${stock_id} removed from inventory`,
          metadata: { stock_id }
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            message: 'Stock removed successfully'
        });

    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error removing stock',
            error: error.message
        });
    }
}