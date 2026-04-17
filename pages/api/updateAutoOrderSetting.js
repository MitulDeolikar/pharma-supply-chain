import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { invalidate, publish } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { pharmacy_id, auto_order_enabled } = req.body;

  if (!pharmacy_id || typeof auto_order_enabled !== 'boolean') {
    return res.status(400).json({ 
      success: false, 
      message: 'Pharmacy ID and auto_order_enabled (boolean) are required' 
    });
  }

  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);

    // Check if auto_order_enabled column exists in pharmacy table, if not create it
    try {
      await connection.execute(`
        ALTER TABLE pharmacy 
        ADD COLUMN auto_order_enabled BOOLEAN DEFAULT FALSE
      `);
    } catch (error) {
      // Column might already exist, ignore error
    }

    // Update auto order setting for the pharmacy
    const [result] = await connection.execute(
      'UPDATE pharmacy SET auto_order_enabled = ? WHERE pharmacy_id = ?',
      [auto_order_enabled, pharmacy_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Pharmacy not found'
      });
    }

    // Invalidate cached setting and pharmacies list (auto_order_enabled is included in getAllPharmacies)
    invalidate(`auto_order:${pharmacy_id}`, 'pharmacies:all');
    publish('pharma:events', { type: 'pharmacy:auto_order_toggled', pharmacy_id, auto_order_enabled });

    res.status(200).json({
      success: true,
      message: `Auto-ordering ${auto_order_enabled ? 'enabled' : 'disabled'} successfully`,
      auto_order_enabled
    });

  } catch (error) {
    console.error('Error updating auto order setting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update auto order setting',
      error: error.message
    });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}