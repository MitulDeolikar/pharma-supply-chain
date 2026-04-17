import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ success: false, message: 'Query parameter q is required' });

    const connection = await mysql.createConnection(dbConfig);

    let medicineIds = [];
    let matchedMeds = [];
    let searchType = 'medicine'; // Track what we found: 'medicine' or 'generic'

    // Step 1: Check if query is a numeric medicine_id
    if (/^\d+$/.test(q)) {
      const [rows] = await connection.execute(
        `SELECT m.medicine_id, m.name, m.dosage, m.unit, m.manufacturer, g.generic_name 
         FROM medicines m 
         LEFT JOIN generic_medicines g ON m.generic_id = g.generic_id 
         WHERE m.medicine_id = ?`, 
        [q]
      );
      if (rows && rows.length) {
        medicineIds = rows.map(r => r.medicine_id);
        matchedMeds = rows;
      }
    }

    // Step 2: If no numeric match, search for generic name
    if (medicineIds.length === 0) {
      const like = `%${q}%`;
      const [genericRows] = await connection.execute(
        `SELECT generic_id, generic_name, category FROM generic_medicines WHERE generic_name LIKE ?`,
        [like]
      );

      if (genericRows && genericRows.length > 0) {
        // Found matching generic(s) - get all medicines under these generics
        searchType = 'generic';
        const genericIds = genericRows.map(g => g.generic_id);
        const placeholders = genericIds.map(() => '?').join(',');
        
        const [medRows] = await connection.execute(
          `SELECT m.medicine_id, m.name, m.dosage, m.unit, m.manufacturer, g.generic_name, g.category
           FROM medicines m
           JOIN generic_medicines g ON m.generic_id = g.generic_id
           WHERE m.generic_id IN (${placeholders})`,
          genericIds
        );
        
        medicineIds = medRows.map(r => r.medicine_id);
        matchedMeds = medRows;
      }
    }

    // Step 3: If still no match, search by medicine name
    if (medicineIds.length === 0) {
      const like = `%${q}%`;
      const [rows] = await connection.execute(
        `SELECT m.medicine_id, m.name, m.dosage, m.unit, m.manufacturer, g.generic_name 
         FROM medicines m 
         LEFT JOIN generic_medicines g ON m.generic_id = g.generic_id 
         WHERE m.name LIKE ? LIMIT 20`, 
        [like]
      );
      medicineIds = rows.map(r => r.medicine_id);
      matchedMeds = rows;
    }

    if (!medicineIds || medicineIds.length === 0) {
      await connection.end();
      return res.status(200).json({ success: true, medicines: [], pharmacies: [], searchType });
    }

    // Step 4: Aggregate stock per pharmacy for the matched medicine ids (non-expired)
    const placeholders = medicineIds.map(() => '?').join(',');
    const params = [...medicineIds];
    const [pharmacies] = await connection.execute(
      `SELECT p.pharmacy_id, p.pharmacy_name, p.address, p.contact_number, p.district, p.block,
              SUM(s.quantity) as total_quantity,
              GROUP_CONCAT(DISTINCT CONCAT(m.name, ':', s.quantity) ORDER BY m.name SEPARATOR '||') as medicines_with_quantity
       FROM stock s
       JOIN pharmacy p ON s.pharmacy_id = p.pharmacy_id
       JOIN medicines m ON s.medicine_id = m.medicine_id
       WHERE s.expiry_date > CURDATE() AND s.medicine_id IN (${placeholders})
       GROUP BY p.pharmacy_id, p.pharmacy_name, p.address, p.contact_number, p.district, p.block
       HAVING total_quantity > 0
       ORDER BY total_quantity DESC`,
      params
    );

    await connection.end();
    return res.status(200).json({ 
      success: true, 
      medicines: matchedMeds || [], 
      pharmacies,
      searchType,
      query: q
    });
  } catch (error) {
    console.error('searchInventory error', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
}
