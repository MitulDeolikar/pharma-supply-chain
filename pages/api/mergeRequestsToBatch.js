import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const connection = await mysql.createConnection(dbConfig);

  try {
    const { batch_id, request_ids } = req.body;

    if (!batch_id || !request_ids || request_ids.length === 0) {
      await connection.end();
      return res.status(400).json({ error: "batch_id and request_ids are required" });
    }

    // Verify batch exists and is in_progress
    const [batches] = await connection.execute(
      `SELECT batch_id FROM disposal_batch WHERE batch_id = ? AND status = 'in_progress'`,
      [batch_id]
    );

    if (batches.length === 0) {
      await connection.end();
      return res.status(404).json({ error: "Batch not found or not in-progress" });
    }

    // Update requests to add them to this batch
    const placeholders = request_ids.map(() => '?').join(',');
    const [result] = await connection.execute(
      `UPDATE pharmacy_disposal_request 
       SET batch_id = ? 
       WHERE request_id IN (${placeholders}) AND batch_id IS NULL`,
      [batch_id, ...request_ids]
    );

    if (result.affectedRows === 0) {
      await connection.end();
      return res.status(400).json({ error: "No valid requests to add or requests already in batches" });
    }

    await connection.end();

    return res.status(200).json({
      success: true,
      message: `${result.affectedRows} request(s) added to batch successfully`,
      batch_id: batch_id,
      requests_added: result.affectedRows
    });
  } catch (error) {
    console.error("Error merging requests to batch:", error);
    res.status(500).json({ error: "Failed to merge requests to batch" });
  } finally {
    if (connection) await connection.end();
  }
}
