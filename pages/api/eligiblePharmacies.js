import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { requestId, excludePharmacyId, requestType = 'emergency' } = req.query;
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'Request ID is required' });
    }
    const connection = await mysql.createConnection(dbConfig);

    // Choose the correct table based on request type
    let requestItemsTable, requestTable;
    if (requestType === 'demand') {
      requestItemsTable = 'pharmacy_demand_request_items';
      requestTable = 'pharmacy_demand_request';
    } else {
      requestItemsTable = 'pharmacy_emergency_request_items';
      requestTable = 'pharmacy_emergency_requests';
    }

    // First, get all the medicines and quantities needed from the request
    const [requestItems] = await connection.execute(`
      SELECT medicine_id, generic_id, quantity_requested 
      FROM ${requestItemsTable}
      WHERE ${requestType === 'demand' ? 'request_id' : 'request_id'} = ?
    `, [requestId]);

    if (requestItems.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // Get all pharmacies that have sufficient stock for ALL required medicines/generics
    // Build the query to optionally exclude a pharmacy (the originating pharmacy)
    let pharmaciesSql = `
      WITH pharmacy_stock_summary AS (
        SELECT 
          s.pharmacy_id,
          s.medicine_id,
          SUM(s.quantity) as total_quantity
        FROM stock s
        WHERE s.expiry_date > CURDATE()
        GROUP BY s.pharmacy_id, s.medicine_id
      ),
      pharmacy_generic_stock_summary AS (
        SELECT 
          s.pharmacy_id,
          m.generic_id,
          SUM(s.quantity) as total_quantity
        FROM stock s
        JOIN medicines m ON s.medicine_id = m.medicine_id
        WHERE s.expiry_date > CURDATE()
        AND m.generic_id IS NOT NULL
        GROUP BY s.pharmacy_id, m.generic_id
      )
      SELECT DISTINCT p.pharmacy_id, p.username as name, p.address, p.district, p.block, p.contact_number
      FROM pharmacy p
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${requestItemsTable} ri
        WHERE ri.${requestType === 'demand' ? 'request_id' : 'request_id'} = ?
        AND NOT EXISTS (
          SELECT 1
          FROM (
            SELECT pss.pharmacy_id, pss.total_quantity
            FROM pharmacy_stock_summary pss
            WHERE pss.pharmacy_id = p.pharmacy_id
            AND pss.medicine_id = ri.medicine_id
            AND ri.medicine_id IS NOT NULL
            
            UNION ALL
            
            SELECT pgss.pharmacy_id, pgss.total_quantity
            FROM pharmacy_generic_stock_summary pgss
            WHERE pgss.pharmacy_id = p.pharmacy_id
            AND pgss.generic_id = ri.generic_id
            AND ri.generic_id IS NOT NULL
          ) AS combined_stock
          WHERE combined_stock.total_quantity >= ri.quantity_requested
        )
      )`;

    const params = [requestId];
    if (excludePharmacyId) {
      pharmaciesSql += ` AND p.pharmacy_id <> ?`;
      params.push(excludePharmacyId);
    }

    const [pharmacies] = await connection.execute(pharmaciesSql, params);

    // For each eligible pharmacy, get their current stock levels for the requested medicines/generics
    const eligiblePharmacies = await Promise.all(pharmacies.map(async (pharmacy) => {
      // Separate medicine_id and generic_id requests
      const medicineIds = requestItems.filter(item => item.medicine_id !== null).map(item => item.medicine_id);
      const genericIds = requestItems.filter(item => item.generic_id !== null).map(item => item.generic_id);

      let allStocks = [];

      // Fetch stocks for specific medicine IDs
      if (medicineIds.length > 0) {
        const [medicineStocks] = await connection.execute(`
          SELECT 
            s.stock_id,
            s.medicine_id,
            s.batch_number,
            s.quantity,
            s.price_per_unit,
            s.expiry_date,
            m.name as medicine_name,
            m.dosage,
            m.unit as unit_type,
            m.manufacturer,
            m.generic_id
          FROM stock s
          JOIN medicines m ON s.medicine_id = m.medicine_id
          WHERE s.pharmacy_id = ?
          AND s.medicine_id IN (${medicineIds.map(() => '?').join(',')})
          AND s.expiry_date > CURDATE()
          AND s.quantity > 0
          ORDER BY s.expiry_date ASC
        `, [pharmacy.pharmacy_id, ...medicineIds]);
        allStocks = [...allStocks, ...medicineStocks];
      }

      // Fetch stocks for generic IDs (all medicines under those generics)
      if (genericIds.length > 0) {
        const [genericStocks] = await connection.execute(`
          SELECT 
            s.stock_id,
            s.medicine_id,
            s.batch_number,
            s.quantity,
            s.price_per_unit,
            s.expiry_date,
            m.name as medicine_name,
            m.dosage,
            m.unit as unit_type,
            m.manufacturer,
            m.generic_id
          FROM stock s
          JOIN medicines m ON s.medicine_id = m.medicine_id
          WHERE s.pharmacy_id = ?
          AND m.generic_id IN (${genericIds.map(() => '?').join(',')})
          AND s.expiry_date > CURDATE()
          AND s.quantity > 0
          ORDER BY s.expiry_date ASC
        `, [pharmacy.pharmacy_id, ...genericIds]);
        allStocks = [...allStocks, ...genericStocks];
      }

      return {
        ...pharmacy,
        stocks: allStocks,
        requestItems
      };
    }));

    // If no eligible pharmacies found, check for alternatives
    let alternativePharmacies = [];
    if (eligiblePharmacies.length === 0) {
      // For each medicine_id request, find alternatives from same generic
      const medicineRequests = requestItems.filter(item => item.medicine_id !== null);
      
      for (const item of medicineRequests) {
        // Get the generic_id for this medicine
        const [medicineInfo] = await connection.execute(
          'SELECT generic_id FROM medicines WHERE medicine_id = ?',
          [item.medicine_id]
        );
        
        if (medicineInfo.length > 0 && medicineInfo[0].generic_id) {
          const genericId = medicineInfo[0].generic_id;
          
          // Find pharmacies with other medicines in same generic with sufficient stock
          let altSql = `
            WITH pharmacy_generic_stock AS (
              SELECT 
                s.pharmacy_id,
                m.generic_id,
                SUM(s.quantity) as total_quantity
              FROM stock s
              JOIN medicines m ON s.medicine_id = m.medicine_id
              WHERE s.expiry_date > CURDATE()
              AND m.generic_id = ?
              AND s.quantity > 0
              GROUP BY s.pharmacy_id, m.generic_id
            )
            SELECT DISTINCT p.pharmacy_id, p.username as name, p.address, p.district, p.block, p.contact_number
            FROM pharmacy p
            JOIN pharmacy_generic_stock pgs ON p.pharmacy_id = pgs.pharmacy_id
            WHERE pgs.total_quantity >= ?`;
          
          const altParams = [genericId, item.quantity_requested];
          if (excludePharmacyId) {
            altSql += ` AND p.pharmacy_id <> ?`;
            altParams.push(excludePharmacyId);
          }
          
          const [altPharmacies] = await connection.execute(altSql, altParams);
          
          // Get stocks for these alternative pharmacies
          for (const pharmacy of altPharmacies) {
            const [altStocks] = await connection.execute(`
              SELECT 
                s.stock_id,
                s.medicine_id,
                s.batch_number,
                s.quantity,
                s.price_per_unit,
                s.expiry_date,
                m.name as medicine_name,
                m.dosage,
                m.unit as unit_type,
                m.manufacturer,
                m.generic_id
              FROM stock s
              JOIN medicines m ON s.medicine_id = m.medicine_id
              WHERE s.pharmacy_id = ?
              AND m.generic_id = ?
              AND s.expiry_date > CURDATE()
              AND s.quantity > 0
              ORDER BY s.expiry_date ASC
            `, [pharmacy.pharmacy_id, genericId]);
            
            // Mark this item as alternative
            const alternativeItem = {
              ...item,
              is_alternative: true,
              original_medicine_id: item.medicine_id,
              alternative_generic_id: genericId
            };
            
            alternativePharmacies.push({
              ...pharmacy,
              stocks: altStocks,
              requestItems: [alternativeItem],
              is_alternative: true
            });
          }
        }
      }
    }

    // Check warehouses for sufficient stock
    let warehousesSql = `
      WITH warehouse_stock_summary AS (
        SELECT 
          s.warehouse_id,
          s.medicine_id,
          SUM(s.quantity) as total_quantity
        FROM stock s
        WHERE s.pharmacy_id IS NULL
        AND s.warehouse_id IS NOT NULL
        AND s.expiry_date > CURDATE()
        GROUP BY s.warehouse_id, s.medicine_id
      ),
      warehouse_generic_stock_summary AS (
        SELECT 
          s.warehouse_id,
          m.generic_id,
          SUM(s.quantity) as total_quantity
        FROM stock s
        JOIN medicines m ON s.medicine_id = m.medicine_id
        WHERE s.pharmacy_id IS NULL
        AND s.warehouse_id IS NOT NULL
        AND s.expiry_date > CURDATE()
        AND m.generic_id IS NOT NULL
        GROUP BY s.warehouse_id, m.generic_id
      )
      SELECT DISTINCT w.warehouse_id, w.name, w.address, w.district, w.block, w.contact_number
      FROM warehouse w
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${requestItemsTable} ri
        WHERE ri.${requestType === 'demand' ? 'request_id' : 'request_id'} = ?
        AND NOT EXISTS (
          SELECT 1
          FROM (
            SELECT wss.warehouse_id, wss.total_quantity
            FROM warehouse_stock_summary wss
            WHERE wss.warehouse_id = w.warehouse_id
            AND wss.medicine_id = ri.medicine_id
            AND ri.medicine_id IS NOT NULL
            
            UNION ALL
            
            SELECT wgss.warehouse_id, wgss.total_quantity
            FROM warehouse_generic_stock_summary wgss
            WHERE wgss.warehouse_id = w.warehouse_id
            AND wgss.generic_id = ri.generic_id
            AND ri.generic_id IS NOT NULL
          ) AS combined_stock
          WHERE combined_stock.total_quantity >= ri.quantity_requested
        )
      )`;

    const [warehouses] = await connection.execute(warehousesSql, [requestId]);

    // For each eligible warehouse, get their current stock levels
    const eligibleWarehouses = await Promise.all(warehouses.map(async (warehouse) => {
      const medicineIds = requestItems.filter(item => item.medicine_id !== null).map(item => item.medicine_id);
      const genericIds = requestItems.filter(item => item.generic_id !== null).map(item => item.generic_id);

      let allStocks = [];

      // Fetch stocks for specific medicine IDs
      if (medicineIds.length > 0) {
        const [medicineStocks] = await connection.execute(`
          SELECT 
            s.stock_id,
            s.medicine_id,
            s.batch_number,
            s.quantity,
            s.price_per_unit,
            s.expiry_date,
            m.name as medicine_name,
            m.dosage,
            m.unit as unit_type,
            m.manufacturer,
            m.generic_id
          FROM stock s
          JOIN medicines m ON s.medicine_id = m.medicine_id
          WHERE s.warehouse_id = ?
          AND s.pharmacy_id IS NULL
          AND s.medicine_id IN (${medicineIds.map(() => '?').join(',')})
          AND s.expiry_date > CURDATE()
          AND s.quantity > 0
          ORDER BY s.expiry_date ASC
        `, [warehouse.warehouse_id, ...medicineIds]);
        allStocks = [...allStocks, ...medicineStocks];
      }

      // Fetch stocks for generic IDs
      if (genericIds.length > 0) {
        const [genericStocks] = await connection.execute(`
          SELECT 
            s.stock_id,
            s.medicine_id,
            s.batch_number,
            s.quantity,
            s.price_per_unit,
            s.expiry_date,
            m.name as medicine_name,
            m.dosage,
            m.unit as unit_type,
            m.manufacturer,
            m.generic_id
          FROM stock s
          JOIN medicines m ON s.medicine_id = m.medicine_id
          WHERE s.warehouse_id = ?
          AND s.pharmacy_id IS NULL
          AND m.generic_id IN (${genericIds.map(() => '?').join(',')})
          AND s.expiry_date > CURDATE()
          AND s.quantity > 0
          ORDER BY s.expiry_date ASC
        `, [warehouse.warehouse_id, ...genericIds]);
        allStocks = [...allStocks, ...genericStocks];
      }

      return {
        ...warehouse,
        stocks: allStocks,
        requestItems,
        is_warehouse: true
      };
    }));

    await connection.end();
    
    const finalPharmacies = eligiblePharmacies.length > 0 ? eligiblePharmacies : alternativePharmacies;
    console.log(`Eligible pharmacies found for ${requestType} request:`, finalPharmacies);
    console.log(`Eligible warehouses found for ${requestType} request:`, eligibleWarehouses);

    return res.status(200).json({
      success: true,
      pharmacies: finalPharmacies,
      warehouses: eligibleWarehouses,
      is_alternative: eligiblePharmacies.length === 0 && alternativePharmacies.length > 0
    });

  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({ success: false, message: 'Error fetching eligible pharmacies' });
  }
}
