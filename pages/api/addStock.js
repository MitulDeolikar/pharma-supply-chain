import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, publish } = require('../../lib/cache');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const connection = await mysql.createConnection(dbConfig);

        // Verify medicine exists
        const [medicines] = await connection.execute('SELECT medicine_id FROM medicines WHERE medicine_id = ?', 
            [req.body.medicine_id]);

        if (medicines.length === 0) {
            await connection.end();
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid medicine ID' 
            });
        }

        const { 
            pharmacy_id,
            medicine_id, 
            batch_number, 
            quantity, 
            price_per_unit, 
            expiry_date 
        } = req.body;

        const query = `
            INSERT INTO stock (
                pharmacy_id,
                medicine_id, 
                batch_number, 
                quantity, 
                price_per_unit, 
                expiry_date
            ) VALUES (?, ?, ?, ?, ?, ?)
        `;

        const [result] = await connection.execute(query, [
            pharmacy_id,
            medicine_id,
            batch_number,
            quantity,
            price_per_unit,
            expiry_date
        ]);

        await connection.end();

        // Invalidate cached stock for the affected entity
        if (pharmacy_id) {
          invalidate(`stock:${pharmacy_id}`);
          publish('pharma:events', { type: 'stock:added', pharmacy_id, medicine_id });
        } else if (req.body.warehouse_id) {
          invalidate(`wh_stock:${req.body.warehouse_id}`);
          publish('pharma:events', { type: 'stock:added', warehouse_id: req.body.warehouse_id, medicine_id });
        }

        const actorType = pharmacy_id ? 'pharmacy' : 'warehouse';
        const actorId   = pharmacy_id || req.body.warehouse_id;
        logActivity({
          actor_type: actorType, actor_id: actorId, actor_name: `${actorType === 'pharmacy' ? 'Pharmacy' : 'Warehouse'} #${actorId}`,
          action: 'STOCK_ADDED', entity_type: 'stock', entity_id: result.insertId,
          description: `${actorType === 'pharmacy' ? 'Pharmacy' : 'Warehouse'} #${actorId} added ${quantity} units of medicine #${medicine_id} (Batch: ${batch_number}, Expiry: ${expiry_date})`,
          metadata: { medicine_id, batch_number, quantity, expiry_date }
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            message: 'Stock added successfully',
            stockId: result.insertId
        });

    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error adding stock',
            error: error.message
        });
    }
}