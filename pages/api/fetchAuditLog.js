import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

// GET /api/fetchAuditLog
// Query params: actor_type, action, entity_type, days (default 30), page, limit, include_logins (default true)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const {
    actor_type,
    action,
    entity_type,
    days = 30,
    page = 1,
    limit = 50,
    include_logins = 'true',
  } = req.query;

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    // ── Active Requests Pipeline (runs first, completely independent of audit_log) ──
    let activeRequests = [];
    try {
      const [activeEmergency] = await conn.execute(`
        SELECT
          per.request_id,
          'emergency'           AS request_type,
          per.pharmacy_id,
          p.pharmacy_name       AS requester_name,
          per.status,
          per.request_date,
          per.remarks,
          COALESCE(p2.pharmacy_name, w.name) AS assigned_to
        FROM pharmacy_emergency_requests per
        JOIN pharmacy p  ON p.pharmacy_id  = per.pharmacy_id
        LEFT JOIN pharmacy p2 ON p2.pharmacy_id = per.accepting_pharmacy_id
        LEFT JOIN warehouse w ON w.warehouse_id = per.accepting_warehouse_id
        WHERE per.status NOT IN ('order_recieved', 'rejected')
        ORDER BY per.request_date DESC
        LIMIT 20
      `);

      const [activeDemand] = await conn.execute(`
        SELECT
          pdr.request_id,
          'demand'              AS request_type,
          pdr.pharmacy_id,
          p.pharmacy_name       AS requester_name,
          pdr.status,
          pdr.request_date,
          pdr.remarks,
          w.name                AS assigned_to
        FROM pharmacy_demand_request pdr
        JOIN pharmacy p ON p.pharmacy_id = pdr.pharmacy_id
        LEFT JOIN warehouse w ON w.warehouse_id = pdr.accepting_warehouse_id
        WHERE pdr.status NOT IN ('order_recieved', 'rejected')
        ORDER BY pdr.request_date DESC
        LIMIT 20
      `);

      activeRequests = [...activeEmergency, ...activeDemand].sort(
        (a, b) => new Date(b.request_date) - new Date(a.request_date)
      );
    } catch (pipelineErr) {
      console.error('[fetchAuditLog] Active requests query failed:', pipelineErr.message);
    }

    // ── Active Prescriptions Pipeline ──
    let activePrescriptions = [];
    try {
      const [rows] = await conn.execute(`
        SELECT
          op.prescription_id,
          op.opd_number,
          pt.patient_name,
          op.doctor_id,
          d.username        AS doctor_name,
          op.pharmacy_id,
          p.pharmacy_name   AS pharmacy_name,
          op.diagnosis,
          op.NAC,
          op.created_at,
          COUNT(opm.id)     AS medicine_count
        FROM opd_prescriptions op
        LEFT JOIN opd_patients pt ON pt.opd_number = op.opd_number
        LEFT JOIN doctor d        ON d.doctor_id   = op.doctor_id
        LEFT JOIN pharmacy p      ON p.pharmacy_id = op.pharmacy_id
        LEFT JOIN opd_prescription_medicines opm ON opm.prescription_id = op.prescription_id
        WHERE op.pharmacy_id IS NULL AND op.NAC = 0
        GROUP BY op.prescription_id
        ORDER BY op.created_at DESC
        LIMIT 30
      `);
      activePrescriptions = rows;
    } catch (prescErr) {
      console.error('[fetchAuditLog] Active prescriptions query failed:', prescErr.message);
    }

    // ── Ensure audit_log table exists ──
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          INT PRIMARY KEY AUTO_INCREMENT,
        actor_type  VARCHAR(20) NOT NULL,
        actor_id    INT NOT NULL,
        actor_name  VARCHAR(150),
        action      VARCHAR(100) NOT NULL,
        entity_type VARCHAR(60),
        entity_id   INT,
        description TEXT,
        metadata    JSON,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created  (created_at),
        INDEX idx_actor    (actor_type, actor_id),
        INDEX idx_action   (action),
        INDEX idx_entity   (entity_type, entity_id)
      )
    `);
    // Migrate actor_type from ENUM to VARCHAR if the table was created before this fix
    try { await conn.execute(`ALTER TABLE audit_log MODIFY COLUMN actor_type VARCHAR(20) NOT NULL`); } catch (_) {}

    // ── Ensure login_log table exists ──
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS login_log (
        id        INT PRIMARY KEY AUTO_INCREMENT,
        user_type VARCHAR(20) NOT NULL,
        user_id   INT NOT NULL,
        user_name VARCHAR(150),
        login_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_login_at (login_at),
        INDEX idx_user     (user_type, user_id)
      )
    `);

    // ── Build audit_log WHERE clauses ──
    // Use integer literals for LIMIT/OFFSET — mysql2 prepared statements
    // throw ER_WRONG_ARGUMENTS when LIMIT/OFFSET are bound as parameters.
    const daysInt   = parseInt(days,  10) || 30;
    const limitInt  = parseInt(limit, 10) || 50;
    const pageInt   = parseInt(page,  10) || 1;
    const offsetInt = (pageInt - 1) * limitInt;

    const conditions = [`created_at >= DATE_SUB(NOW(), INTERVAL ${daysInt} DAY)`];
    const params = [];

    if (actor_type)  { conditions.push(`actor_type = ?`);  params.push(actor_type); }
    if (action)      { conditions.push(`action = ?`);      params.push(action); }
    if (entity_type) { conditions.push(`entity_type = ?`); params.push(entity_type); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [activityLogs] = await conn.query(
      `SELECT id AS log_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, description, metadata, created_at
       FROM audit_log
       ${where}
       ORDER BY created_at DESC
       LIMIT ${limitInt} OFFSET ${offsetInt}`,
      params
    );

    const [[{ total }]] = await conn.query(
      `SELECT COUNT(*) AS total FROM audit_log ${where}`,
      params
    );

    // ── Login log (last N days, matching actor_type filter if set) ──
    let loginLogs = [];
    if (include_logins !== 'false') {
      const loginConditions = [`login_at >= DATE_SUB(NOW(), INTERVAL ${daysInt} DAY)`];
      const loginParams = [];
      if (actor_type) { loginConditions.push(`user_type = ?`); loginParams.push(actor_type); }

      const [rows] = await conn.query(
        `SELECT id AS log_id, user_type AS actor_type, user_id AS actor_id, user_name AS actor_name,
                'USER_LOGIN' AS action, 'session' AS entity_type, user_id AS entity_id,
                CONCAT(COALESCE(user_name,'?'), ' (', user_type, ') logged in') AS description,
                NULL AS metadata,
                login_at AS created_at
         FROM login_log
         WHERE ${loginConditions.join(' AND ')}
         ORDER BY login_at DESC
         LIMIT 200`,
        loginParams
      );
      loginLogs = rows;
    }

    // ── Merge and sort activity + login events ──
    const allLogs = [...activityLogs, ...loginLogs].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    ).slice(0, limitInt);

    // ── Filter options ──
    const [actorTypeRows] = await conn.query(`SELECT DISTINCT actor_type FROM audit_log ORDER BY actor_type`);
    const [actionRows]    = await conn.query(`SELECT DISTINCT action FROM audit_log ORDER BY action`);
    const [loginUserTypes] = await conn.query(`SELECT DISTINCT user_type FROM login_log`);

    const actorTypesSet = new Set([
      ...actorTypeRows.map(r => r.actor_type),
      ...loginUserTypes.map(r => r.user_type),
    ]);

    return res.status(200).json({
      success: true,
      logs: allLogs,
      total: Number(total),
      page: pageInt,
      pages: Math.ceil(Number(total) / limitInt),
      active_requests: activeRequests,
      active_prescriptions: activePrescriptions,
      filter_options: {
        actor_types: [...actorTypesSet].filter(Boolean).sort(),
        actions: [...new Set([...actionRows.map(r => r.action), 'USER_LOGIN'])],
      },
    });

  } catch (err) {
    console.error('[fetchAuditLog] error:', err);
    // Even on full failure, try to return active_requests (already computed above)
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.end();
  }
}
