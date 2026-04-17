import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, invalidatePattern, publish } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { requestId, action, remarks } = req.body;

    if (!requestId || !action) {
      return res.status(400).json({ 
        success: false, 
        message: 'Request ID and action are required' 
      });
    }

    if (!['reject', 'revoke'].includes(action)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Action must be either "reject" or "revoke"' 
      });
    }

    const connection = await mysql.createConnection(dbConfig);

    // Start transaction
    await connection.beginTransaction();

    try {
      // First, verify that the request exists and check current status
      const [requestCheck] = await connection.execute(`
        SELECT request_id, pharmacy_id, status, remarks
        FROM pharmacy_emergency_requests
        WHERE request_id = ?
      `, [requestId]);

      if (requestCheck.length === 0) {
        await connection.rollback();
        await connection.end();
        return res.status(404).json({ 
          success: false, 
          message: 'Emergency request not found' 
        });
      }

      const currentStatus = requestCheck[0].status;

      // Validate action based on current status
      if (action === 'reject') {
        // Can only reject if status is pending_approval_from_cmo
        if (currentStatus !== 'pending_approval_from_cmo') {
          await connection.rollback();
          await connection.end();
          return res.status(400).json({ 
            success: false, 
            message: `Cannot reject request with status: ${currentStatus}. Only requests with status "pending_approval_from_cmo" can be rejected.` 
          });
        }
      } else if (action === 'revoke') {
        // Can only revoke if status is rejected
        if (currentStatus !== 'rejected') {
          await connection.rollback();
          await connection.end();
          return res.status(400).json({ 
            success: false, 
            message: `Cannot revoke rejection for request with status: ${currentStatus}. Only rejected requests can be revoked.` 
          });
        }
      }

      // Update the request based on action
      let newStatus, updateMessage;
      if (action === 'reject') {
        newStatus = 'rejected';
        updateMessage = 'Emergency request rejected successfully';
      } else {
        newStatus = 'pending_approval_from_cmo';
        updateMessage = 'Emergency request rejection revoked successfully';
      }

      const [updateResult] = await connection.execute(`
        UPDATE pharmacy_emergency_requests 
        SET status = ?, remarks = ?
        WHERE request_id = ?
      `, [newStatus, remarks || requestCheck[0].remarks, requestId]);

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        await connection.end();
        return res.status(400).json({ 
          success: false, 
          message: 'Failed to update emergency request' 
        });
      }

      await connection.commit();
      await connection.end();

      invalidate('emergency_requests:all');
      invalidatePattern('analytics:cmo:*');
      publish('pharma:events', { type: 'emergency:rejected', request_id: requestId, pharmacy_id: requestCheck[0].pharmacy_id, action });

      logActivity({
        actor_type: 'cmo', actor_id: 1, actor_name: 'CMO',
        action: action === 'reject' ? 'EMERGENCY_REQUEST_REJECTED' : 'EMERGENCY_REQUEST_REJECTION_REVOKED',
        entity_type: 'emergency_request', entity_id: requestId,
        description: action === 'reject'
          ? `CMO rejected emergency request #${requestId}${remarks ? ': ' + remarks : ''}`
          : `CMO revoked rejection on emergency request #${requestId}`,
        metadata: { remarks }
      }).catch(() => {});

      res.status(200).json({
        success: true,
        message: updateMessage,
        data: {
          requestId,
          newStatus,
          action
        }
      });

    } catch (transactionError) {
      await connection.rollback();
      await connection.end();
      throw transactionError;
    }

  } catch (error) {
    console.error('Error processing emergency request:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while processing request'
    });
  }
}