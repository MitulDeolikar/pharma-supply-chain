const { getRequestHistoryFromBlockchain } = require('./blockchainHelper');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { requestId } = req.query;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: 'Request ID is required'
      });
    }

    const result = await getRequestHistoryFromBlockchain(requestId);

    if (result.success) {
      // Map blockchain state numbers to readable status
      const statusNames = {
        0: 'Created',
        1: 'Pending CMO Approval',
        2: 'Approved',
        3: 'Order Sent',
        4: 'Order Successful',
        5: 'Order Received',
        6: 'Rejected'
      };

      const enrichedHistory = result.history.map(record => ({
        ...record,
        statusName: statusNames[record.state] || 'Unknown',
        dateTime: new Date(record.timestamp * 1000).toLocaleString()
      }));

      return res.status(200).json({
        success: true,
        requestId: parseInt(requestId),
        totalRecords: enrichedHistory.length,
        history: enrichedHistory
      });
    } else {
      return res.status(500).json({
        success: false,
        message: result.error || 'Failed to fetch blockchain history'
      });
    }
  } catch (error) {
    console.error('Error in getBlockchainHistory:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
}
