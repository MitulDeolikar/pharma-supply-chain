import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

// GET /api/fetchDiscrepancyReports?resolved=0
// Returns all unresolved order discrepancy reports for CMO dashboard

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { resolved = '0' } = req.query;

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    // Table may not exist yet if no discrepancies have been reported
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

    const [rows] = await conn.query(
      `SELECT dr.id, dr.request_id, dr.request_type, dr.pharmacy_id,
              p.pharmacy_name, dr.reported_at, dr.resolved, dr.resolved_at,
              dr.missing_items
       FROM order_discrepancy_reports dr
       JOIN pharmacy p ON p.pharmacy_id = dr.pharmacy_id
       WHERE dr.resolved = ?
       ORDER BY dr.reported_at DESC
       LIMIT 50`,
      [resolved === '1' ? 1 : 0]
    );

    return res.status(200).json({ success: true, reports: rows });
  } catch (err) {
    console.error('fetchDiscrepancyReports error:', err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.end();
  }
}
