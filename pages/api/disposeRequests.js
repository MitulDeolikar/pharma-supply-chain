import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const connection = await mysql.createConnection(dbConfig);

  try {
    const { batch_id, selected_requests } = req.body;

    if (!batch_id || !selected_requests || selected_requests.length === 0) {
      return res.status(400).json({ error: "Batch ID and requests are required" });
    }

    // Update request status to completed
    const placeholders = selected_requests.map(() => "?").join(",");
    await connection.execute(
      `UPDATE pharmacy_disposal_request
       SET status = 'completed'
       WHERE batch_id = ? AND request_id IN (${placeholders})`,
      [batch_id, ...selected_requests]
    );

    res.status(200).json({
      success: true,
      message: `${selected_requests.length} request(s) marked as disposed successfully`,
    });
  } catch (error) {
    console.error("Error disposing requests:", error);
    res.status(500).json({ error: "Failed to dispose requests" });
  } finally {
    await connection.end();
  }
}
