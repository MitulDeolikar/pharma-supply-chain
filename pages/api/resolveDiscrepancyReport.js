import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');

// POST /api/resolveDiscrepancyReport
// Body: { report_id, cmo_id, cmo_name }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { report_id, cmo_id, cmo_name } = req.body;
  if (!report_id) return res.status(400).json({ success: false, message: 'report_id is required' });

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    await conn.execute(
      `UPDATE order_discrepancy_reports SET resolved = 1, resolved_at = NOW() WHERE id = ?`,
      [report_id]
    );

    logActivity({
      actor_type: 'cmo', actor_id: cmo_id || 1, actor_name: cmo_name || 'CMO',
      action: 'DISCREPANCY_RESOLVED', entity_type: 'discrepancy_report', entity_id: report_id,
      description: `CMO resolved discrepancy report #${report_id}`,
      metadata: { report_id },
    }).catch(() => {});

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('resolveDiscrepancyReport error:', err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.end();
  }
}
