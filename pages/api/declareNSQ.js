import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');
const { notifyUsers } = require('../../lib/fcmService');

// POST /api/declareNSQ
// Body: { batch_number, medicine_id, cmo_id, message (optional) }
// Declares a batch as NSQ (Not of Standard Quality) and sends a notification
// to every pharmacy currently holding that batch in their stock

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { batch_number, medicine_id, cmo_id, message } = req.body;
  if (!batch_number || !medicine_id || !cmo_id) {
    return res.status(400).json({ success: false, message: 'batch_number, medicine_id and cmo_id are required' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    await connection.beginTransaction();

    // Prevent duplicate NSQ declaration for same batch+medicine
    const [existing] = await connection.execute(
      `SELECT alert_id FROM nsq_alerts WHERE batch_number = ? AND medicine_id = ?`,
      [batch_number, medicine_id]
    );
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'NSQ alert already declared for this batch' });
    }

    // Get medicine name
    const [[medicine]] = await connection.execute(
      `SELECT name, dosage, unit FROM medicines WHERE medicine_id = ?`,
      [medicine_id]
    );
    const medicineName = medicine ? `${medicine.name}${medicine.dosage ? ' ' + medicine.dosage : ''}` : `Medicine #${medicine_id}`;

    const alertMessage = message ||
      `URGENT: Batch ${batch_number} of ${medicineName} has been declared Not of Standard Quality (NSQ) by the CMO. Please immediately quarantine and dispose of this batch as per SOP. Do not dispense to patients.`;

    // Create the NSQ alert record
    const [alertResult] = await connection.execute(
      `INSERT INTO nsq_alerts (batch_number, medicine_id, medicine_name, declared_by_cmo_id, message)
       VALUES (?, ?, ?, ?, ?)`,
      [batch_number, medicine_id, medicineName, cmo_id, alertMessage]
    );
    const alertId = alertResult.insertId;

    // Find all pharmacies currently holding this batch with quantity > 0
    const [affectedPharmacies] = await connection.execute(
      `SELECT DISTINCT pharmacy_id FROM stock
       WHERE batch_number = ? AND medicine_id = ? AND pharmacy_id IS NOT NULL AND quantity > 0`,
      [batch_number, medicine_id]
    );

    // Find all warehouses currently holding this batch with quantity > 0
    const [affectedWarehouses] = await connection.execute(
      `SELECT DISTINCT warehouse_id FROM stock
       WHERE batch_number = ? AND medicine_id = ? AND warehouse_id IS NOT NULL AND quantity > 0`,
      [batch_number, medicine_id]
    );

    if (affectedPharmacies.length === 0 && affectedWarehouses.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'No pharmacies or warehouses currently hold this batch' });
    }

    // Ensure nsq_warehouse_notifications table exists (idempotent)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS nsq_warehouse_notifications (
        id           INT PRIMARY KEY AUTO_INCREMENT,
        alert_id     INT NOT NULL,
        warehouse_id INT NOT NULL,
        is_read      TINYINT(1) NOT NULL DEFAULT 0,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (alert_id) REFERENCES nsq_alerts(alert_id)
      )
    `);

    // Insert one notification row per pharmacy
    for (const { pharmacy_id } of affectedPharmacies) {
      await connection.execute(
        `INSERT INTO nsq_pharmacy_notifications (alert_id, pharmacy_id) VALUES (?, ?)`,
        [alertId, pharmacy_id]
      );
    }

    // Insert one notification row per warehouse
    for (const { warehouse_id } of affectedWarehouses) {
      await connection.execute(
        `INSERT INTO nsq_warehouse_notifications (alert_id, warehouse_id) VALUES (?, ?)`,
        [alertId, warehouse_id]
      );
    }

    await connection.commit();

    // Push notifications to affected pharmacies and warehouses
    const affectedPharmacyIds = affectedPharmacies.map(p => p.pharmacy_id);
    const affectedWarehouseIds = affectedWarehouses.map(w => w.warehouse_id);
    const nsqTitle = '⚠️ NSQ Alert';
    const nsqBody = `Batch ${batch_number} of ${medicineName} has been declared NSQ. Please quarantine and dispose immediately.`;
    const nsqData = { alert_id: String(alertId), batch_number, type: 'nsq_declared' };

    if (affectedPharmacyIds.length > 0) {
      await notifyUsers(connection, 'pharmacy', affectedPharmacyIds, nsqTitle, nsqBody, nsqData)
        .catch(e => console.error('FCM NSQ pharmacy notify error:', e));
    }
    if (affectedWarehouseIds.length > 0) {
      await notifyUsers(connection, 'warehouse', affectedWarehouseIds, nsqTitle, nsqBody, nsqData)
        .catch(e => console.error('FCM NSQ warehouse notify error:', e));
    }

    logActivity({
      actor_type: 'cmo', actor_id: cmo_id, actor_name: `CMO #${cmo_id}`,
      action: 'NSQ_DECLARED', entity_type: 'nsq_alert', entity_id: alertId,
      description: `CMO declared NSQ for batch ${batch_number} of ${medicineName} — notified ${affectedPharmacies.length} pharmacy(s) and ${affectedWarehouses.length} warehouse(s)`,
      metadata: { batch_number, medicine_id, notified_pharmacies: affectedPharmacies.length, notified_warehouses: affectedWarehouses.length }
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `NSQ alert declared. Notified ${affectedPharmacies.length} pharmacy(s) and ${affectedWarehouses.length} warehouse(s).`,
      alert_id: alertId,
      notified_pharmacies: affectedPharmacies.length,
      notified_warehouses: affectedWarehouses.length,
    });

  } catch (error) {
    console.error('declareNSQ error:', error);
    try { if (connection) await connection.rollback(); } catch (_) {}
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  } finally {
    if (connection) await connection.end();
  }
}
