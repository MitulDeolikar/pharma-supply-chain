import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const connection = await mysql.createConnection(dbConfig);

  try {
    const { selected_requests, warehouse_id, optimized_route } = req.body;

    if (!selected_requests || selected_requests.length === 0) {
      return res.status(400).json({ error: "No requests selected" });
    }

    // Create disposal batch with warehouse reference (no route storage - calculated on-the-fly)
    const [batchResult] = await connection.execute(
      `INSERT INTO disposal_batch (status, warehouse_id) VALUES (?, ?)`,
      ['in_progress', warehouse_id]
    );

    const batch_id = batchResult.insertId;

    // Update disposal requests with batch_id and status to in_progress
    const placeholders = selected_requests.map(() => "?").join(",");
    await connection.execute(
      `UPDATE pharmacy_disposal_request
       SET batch_id = ?, status = 'in_progress'
       WHERE request_id IN (${placeholders})`,
      [batch_id, ...selected_requests]
    );

    logActivity({
      actor_type: 'cmo', actor_id: warehouse_id || 1, actor_name: 'CMO',
      action: 'DISPOSAL_BATCH_CREATED', entity_type: 'disposal_batch', entity_id: batch_id,
      description: `CMO created disposal batch #${batch_id} with ${selected_requests.length} disposal request(s)`,
      metadata: { selected_requests, warehouse_id }
    }).catch(() => {});

    res.status(200).json({
      success: true,
      batch_id: batch_id,
      requests_count: selected_requests.length,
      message: `Batch ${batch_id} created successfully with ${selected_requests.length} requests`,
    });
  } catch (error) {
    console.error("Error creating disposal batch:", error);
    res.status(500).json({ error: "Failed to create disposal batch" });
  } finally {
    await connection.end();
  }
}
