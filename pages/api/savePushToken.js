import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

const VALID_TYPES = ['pharmacy', 'cmo', 'doctor', 'patient', 'warehouse'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { user_type, user_id, fcm_token } = req.body;
  if (!user_type || !user_id || !fcm_token) {
    return res.status(400).json({ success: false, message: 'user_type, user_id, fcm_token required' });
  }
  if (!VALID_TYPES.includes(user_type)) {
    return res.status(400).json({ success: false, message: 'Invalid user_type' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_type ENUM('pharmacy','cmo','doctor','patient','warehouse') NOT NULL,
        user_id INT NOT NULL,
        fcm_token VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user (user_type, user_id)
      )
    `);

    await connection.execute(
      `INSERT INTO push_tokens (user_type, user_id, fcm_token) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE fcm_token = VALUES(fcm_token), updated_at = CURRENT_TIMESTAMP`,
      [user_type, user_id, fcm_token]
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('savePushToken error:', error);
    res.status(500).json({ success: false, message: 'Failed to save token' });
  } finally {
    if (connection) await connection.end();
  }
}
