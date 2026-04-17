import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const connection = await mysql.createConnection(dbConfig);

  try {
    const { warehouse_id, batch_id } = req.query;

    // If batch_id is provided, fetch single batch
    if (batch_id) {
      const [batchRows] = await connection.execute(`
        SELECT 
          batch_id,
          created_date,
          status
        FROM disposal_batch
        WHERE batch_id = ?
      `, [batch_id]);

      if (batchRows.length === 0) {
        await connection.end();
        return res.status(404).json({ success: false, message: "Batch not found" });
      }

      const batch = batchRows[0];

      const [requests] = await connection.execute(`
        SELECT 
          pdr.request_id,
          pdr.pharmacy_id,
          pdr.disposal_token,
          pdr.status,
          pdr.request_date,
          p.pharmacy_name,
          p.address,
          p.district,
          (SELECT COUNT(*) FROM disposal_stock_items WHERE request_id = pdr.request_id) as item_count
        FROM pharmacy_disposal_request pdr
        JOIN pharmacy p ON pdr.pharmacy_id = p.pharmacy_id
        WHERE pdr.batch_id = ?
      `, [batch.batch_id]);

      await connection.end();

      return res.status(200).json({
        success: true,
        batch: {
          batch_id: batch.batch_id,
          created_date: batch.created_date,
          status: batch.status,
          requests: requests
        }
      });
    }

    if (!warehouse_id) {
      await connection.end();
      return res.status(400).json({ error: "warehouse_id or batch_id is required" });
    }

    // Get all disposal batches with their requests
    const [batches] = await connection.execute(`
      SELECT 
        db.batch_id,
        db.created_date,
        db.status,
        COUNT(DISTINCT pdr.request_id) as request_count
      FROM disposal_batch db
      LEFT JOIN pharmacy_disposal_request pdr ON db.batch_id = pdr.batch_id
      GROUP BY db.batch_id, db.created_date, db.status
      ORDER BY db.created_date DESC
      LIMIT 50
    `);

    if (batches.length === 0) {
      return res.status(200).json({
        success: true,
        batches: [],
      });
    }

    // For each batch, get detailed request info
    const detailedBatches = [];

    for (const batch of batches) {
      const [requests] = await connection.execute(`
        SELECT 
          pdr.request_id,
          pdr.pharmacy_id,
          pdr.disposal_token,
          pdr.status,
          pdr.request_date,
          p.pharmacy_name,
          p.address,
          (SELECT COUNT(*) FROM disposal_stock_items WHERE request_id = pdr.request_id) as item_count
        FROM pharmacy_disposal_request pdr
        JOIN pharmacy p ON pdr.pharmacy_id = p.pharmacy_id
        WHERE pdr.batch_id = ?
      `, [batch.batch_id]);

      const batchStatus =
        requests.length > 0 && requests.every((r) => r.status === "completed")
          ? "completed"
          : requests.length > 0 && requests.some((r) => r.status === "in_progress")
          ? "in_progress"
          : "pending";

      detailedBatches.push({
        batch_id: batch.batch_id,
        created_date: batch.created_date,
        status: batchStatus,
        requests: requests,
        request_count: requests.length
      });
    }

    res.status(200).json({
      success: true,
      batches: detailedBatches,
    });
  } catch (error) {
    console.error("Error getting disposal batches:", error);
    res.status(500).json({ error: "Failed to fetch disposal batches" });
  } finally {
    await connection.end();
  }
}
