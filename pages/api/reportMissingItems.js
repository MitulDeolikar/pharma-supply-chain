import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');

// POST /api/reportMissingItems
// Body: { request_id, request_type, pharmacy_id, pharmacy_name, missing_items }
// missing_items: [{ medicine_id, medicine_name, batch_number, dispatched_qty, received_qty }]
// Called alongside (not instead of) confirmOrderReceipt when the pharmacy flags discrepancies

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { request_id, request_type, pharmacy_id, pharmacy_name, missing_items } = req.body;

  if (!request_id || !request_type || !pharmacy_id || !Array.isArray(missing_items) || missing_items.length === 0) {
    return res.status(400).json({ success: false, message: 'request_id, request_type, pharmacy_id, and missing_items are required' });
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    // Ensure discrepancy_reports table exists for persistent querying
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS order_discrepancy_reports (
        id             INT PRIMARY KEY AUTO_INCREMENT,
        request_id     INT NOT NULL,
        request_type   VARCHAR(20) NOT NULL,
        pharmacy_id    INT NOT NULL,
        reported_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved       TINYINT(1) NOT NULL DEFAULT 0,
        resolved_at    TIMESTAMP NULL,
        missing_items  JSON NOT NULL,
        INDEX idx_request  (request_id, request_type),
        INDEX idx_pharmacy (pharmacy_id),
        INDEX idx_resolved (resolved)
      )
    `);

    const [result] = await conn.execute(
      `INSERT INTO order_discrepancy_reports (request_id, request_type, pharmacy_id, missing_items)
       VALUES (?, ?, ?, ?)`,
      [request_id, request_type, pharmacy_id, JSON.stringify(missing_items)]
    );
    const report_id = result.insertId;

    const totalDispatched = missing_items.reduce((s, i) => s + Number(i.dispatched_qty || 0), 0);
    const totalReceived   = missing_items.reduce((s, i) => s + Number(i.received_qty  || 0), 0);
    const shortfall       = totalDispatched - totalReceived;

    const itemsSummary = missing_items.map(i =>
      `${i.medicine_name || 'Medicine #' + i.medicine_id}: dispatched ${i.dispatched_qty}, received ${i.received_qty}`
    ).join('; ');

    logActivity({
      actor_type: 'pharmacy',
      actor_id:   pharmacy_id,
      actor_name: pharmacy_name || `Pharmacy #${pharmacy_id}`,
      action:     'MISSING_ITEMS_REPORTED',
      entity_type: request_type === 'demand' ? 'demand_request' : 'emergency_request',
      entity_id:  request_id,
      description: `${pharmacy_name || 'Pharmacy #' + pharmacy_id} reported missing items on ${request_type} order #${request_id} — ${shortfall} unit(s) short: ${itemsSummary}`,
      metadata: { report_id, request_type, shortfall, missing_items },
    }).catch(() => {});

    return res.status(200).json({ success: true, report_id });

  } catch (err) {
    console.error('reportMissingItems error:', err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.end();
  }
}
