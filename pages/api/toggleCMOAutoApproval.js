import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { invalidate, publish } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed'
    });
  }

  const { cmo_id, auto_approval_enabled } = req.body;

  if (!cmo_id || typeof auto_approval_enabled !== 'boolean') {
    return res.status(400).json({
      success: false,
      message: 'Missing or invalid parameters: cmo_id and auto_approval_enabled (boolean) required'
    });
  }

  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);

    // Update CMO auto-approval preference
    const [result] = await connection.execute(
      'UPDATE cmo SET auto_approval_enabled = ? WHERE cmo_id = ?',
      [auto_approval_enabled, cmo_id]
    );

    if (result.affectedRows === 0) {
      await connection.end();
      return res.status(404).json({
        success: false,
        message: 'CMO not found'
      });
    }

    // Fetch updated CMO info to confirm
    const [updated] = await connection.execute(
      'SELECT cmo_id, name, auto_approval_enabled FROM cmo WHERE cmo_id = ?',
      [cmo_id]
    );

    await connection.end();

    invalidate(`cmo_pref:${cmo_id}`);
    publish('pharma:events', { type: 'cmo:auto_approval_toggled', cmo_id, auto_approval_enabled });

    return res.status(200).json({
      success: true,
      message: `Auto-approval ${auto_approval_enabled ? 'enabled' : 'disabled'} for CMO`,
      cmo: updated[0]
    });

  } catch (error) {
    if (connection) await connection.end();
    console.error('Error updating CMO preference:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating CMO preference',
      error: error.message
    });
  }
}
