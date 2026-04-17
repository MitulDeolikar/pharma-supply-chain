import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

// GET /api/fetchNSQNotifications?pharmacy_id=X
// Returns all NSQ notifications for a pharmacy with unread count

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { pharmacy_id } = req.query;
  if (!pharmacy_id) {
    return res.status(400).json({ success: false, message: 'pharmacy_id is required' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    const [notifications] = await connection.execute(`
      SELECT
        npn.id,
        npn.alert_id,
        npn.is_read,
        npn.created_at AS notified_at,
        na.batch_number,
        na.medicine_id,
        na.medicine_name,
        na.message,
        na.created_at  AS declared_at,
        c.name         AS declared_by,
        -- current quantity this pharmacy holds of this batch
        COALESCE(SUM(s.quantity), 0) AS current_quantity
      FROM nsq_pharmacy_notifications npn
      JOIN nsq_alerts na ON na.alert_id = npn.alert_id
      LEFT JOIN cmo c ON c.cmo_id = na.declared_by_cmo_id
      LEFT JOIN stock s ON s.pharmacy_id = npn.pharmacy_id
                        AND s.batch_number = na.batch_number
                        AND s.medicine_id  = na.medicine_id
      WHERE npn.pharmacy_id = ?
      GROUP BY npn.id
      ORDER BY npn.is_read ASC, npn.created_at DESC
    `, [pharmacy_id]);

    const unread_count = notifications.filter(n => !n.is_read).length;

    return res.status(200).json({ success: true, notifications, unread_count });

  } catch (error) {
    console.error('fetchNSQNotifications error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  } finally {
    if (connection) await connection.end();
  }
}
