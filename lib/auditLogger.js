const mysql = require('mysql2/promise');
const dbConfig = require('../middleware/dbConfig.js');

async function logActivity({ actor_type, actor_id, actor_name, action, entity_type, entity_id, description, metadata }) {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

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
    // Migrate actor_type from ENUM to VARCHAR if needed (safe on VARCHAR, no-op if already correct)
    try {
      await conn.execute(`ALTER TABLE audit_log MODIFY COLUMN actor_type VARCHAR(20) NOT NULL`);
    } catch (_) { /* ignore if already VARCHAR or column doesn't exist */ }

    await conn.execute(
      `INSERT INTO audit_log (actor_type, actor_id, actor_name, action, entity_type, entity_id, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor_type,
        actor_id,
        actor_name || null,
        action,
        entity_type || null,
        entity_id   || null,
        description || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (err) {
    console.warn('[auditLogger] Failed to log activity:', err.message);
  } finally {
    if (conn) await conn.end();
  }
}

/**
 * Log a successful login event to the login_log table.
 * Fire-and-forget — never throws.
 */
async function logLogin({ user_type, user_id, user_name }) {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS login_log (
        id         INT PRIMARY KEY AUTO_INCREMENT,
        user_type  VARCHAR(20) NOT NULL,
        user_id    INT NOT NULL,
        user_name  VARCHAR(150),
        login_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_login_at (login_at),
        INDEX idx_user     (user_type, user_id)
      )
    `);

    await conn.execute(
      `INSERT INTO login_log (user_type, user_id, user_name) VALUES (?, ?, ?)`,
      [user_type, user_id, user_name || null]
    );
  } catch (err) {
    console.warn('[auditLogger] Failed to log login:', err.message);
  } finally {
    if (conn) await conn.end();
  }
}

module.exports = { logActivity, logLogin };
