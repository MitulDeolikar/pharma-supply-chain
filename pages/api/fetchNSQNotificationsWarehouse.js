import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

// GET /api/fetchNSQNotificationsWarehouse?warehouse_id=X
// Returns all NSQ notifications for a warehouse with unread count

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { warehouse_id } = req.query;
  if (!warehouse_id) {
    return res.status(400).json({ success: false, message: 'warehouse_id is required' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    // Ensure table exists
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

    const [notifications] = await connection.execute(`
      SELECT
        nwn.id,
        nwn.alert_id,
        nwn.is_read,
        nwn.created_at AS notified_at,
        na.batch_number,
        na.medicine_id,
        na.medicine_name,
        na.message,
        na.created_at  AS declared_at,
        c.name         AS declared_by,
        COALESCE(SUM(s.quantity), 0) AS current_quantity
      FROM nsq_warehouse_notifications nwn
      JOIN nsq_alerts na ON na.alert_id = nwn.alert_id
      LEFT JOIN cmo c ON c.cmo_id = na.declared_by_cmo_id
      LEFT JOIN stock s ON s.warehouse_id = nwn.warehouse_id
                        AND s.batch_number = na.batch_number
                        AND s.medicine_id  = na.medicine_id
      WHERE nwn.warehouse_id = ?
      GROUP BY nwn.id
      ORDER BY nwn.is_read ASC, nwn.created_at DESC
    `, [warehouse_id]);

    const unread_count = notifications.filter(n => !n.is_read).length;

    return res.status(200).json({ success: true, notifications, unread_count });

  } catch (error) {
    console.error('fetchNSQNotificationsWarehouse error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  } finally {
    if (connection) await connection.end();
  }
}
