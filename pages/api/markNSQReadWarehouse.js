import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');

// POST /api/markNSQReadWarehouse
// Body: { notification_id, warehouse_id }
// Marks the notification as read AND flags all matching warehouse stock rows as is_nsq = 1

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { notification_id, warehouse_id } = req.body;
  if (!notification_id || !warehouse_id) {
    return res.status(400).json({ success: false, message: 'notification_id and warehouse_id are required' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    await connection.beginTransaction();

    // Get the batch details from this notification
    const [[notif]] = await connection.execute(`
      SELECT na.batch_number, na.medicine_id
      FROM nsq_warehouse_notifications nwn
      JOIN nsq_alerts na ON na.alert_id = nwn.alert_id
      WHERE nwn.id = ? AND nwn.warehouse_id = ?
    `, [notification_id, warehouse_id]);

    if (!notif) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    // Mark notification as read
    await connection.execute(
      `UPDATE nsq_warehouse_notifications SET is_read = 1 WHERE id = ? AND warehouse_id = ?`,
      [notification_id, warehouse_id]
    );

    // Flag all warehouse stock rows of this batch as NSQ
    const [updateResult] = await connection.execute(
      `UPDATE stock SET is_nsq = 1
       WHERE warehouse_id = ? AND batch_number = ? AND medicine_id = ? AND quantity > 0`,
      [warehouse_id, notif.batch_number, notif.medicine_id]
    );

    await connection.commit();

    logActivity({
      actor_type: 'warehouse', actor_id: warehouse_id, actor_name: `Warehouse #${warehouse_id}`,
      action: 'NSQ_ACKNOWLEDGED', entity_type: 'nsq_alert', entity_id: notification_id,
      description: `Warehouse #${warehouse_id} acknowledged NSQ alert for batch ${notif.batch_number} — ${updateResult.affectedRows} stock row(s) quarantined`,
      metadata: { batch_number: notif.batch_number, medicine_id: notif.medicine_id, stock_rows_flagged: updateResult.affectedRows }
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      stock_rows_flagged: updateResult.affectedRows,
      batch_number: notif.batch_number,
      medicine_id: notif.medicine_id,
    });

  } catch (error) {
    console.error('markNSQReadWarehouse error:', error);
    try { if (connection) await connection.rollback(); } catch (_) {}
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  } finally {
    if (connection) await connection.end();
  }
}
