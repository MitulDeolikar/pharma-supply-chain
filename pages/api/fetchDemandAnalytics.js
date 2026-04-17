import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);

    const query = `
      SELECT 
        p.pharmacy_id,
        p.pharmacy_name,
        p.address as pharmacy_address,
        m.medicine_id,
        m.name as medicine_name,
        m.dosage as medicine_type,
        pdr.status,
        SUM(pdri.quantity_requested) as total_quantity_requested,
        COUNT(DISTINCT pdr.request_id) as request_count,
        MAX(pdr.request_date) as latest_request_date
      FROM pharmacy_demand_request pdr
      JOIN pharmacy p ON pdr.pharmacy_id = p.pharmacy_id
      JOIN pharmacy_demand_request_items pdri ON pdr.request_id = pdri.request_id
      JOIN medicines m ON pdri.medicine_id = m.medicine_id
      GROUP BY 
        p.pharmacy_id,
        p.pharmacy_name,
        p.address,
        m.medicine_id,
        m.name,
        m.dosage,
        pdr.status
      ORDER BY p.pharmacy_name, m.name, pdr.status
    `;

    const [rows] = await connection.execute(query);

    // Group data by pharmacy and medicine
    const pharmacyMap = new Map();

    rows.forEach(row => {
      const pharmacyKey = row.pharmacy_id;
      
      if (!pharmacyMap.has(pharmacyKey)) {
        pharmacyMap.set(pharmacyKey, {
          pharmacy_id: row.pharmacy_id,
          pharmacy_name: row.pharmacy_name,
          pharmacy_address: row.pharmacy_address,
          pharmacy_phone: row.pharmacy_phone,
          total_requests: 0,
          medicines: new Map()
        });
      }

      const pharmacy = pharmacyMap.get(pharmacyKey);
      const medicineKey = row.medicine_id;

      if (!pharmacy.medicines.has(medicineKey)) {
        pharmacy.medicines.set(medicineKey, {
          medicine_id: row.medicine_id,
          medicine_name: row.medicine_name,
          medicine_type: row.medicine_type,
          total_quantity: 0,
          request_count: 0,
          status_breakdown: new Map(),
          latest_request_date: row.latest_request_date
        });
      }

      const medicine = pharmacy.medicines.get(medicineKey);
      
      // Update medicine data
      if (!medicine.status_breakdown.has(row.status)) {
        medicine.status_breakdown.set(row.status, 0);
      }
      medicine.status_breakdown.set(row.status, 
        parseFloat(row.total_quantity_requested || 0)
      );

      // Update totals
      medicine.total_quantity += parseFloat(row.total_quantity_requested || 0);
      medicine.request_count = Math.max(medicine.request_count, row.request_count);

      // Update latest request date
      if (new Date(row.latest_request_date) > new Date(medicine.latest_request_date)) {
        medicine.latest_request_date = row.latest_request_date;
      }
    });

    // Get total requests count per pharmacy
    const requestCountQuery = `
      SELECT 
        pharmacy_id,
        COUNT(DISTINCT request_id) as total_requests
      FROM pharmacy_demand_request 
      GROUP BY pharmacy_id
    `;

    const [requestCounts] = await connection.execute(requestCountQuery);
    
    requestCounts.forEach(count => {
      if (pharmacyMap.has(count.pharmacy_id)) {
        pharmacyMap.get(count.pharmacy_id).total_requests = count.total_requests;
      }
    });

    // Convert maps to arrays and format data
    const analyticsData = Array.from(pharmacyMap.values()).map(pharmacy => ({
      ...pharmacy,
      medicines: Array.from(pharmacy.medicines.values()).map(medicine => ({
        ...medicine,
        status_breakdown: Array.from(medicine.status_breakdown.entries()).map(([status, quantity]) => ({
          status,
          quantity
        }))
      }))
    }));

    // Sort pharmacies by name
    analyticsData.sort((a, b) => a.pharmacy_name.localeCompare(b.pharmacy_name));

    res.status(200).json(analyticsData);

  } catch (error) {
    console.error('Error fetching demand analytics:', error);
    res.status(500).json({ 
      message: 'Internal server error',
      error: error.message 
    });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}