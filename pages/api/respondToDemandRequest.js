import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, invalidatePattern, publish } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { requestId, action, remarks = '', comments = '' } = req.body;

  if (!requestId || !action) {
    return res.status(400).json({ 
      success: false, 
      message: 'Request ID and action are required' 
    });
  }

  if (!['approve', 'reject', 'revoke'].includes(action)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid action. Must be approve, reject, or revoke' 
    });
  }

  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);

    // Start transaction
    await connection.beginTransaction();

    // Check if request exists and get current status
    const [requestCheck] = await connection.execute(
      'SELECT request_id, status, pharmacy_id FROM pharmacy_demand_request WHERE request_id = ?',
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
      case 'approve':
        if (currentStatus !== 'pending' && currentStatus !== 'rejected') {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: 'Request can only be approved if pending or rejected'
          });
        }
        newStatus = 'approved';
        message = 'Demand request approved successfully';
        break;

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

    // Update the request status and comments
    await connection.execute(
      'UPDATE pharmacy_demand_request SET status = ?, comments_from_approver = ? WHERE request_id = ?',
      [newStatus, comments || null, requestId]
    );

    // If there are remarks, you might want to store them (optional)
    if (remarks) {
      await connection.execute(
        'UPDATE pharmacy_demand_request SET remarks = CONCAT(COALESCE(remarks, ""), " - CMO: ", ?) WHERE request_id = ?',
        [remarks, requestId]
      );
    }

    // Commit transaction
    await connection.commit();

    invalidate('demand_requests:all');
    invalidatePattern('analytics:cmo:*');
    publish('pharma:events', { type: 'demand:responded', request_id: requestId, pharmacy_id: requestCheck[0].pharmacy_id, action: newStatus });

    logActivity({
      actor_type: 'cmo', actor_id: 1, actor_name: 'CMO',
      action: action === 'approve' ? 'DEMAND_REQUEST_APPROVED' : action === 'reject' ? 'DEMAND_REQUEST_REJECTED' : 'DEMAND_REQUEST_REJECTION_REVOKED',
      entity_type: 'demand_request', entity_id: requestId,
      description: action === 'approve'
        ? `CMO approved demand request #${requestId}${comments ? ': ' + comments : ''}`
        : action === 'reject'
          ? `CMO rejected demand request #${requestId}${comments ? ': ' + comments : ''}`
          : `CMO revoked rejection on demand request #${requestId}`,
      metadata: { comments, remarks }
    }).catch(() => {});

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
    
    console.error('Error processing demand request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process demand request',
      error: error.message
    });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}