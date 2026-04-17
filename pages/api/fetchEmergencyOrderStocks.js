import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { pharmacy_id, request_id } = req.query;

    if (!pharmacy_id || !request_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Pharmacy ID and Request ID are required' 
      });
    }

    const connection = await mysql.createConnection(dbConfig);

    try {
      // First get the emergency request details with BOTH medicine_id and generic_id support
      const [requestRows] = await connection.execute(`
        SELECT 
          per.request_id,
          per.pharmacy_id as requesting_pharmacy_id,
          per.accepting_pharmacy_id,
          per.status,
          peri.medicine_id,
          peri.generic_id,
          peri.quantity_requested,
          m.name as medicine_name,
          m.dosage,
          m.unit,
          m.manufacturer,
          m.generic_id as medicine_generic_id,
          g.generic_name,
          g.category as generic_category
        FROM pharmacy_emergency_requests per
        JOIN pharmacy_emergency_request_items peri ON per.request_id = peri.request_id
        LEFT JOIN medicines m ON peri.medicine_id = m.medicine_id
        LEFT JOIN generic_medicines g ON COALESCE(peri.generic_id, m.generic_id) = g.generic_id
        WHERE per.request_id = ? AND per.accepting_pharmacy_id = ?
      `, [request_id, pharmacy_id]);

      if (requestRows.length === 0) {
        await connection.end();
        return res.status(404).json({ 
          success: false, 
          message: 'Emergency request not found or not assigned to this pharmacy' 
        });
      }

      // Build response with enhanced logic for generic medicines
      const medicines = [];

      for (const row of requestRows) {
        const isGenericRequest = row.medicine_id === null && row.generic_id !== null;
        const isBrandedRequest = row.medicine_id !== null;
        const genericIdToUse = row.generic_id || row.medicine_generic_id;

        // Scenario 1: Branded medicine requested
        if (isBrandedRequest) {
          // Check if exact medicine has sufficient stock
          const [exactStocks] = await connection.execute(`
            SELECT 
              s.stock_id,
              s.medicine_id,
              s.quantity,
              s.batch_number,
              s.expiry_date,
              s.price_per_unit,
              m.name as medicine_name,
              m.dosage,
              m.unit,
              m.manufacturer,
              m.generic_id
            FROM stock s
            JOIN medicines m ON s.medicine_id = m.medicine_id
            WHERE s.pharmacy_id = ? 
              AND s.medicine_id = ?
              AND s.quantity > 0 
              AND s.expiry_date > NOW()
            ORDER BY s.expiry_date ASC
          `, [pharmacy_id, row.medicine_id]);

          const exactAvailable = exactStocks.reduce((sum, s) => sum + parseFloat(s.quantity || 0), 0);
          const requested = Number(row.quantity_requested) || 0;

          // If insufficient or no exact stock, fetch alternatives from same generic
          let alternatives = [];
          if (exactAvailable < requested && genericIdToUse) {
            const [altStocks] = await connection.execute(`
              SELECT 
                s.stock_id,
                s.medicine_id,
                s.quantity,
                s.batch_number,
                s.expiry_date,
                s.price_per_unit,
                m.name as medicine_name,
                m.dosage,
                m.unit,
                m.manufacturer,
                m.generic_id
              FROM stock s
              JOIN medicines m ON s.medicine_id = m.medicine_id
              WHERE s.pharmacy_id = ? 
                AND m.generic_id = ?
                AND s.medicine_id != ?
                AND s.quantity > 0 
                AND s.expiry_date > NOW()
              ORDER BY m.name ASC, s.expiry_date ASC
            `, [pharmacy_id, genericIdToUse, row.medicine_id]);

            // Group alternatives by medicine_id
            const altsByMedicine = {};
            altStocks.forEach(stock => {
              if (!altsByMedicine[stock.medicine_id]) {
                altsByMedicine[stock.medicine_id] = {
                  medicine_id: stock.medicine_id,
                  medicine_name: stock.medicine_name,
                  dosage: stock.dosage,
                  unit: stock.unit,
                  manufacturer: stock.manufacturer,
                  generic_id: stock.generic_id,
                  stocks: [],
                  total_available: 0
                };
              }
              altsByMedicine[stock.medicine_id].stocks.push(stock);
              altsByMedicine[stock.medicine_id].total_available += parseFloat(stock.quantity || 0);
            });

            alternatives = Object.values(altsByMedicine);
          }

          medicines.push({
            request_item_type: 'branded',
            requested_medicine_id: row.medicine_id,
            requested_medicine_name: row.medicine_name,
            requested_generic_id: genericIdToUse,
            generic_name: row.generic_name,
            generic_category: row.generic_category,
            dosage: row.dosage,
            unit_type: row.unit,
            manufacturer: row.manufacturer,
            quantity_requested: requested,
            exact_medicine: {
              medicine_id: row.medicine_id,
              medicine_name: row.medicine_name,
              stocks: exactStocks,
              total_available: exactAvailable,
              has_sufficient: exactAvailable >= requested
            },
            alternatives: alternatives,
            needs_alternatives: exactAvailable < requested
          });
        }

        // Scenario 2: Generic category requested
        else if (isGenericRequest) {
          // Fetch ALL medicines under this generic category
          const [allMedicines] = await connection.execute(`
            SELECT 
              s.stock_id,
              s.medicine_id,
              s.quantity,
              s.batch_number,
              s.expiry_date,
              s.price_per_unit,
              m.name as medicine_name,
              m.dosage,
              m.unit,
              m.manufacturer,
              m.generic_id
            FROM stock s
            JOIN medicines m ON s.medicine_id = m.medicine_id
            WHERE s.pharmacy_id = ? 
              AND m.generic_id = ?
              AND s.quantity > 0 
              AND s.expiry_date > NOW()
            ORDER BY m.name ASC, s.expiry_date ASC
          `, [pharmacy_id, row.generic_id]);

          // Group by medicine_id
          const medicineGroups = {};
          allMedicines.forEach(stock => {
            if (!medicineGroups[stock.medicine_id]) {
              medicineGroups[stock.medicine_id] = {
                medicine_id: stock.medicine_id,
                medicine_name: stock.medicine_name,
                dosage: stock.dosage,
                unit: stock.unit,
                manufacturer: stock.manufacturer,
                generic_id: stock.generic_id,
                stocks: [],
                total_available: 0
              };
            }
            medicineGroups[stock.medicine_id].stocks.push(stock);
            medicineGroups[stock.medicine_id].total_available += parseFloat(stock.quantity || 0);
          });

          const availableOptions = Object.values(medicineGroups);
          const totalAvailable = availableOptions.reduce((sum, opt) => sum + opt.total_available, 0);
          const requested = Number(row.quantity_requested) || 0;

          medicines.push({
            request_item_type: 'generic',
            requested_medicine_id: null,
            requested_medicine_name: null,
            requested_generic_id: row.generic_id,
            generic_name: row.generic_name,
            generic_category: row.generic_category,
            quantity_requested: requested,
            available_options: availableOptions,
            total_available: totalAvailable,
            has_sufficient: totalAvailable >= requested
          });
        }
      }

      const requestDetails = {
        request_id: requestRows[0].request_id,
        requesting_pharmacy_id: requestRows[0].requesting_pharmacy_id,
        accepting_pharmacy_id: requestRows[0].accepting_pharmacy_id,
        status: requestRows[0].status,
        medicines: medicines
      };

      await connection.end();

      res.status(200).json({
        success: true,
        data: requestDetails
      });

    } catch (queryError) {
      await connection.end();
      throw queryError;
    }

  } catch (error) {
    console.error('Error fetching emergency order stocks:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching emergency order stocks'
    });
  }
}