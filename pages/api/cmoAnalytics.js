import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

// GET /api/cmoAnalytics?period=30
// Comprehensive analytics for CMO dashboard
// period = number of days to look back (default 30)

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const period = parseInt(req.query.period || '30', 10);

  try {
    const analyticsData = await getOrSet(`analytics:cmo:${period}`, 900, async () => {
      let connection;
      try {
        connection = await mysql.createConnection(dbConfig);

    // ─── 1. OVERVIEW STATS ───────────────────────────────────────────────────
    const [[overview]] = await connection.execute(`
      SELECT
        (SELECT COUNT(*) FROM pharmacy_emergency_requests
          WHERE request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS total_emergency,

        (SELECT COUNT(*) FROM pharmacy_emergency_requests
          WHERE request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
            AND status IN ('order_successful','order_recieved')) AS emergency_fulfilled,

        (SELECT COUNT(*) FROM pharmacy_emergency_requests
          WHERE request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
            AND status = 'rejected') AS emergency_rejected,

        (SELECT COUNT(*) FROM pharmacy_demand_request
          WHERE request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS total_demand,

        (SELECT COUNT(*) FROM pharmacy_demand_request
          WHERE request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
            AND status IN ('order_successful','order_recieved')) AS demand_fulfilled,

        (SELECT COALESCE(SUM(peri.quantity_requested), 0)
          FROM pharmacy_emergency_request_items peri
          JOIN pharmacy_emergency_requests per ON peri.request_id = per.request_id
          WHERE per.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS total_emergency_qty,

        (SELECT COALESCE(SUM(pdri.quantity_requested), 0)
          FROM pharmacy_demand_request_items pdri
          JOIN pharmacy_demand_request pdr ON pdri.request_id = pdr.request_id
          WHERE pdr.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS total_demand_qty,

        (SELECT COUNT(*) FROM pharmacy_disposal_request
          WHERE request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS total_disposal,

        (SELECT COUNT(DISTINCT pharmacy_id) FROM pharmacy_emergency_requests
          WHERE request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS active_pharmacies
    `, Array(9).fill(period));

    // ─── 2. PER-PHARMACY ACTIVITY ────────────────────────────────────────────
    const [pharmacyActivity] = await connection.execute(`
      SELECT
        p.pharmacy_id,
        p.pharmacy_name,
        p.district,
        p.block,

        -- Emergency requests created by this pharmacy
        COUNT(DISTINCT er_sent.request_id) AS emergency_sent_count,
        COALESCE(SUM(er_sent_items.quantity_requested), 0) AS emergency_sent_qty,

        -- Emergency requests this pharmacy fulfilled for others
        COUNT(DISTINCT er_fulfilled.request_id) AS emergency_fulfilled_count,
        COALESCE(SUM(er_fulfilled_items.quantity_requested), 0) AS emergency_fulfilled_qty,

        -- Demand requests created by this pharmacy
        COUNT(DISTINCT dr.request_id) AS demand_request_count,
        COALESCE(SUM(dr_items.quantity_requested), 0) AS demand_qty,

        -- Demand requests received (stock received from warehouse)
        COUNT(DISTINCT dr_received.request_id) AS demand_received_count,

        -- Disposal requests
        COUNT(DISTINCT disp.request_id) AS disposal_count

      FROM pharmacy p

      LEFT JOIN pharmacy_emergency_requests er_sent
        ON er_sent.pharmacy_id = p.pharmacy_id
        AND er_sent.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)

      LEFT JOIN pharmacy_emergency_request_items er_sent_items
        ON er_sent_items.request_id = er_sent.request_id

      LEFT JOIN pharmacy_emergency_requests er_fulfilled
        ON er_fulfilled.accepting_pharmacy_id = p.pharmacy_id
        AND er_fulfilled.status IN ('order_successful','order_recieved')
        AND er_fulfilled.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)

      LEFT JOIN pharmacy_emergency_request_items er_fulfilled_items
        ON er_fulfilled_items.request_id = er_fulfilled.request_id

      LEFT JOIN pharmacy_demand_request dr
        ON dr.pharmacy_id = p.pharmacy_id
        AND dr.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)

      LEFT JOIN pharmacy_demand_request_items dr_items
        ON dr_items.request_id = dr.request_id

      LEFT JOIN pharmacy_demand_request dr_received
        ON dr_received.pharmacy_id = p.pharmacy_id
        AND dr_received.status IN ('order_successful','order_recieved')
        AND dr_received.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)

      LEFT JOIN pharmacy_disposal_request disp
        ON disp.pharmacy_id = p.pharmacy_id
        AND disp.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)

      GROUP BY p.pharmacy_id
      ORDER BY (COUNT(DISTINCT er_sent.request_id) + COUNT(DISTINCT dr.request_id)) DESC
    `, Array(5).fill(period));

    // ─── 3. INTER-PHARMACY EXCHANGES ─────────────────────────────────────────
    const [exchanges] = await connection.execute(`
      SELECT
        requester.pharmacy_name AS requester_name,
        requester.pharmacy_id  AS requester_id,
        supplier.pharmacy_name AS supplier_name,
        supplier.pharmacy_id   AS supplier_id,
        COUNT(DISTINCT er.request_id) AS request_count,
        COALESCE(SUM(peri.quantity_requested), 0) AS total_qty,
        GROUP_CONCAT(DISTINCT m.name ORDER BY m.name SEPARATOR ', ') AS medicines_list
      FROM pharmacy_emergency_requests er
      JOIN pharmacy requester ON er.pharmacy_id = requester.pharmacy_id
      JOIN pharmacy supplier  ON er.accepting_pharmacy_id = supplier.pharmacy_id
      JOIN pharmacy_emergency_request_items peri ON peri.request_id = er.request_id
      LEFT JOIN medicines m ON m.medicine_id = peri.medicine_id
      WHERE er.status IN ('order_successful','order_recieved')
        AND er.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY er.pharmacy_id, er.accepting_pharmacy_id
      ORDER BY request_count DESC
      LIMIT 20
    `, [period]);

    // ─── 4. WAREHOUSE PERFORMANCE ────────────────────────────────────────────
    const [warehouseStats] = await connection.execute(`
      SELECT
        w.warehouse_id,
        w.name AS warehouse_name,
        w.district,

        -- Demand requests dispatched
        COUNT(DISTINCT dr.request_id) AS demand_dispatched,
        COALESCE(SUM(dr_items.quantity_requested), 0) AS demand_medicines_supplied,

        -- Emergency requests dispatched via warehouse
        COUNT(DISTINCT er.request_id) AS emergency_dispatched,
        COALESCE(SUM(er_items.quantity_requested), 0) AS emergency_medicines_supplied,

        -- Disposal batches handled
        COUNT(DISTINCT db.batch_id) AS disposal_batches_handled

      FROM warehouse w

      LEFT JOIN pharmacy_demand_request dr
        ON dr.accepting_warehouse_id = w.warehouse_id
        AND dr.status IN ('order_successful','order_recieved')
        AND dr.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)

      LEFT JOIN pharmacy_demand_request_items dr_items
        ON dr_items.request_id = dr.request_id

      LEFT JOIN pharmacy_emergency_requests er
        ON er.accepting_warehouse_id = w.warehouse_id
        AND er.status IN ('order_successful','order_recieved')
        AND er.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)

      LEFT JOIN pharmacy_emergency_request_items er_items
        ON er_items.request_id = er.request_id

      LEFT JOIN disposal_batch db
        ON db.warehouse_id = w.warehouse_id
        AND db.status = 'completed'
        AND db.created_date >= DATE_SUB(NOW(), INTERVAL ? DAY)

      GROUP BY w.warehouse_id
      ORDER BY demand_dispatched DESC
    `, Array(3).fill(period));

    // ─── 5. TOP REQUESTED MEDICINES (Emergency + Demand combined) ────────────
    const [topMedicines] = await connection.execute(`
      SELECT
        m.medicine_id,
        m.name AS medicine_name,
        m.dosage,
        m.unit,
        gm.generic_name,
        gm.category,
        SUM(qty) AS total_qty_requested,
        COUNT(*) AS total_requests,
        SUM(CASE WHEN req_type='emergency' THEN qty ELSE 0 END) AS emergency_qty,
        SUM(CASE WHEN req_type='demand' THEN qty ELSE 0 END) AS demand_qty
      FROM (
        SELECT peri.medicine_id, peri.quantity_requested AS qty, 'emergency' AS req_type
        FROM pharmacy_emergency_request_items peri
        JOIN pharmacy_emergency_requests per ON peri.request_id = per.request_id
        WHERE per.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND peri.medicine_id IS NOT NULL

        UNION ALL

        SELECT pdri.medicine_id, pdri.quantity_requested AS qty, 'demand' AS req_type
        FROM pharmacy_demand_request_items pdri
        JOIN pharmacy_demand_request pdr ON pdri.request_id = pdr.request_id
        WHERE pdr.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND pdri.medicine_id IS NOT NULL
      ) AS combined
      JOIN medicines m ON m.medicine_id = combined.medicine_id
      LEFT JOIN generic_medicines gm ON gm.generic_id = m.generic_id
      GROUP BY m.medicine_id
      ORDER BY total_qty_requested DESC
      LIMIT 15
    `, [period, period]);

    // ─── 6. REQUEST STATUS BREAKDOWN ─────────────────────────────────────────
    const [emergencyStatusRows] = await connection.execute(`
      SELECT status, COUNT(*) AS count
      FROM pharmacy_emergency_requests
      WHERE request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY status
    `, [period]);

    const [demandStatusRows] = await connection.execute(`
      SELECT status, COUNT(*) AS count
      FROM pharmacy_demand_request
      WHERE request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY status
    `, [period]);

    const emergencyStatus = {};
    emergencyStatusRows.forEach(r => { emergencyStatus[r.status] = r.count; });
    const demandStatus = {};
    demandStatusRows.forEach(r => { demandStatus[r.status] = r.count; });

    // ─── 7. MONTHLY TREND (last 6 months) ────────────────────────────────────
    const [emergencyTrend] = await connection.execute(`
      SELECT DATE_FORMAT(request_date, '%Y-%m') AS month, COUNT(*) AS count
      FROM pharmacy_emergency_requests
      WHERE request_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY month ORDER BY month
    `);

    const [demandTrend] = await connection.execute(`
      SELECT DATE_FORMAT(request_date, '%Y-%m') AS month, COUNT(*) AS count
      FROM pharmacy_demand_request
      WHERE request_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY month ORDER BY month
    `);

    // Merge trends by month
    const trendMap = {};
    emergencyTrend.forEach(r => {
      trendMap[r.month] = { month: r.month, emergency: r.count, demand: 0 };
    });
    demandTrend.forEach(r => {
      if (!trendMap[r.month]) trendMap[r.month] = { month: r.month, emergency: 0, demand: 0 };
      trendMap[r.month].demand = r.count;
    });
    const monthlyTrend = Object.values(trendMap).sort((a, b) => a.month.localeCompare(b.month));

    // ─── 8. RECENT ACTIVITY FEED ─────────────────────────────────────────────
    const [recentActivity] = await connection.execute(`
      SELECT
        'emergency' AS type,
        er.request_id,
        er.status,
        er.request_date AS event_date,
        p.pharmacy_name,
        NULL AS warehouse_name
      FROM pharmacy_emergency_requests er
      JOIN pharmacy p ON er.pharmacy_id = p.pharmacy_id
      WHERE er.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)

      UNION ALL

      SELECT
        'demand' AS type,
        dr.request_id,
        dr.status,
        dr.request_date AS event_date,
        p.pharmacy_name,
        w.name AS warehouse_name
      FROM pharmacy_demand_request dr
      JOIN pharmacy p ON dr.pharmacy_id = p.pharmacy_id
      LEFT JOIN warehouse w ON dr.accepting_warehouse_id = w.warehouse_id
      WHERE dr.request_date >= DATE_SUB(NOW(), INTERVAL ? DAY)

      ORDER BY event_date DESC
      LIMIT 20
    `, [period, period]);

        return {
          overview,
          pharmacyActivity,
          exchanges,
          warehouseStats,
          topMedicines,
          statusBreakdown: { emergency: emergencyStatus, demand: demandStatus },
          monthlyTrend,
          recentActivity,
        };
      } finally {
        if (connection) await connection.end();
      }
    });

    return res.status(200).json({
      success: true,
      period,
      ...analyticsData,
    });

  } catch (error) {
    console.error('CMO analytics error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
}
