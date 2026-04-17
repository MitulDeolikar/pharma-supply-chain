import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');

// Generate a random 6-digit alphanumeric disposal token
function generateDisposalToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 6; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  let connection;
  try {
    const { pharmacy_id, stock_ids, remarks, evidence_img } = req.body;

    if (!pharmacy_id || !stock_ids || stock_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'pharmacy_id and stock_ids are required'
      });
    }

    connection = await mysql.createConnection(dbConfig);

    // Generate unique disposal token
    const disposal_token = generateDisposalToken();

    // Create disposal request
    const [result] = await connection.execute(
      `INSERT INTO pharmacy_disposal_request 
       (pharmacy_id, remarks, disposal_token, evidence_img, status) 
       VALUES (?, ?, ?, ?, 'pending')`,
      [pharmacy_id, remarks || '', disposal_token, evidence_img || null]
    );

    const request_id = result.insertId;

    // Link stock items to disposal request
    for (const stock_id of stock_ids) {
      await connection.execute(
        `INSERT INTO disposal_stock_items (stock_id, request_id) VALUES (?, ?)`,
        [stock_id, request_id]
      );
    }

    await connection.end();

    logActivity({
      actor_type: 'pharmacy', actor_id: pharmacy_id, actor_name: `Pharmacy #${pharmacy_id}`,
      action: 'DISPOSAL_REQUEST_CREATED', entity_type: 'disposal_request', entity_id: request_id,
      description: `Pharmacy #${pharmacy_id} created disposal request #${request_id} for ${stock_ids.length} stock item(s)`,
      metadata: { stock_ids, disposal_token, remarks }
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: 'Disposal request created successfully',
      request_id,
      disposal_token,
      status: 'pending'
    });

  } catch (error) {
    console.error('Error creating disposal request:', error);
    if (connection) await connection.end();
    res.status(500).json({
      success: false,
      message: 'Error creating disposal request',
      error: error.message
    });
  }
}
