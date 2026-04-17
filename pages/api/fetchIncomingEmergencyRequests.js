import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { pharmacy_id } = req.query;

    if (!pharmacy_id) {
      return res.status(400).json({ success: false, message: 'Pharmacy ID is required' });
    }

    const connection = await mysql.createConnection(dbConfig);

    // Fetch emergency requests where this pharmacy is the accepting pharmacy (both order_sent and order_successful)
    const query = `
      SELECT 
        per.request_id,
        per.request_date,
        per.status,
        per.remarks,
        per.pharmacy_id as requesting_pharmacy_id,
        per.accepting_pharmacy_id,
        rp.pharmacy_name as requesting_pharmacy_name,
        rp.address as requesting_pharmacy_address,
        rp.contact_number as requesting_pharmacy_contact,
        ap.pharmacy_name as accepting_pharmacy_name,
        GROUP_CONCAT(
            JSON_OBJECT(
              'medicine_id', peri.medicine_id,
              'generic_id', peri.generic_id,
              'name', COALESCE(m.name, g.generic_name),
              'dosage', m.dosage,
              'unit', m.unit,
              'quantity_requested', peri.quantity_requested
            )
          ) AS medicines
      FROM pharmacy_emergency_requests per
      LEFT JOIN pharmacy_emergency_request_items peri ON per.request_id = peri.request_id
      LEFT JOIN medicines m ON peri.medicine_id = m.medicine_id
      LEFT JOIN generic_medicines g ON peri.generic_id = g.generic_id
      LEFT JOIN pharmacy rp ON per.pharmacy_id = rp.pharmacy_id
      LEFT JOIN pharmacy ap ON per.accepting_pharmacy_id = ap.pharmacy_id
      WHERE per.accepting_pharmacy_id = ? AND per.status IN ('order_sent', 'order_successful')
      GROUP BY per.request_id, per.request_date, per.status, per.remarks, per.pharmacy_id, per.accepting_pharmacy_id, rp.pharmacy_name, rp.address, rp.contact_number, ap.pharmacy_name
      ORDER BY per.request_date DESC
    `;

    const [requests] = await connection.execute(query, [pharmacy_id]);

    // Parse JSON array of medicines
    const formattedRequests = requests.map(request => ({
      ...request,
      medicines: request.medicines ? JSON.parse(`[${request.medicines}]`) : []
    }));

    await connection.end();

    res.status(200).json({
      success: true,
      requests: formattedRequests
    });

  } catch (error) {
    console.error('Error fetching incoming emergency requests:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error fetching incoming emergency requests',
      error: error.message
    });
  }
}