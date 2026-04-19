import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { notifyUsers } = require('../../lib/fcmService');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { requestId, action, remarks = '' } = req.body;

  if (!requestId || !action) {
    return res.status(400).json({ 
      success: false, 
      message: 'Request ID and action are required' 
    });
  }

  if (!['reject', 'revoke'].includes(action)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid action. Must be reject or revoke' 
    });
  }

  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);

    // Start transaction
    await connection.beginTransaction();

    // Check if request exists and get current status
    const [requestCheck] = await connection.execute(
      'SELECT request_id, pharmacy_id, status FROM pharmacy_demand_request WHERE request_id = ?',
      [requestId]
    );

    if (requestCheck.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Demand request not found'
      });
    }

    const currentStatus = requestCheck[0].status;
    let newStatus;
    let message;

    switch (action) {
      case 'reject':
        if (currentStatus !== 'pending') {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: 'Request can only be rejected if pending'
          });
        }
        newStatus = 'rejected';
        message = 'Demand request rejected successfully';
        break;

      case 'revoke':
        if (currentStatus !== 'rejected') {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: 'Can only revoke rejected requests'
          });
        }
        newStatus = 'pending';
        message = 'Demand request rejection revoked successfully';
        break;
    }

    // Update the request status
    await connection.execute(
      'UPDATE pharmacy_demand_request SET status = ? WHERE request_id = ?',
      [newStatus, requestId]
    );

    // Commit transaction
    await connection.commit();

    if (action === 'reject') {
      await notifyUsers(
        connection, 'pharmacy', [requestCheck[0].pharmacy_id],
        '❌ Demand Request Rejected',
        `Your demand request #${requestId} has been rejected by the CMO.${remarks ? ' Reason: ' + remarks : ''}`,
        { request_id: String(requestId), type: 'demand_rejected' }
      ).catch(e => console.error('FCM notify pharmacy error:', e));
    }

    res.status(200).json({
      success: true,
      message,
      requestId,
      newStatus,
      action
    });

  } catch (error) {
    // Rollback transaction on error
    if (connection) {
      await connection.rollback();
    }
    
    console.error('Error rejecting demand request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject demand request',
      error: error.message
    });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}