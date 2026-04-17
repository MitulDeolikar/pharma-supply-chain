import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

// GET /api/fetchAllBatches
// Returns all distinct (batch_number, medicine_id) combos across all pharmacy AND warehouse stocks
// with the list of holders and whether an NSQ alert already exists

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    // All distinct batches held by pharmacies OR warehouses, combined
    const [batches] = await connection.execute(`
      SELECT
        s.batch_number,
        s.medicine_id,
        m.name        AS medicine_name,
        m.dosage,
        m.unit,
        gm.generic_name,
        gm.category,
        COUNT(DISTINCT s.pharmacy_id)          AS pharmacy_count,
        COUNT(DISTINCT s.warehouse_id)         AS warehouse_count,
        SUM(s.quantity)                        AS total_qty,
        MIN(s.expiry_date)                     AS earliest_expiry,
        MAX(s.expiry_date)                     AS latest_expiry,
        AVG(s.price_per_unit)                  AS avg_price,
        MAX(CASE WHEN na.alert_id IS NOT NULL THEN 1 ELSE 0 END) AS nsq_declared
      FROM stock s
      LEFT JOIN medicines m          ON m.medicine_id  = s.medicine_id
      LEFT JOIN generic_medicines gm ON gm.generic_id  = m.generic_id
      LEFT JOIN nsq_alerts na        ON na.batch_number = s.batch_number
                                    AND na.medicine_id  = s.medicine_id
      WHERE (s.pharmacy_id IS NOT NULL OR s.warehouse_id IS NOT NULL) AND s.quantity > 0
      GROUP BY s.batch_number, s.medicine_id
      ORDER BY m.name, s.batch_number
    `);

    // For each batch, get pharmacies AND warehouses holding it
    const batchesWithHolders = await Promise.all(
      batches.map(async (batch) => {
        const [pharmacies] = await connection.execute(`
          SELECT
            p.pharmacy_id,
            p.pharmacy_name,
            p.district,
            p.block,
            s.quantity,
            s.expiry_date,
            s.stock_id
          FROM stock s
          JOIN pharmacy p ON p.pharmacy_id = s.pharmacy_id
          WHERE s.batch_number = ? AND s.medicine_id = ? AND s.pharmacy_id IS NOT NULL AND s.quantity > 0
          ORDER BY p.pharmacy_name
        `, [batch.batch_number, batch.medicine_id]);

        const [warehouses] = await connection.execute(`
          SELECT
            w.warehouse_id,
            w.name AS warehouse_name,
            w.district,
            w.block,
            s.quantity,
            s.expiry_date,
            s.stock_id
          FROM stock s
          JOIN warehouse w ON w.warehouse_id = s.warehouse_id
          WHERE s.batch_number = ? AND s.medicine_id = ? AND s.warehouse_id IS NOT NULL AND s.quantity > 0
          ORDER BY w.name
        `, [batch.batch_number, batch.medicine_id]);

        return { ...batch, pharmacies, warehouses };
      })
    );

    return res.status(200).json({ success: true, batches: batchesWithHolders });

  } catch (error) {
    console.error('fetchAllBatches error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  } finally {
    if (connection) await connection.end();
  }
}
