import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const connection = await mysql.createConnection(dbConfig);

  try {
    const { batch_id } = req.body;

    if (!batch_id) {
      await connection.end();
      return res.status(400).json({ error: "batch_id is required" });
    }

    // Get all stock_ids from disposal_stock_items for this batch's requests
    const [stockItems] = await connection.execute(
      `SELECT DISTINCT dsi.stock_id 
       FROM disposal_stock_items dsi
       INNER JOIN pharmacy_disposal_request pdr ON dsi.request_id = pdr.request_id
       WHERE pdr.batch_id = ?`,
      [batch_id]
    );

    // Delete those stocks from stock table
    if (stockItems.length > 0) {
      const stockIds = stockItems.map(item => item.stock_id);
      const placeholders = stockIds.map(() => '?').join(',');
      
      await connection.execute(
        `DELETE FROM stock WHERE stock_id IN (${placeholders})`,
        stockIds
      );
    }

    // Delete disposal stock items for this batch's requests
    await connection.execute(
      `DELETE FROM disposal_stock_items 
       WHERE request_id IN (
         SELECT request_id FROM pharmacy_disposal_request WHERE batch_id = ?
       )`,
      [batch_id]
    );

    // Update all requests in this batch to completed status
    const [result] = await connection.execute(
      `UPDATE pharmacy_disposal_request SET status = ? WHERE batch_id = ?`,
      ['completed', batch_id]
    );

    if (result.affectedRows === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    await connection.end();

    logActivity({
      actor_type: 'warehouse', actor_id: 1, actor_name: 'Warehouse',
      action: 'DISPOSAL_BATCH_COMPLETED', entity_type: 'disposal_batch', entity_id: batch_id,
      description: `Disposal batch #${batch_id} completed — ${stockItems.length} expired stock item(s) physically destroyed and removed`,
      metadata: { stocks_deleted: stockItems.length }
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "Batch marked as completed successfully. Stocks deleted from pharmacy inventory.",
      batch_id: batch_id,
      stocks_deleted: stockItems.length
    });
  } catch (error) {
    console.error("Error marking batch as completed:", error);
    res.status(500).json({ error: "Failed to mark batch as completed" });
  } finally {
    if (connection) await connection.end();
  }
}
