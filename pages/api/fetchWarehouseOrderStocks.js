import mysql from "mysql2";
import dbConfig from "../../middleware/dbConfig";

// GET /api/fetchWarehouseOrderStocks?warehouse_id=X&request_id=Y&request_type=emergency|demand
// Fetches available warehouse stock for allocation with generic medicine support
// Similar to fetchEmergencyOrderStocks but for warehouse inventory

const handler = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const { warehouse_id, request_id, request_type } = req.query;

  if (!warehouse_id || !request_id || !request_type) {
    return res.status(400).json({ 
      success: false, 
      message: "Missing warehouse_id, request_id or request_type" 
    });
  }

  const connection = mysql.createConnection(dbConfig);

  try {
    connection.connect();

    // Fetch request items based on request type
    let requestItems = [];
    if (request_type === 'emergency') {
      const [items] = await connection.promise().query(
        `SELECT 
          peri.medicine_id, 
          peri.generic_id,
          peri.quantity_requested,
          m.name AS medicine_name,
          m.dosage,
          m.unit AS unit_type,
          m.generic_id AS medicine_generic_id,
          gm.generic_name,
          gm.category AS generic_category
        FROM pharmacy_emergency_request_items peri
        LEFT JOIN medicines m ON peri.medicine_id = m.medicine_id
        LEFT JOIN generic_medicines gm ON COALESCE(peri.generic_id, m.generic_id) = gm.generic_id
        WHERE peri.request_id = ?
        ORDER BY peri.medicine_id`,
        [request_id]
      );
      requestItems = items;
    } else if (request_type === 'demand') {
      const [items] = await connection.promise().query(
        `SELECT 
          pdri.medicine_id,
          pdri.generic_id,
          pdri.quantity_requested,
          m.name AS medicine_name,
          m.dosage,
          m.unit AS unit_type,
          m.generic_id AS medicine_generic_id,
          gm.generic_name,
          gm.category AS generic_category
        FROM pharmacy_demand_request_items pdri
        LEFT JOIN medicines m ON pdri.medicine_id = m.medicine_id
        LEFT JOIN generic_medicines gm ON COALESCE(pdri.generic_id, m.generic_id) = gm.generic_id
        WHERE pdri.request_id = ?
        ORDER BY pdri.medicine_id`,
        [request_id]
      );
      requestItems = items;
    } else {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid request_type. Must be 'emergency' or 'demand'" 
      });
    }

    if (requestItems.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "No items found for this request" 
      });
    }

    // Process each request item
    const stockDetails = [];

    for (const item of requestItems) {
      const quantityRequested = parseFloat(item.quantity_requested || 0);
      const genericIdToUse = item.generic_id || item.medicine_generic_id;

      // Determine request type: branded (has medicine_id) or generic (only generic_id)
      const isBrandedRequest = item.medicine_id !== null;
      const isGenericRequest = !isBrandedRequest && item.generic_id !== null;

      if (isBrandedRequest) {
        // BRANDED REQUEST: Get exact medicine stocks
        const [exactStocks] = await connection.promise().query(
          `SELECT 
            s.stock_id,
            s.medicine_id,
            s.batch_number,
            s.quantity,
            s.expiry_date,
            s.price_per_unit,
            m.name AS medicine_name,
            m.dosage,
            m.unit AS unit_type
          FROM stock s
          JOIN medicines m ON s.medicine_id = m.medicine_id
          WHERE s.warehouse_id = ? AND s.medicine_id = ? AND s.quantity > 0 AND s.expiry_date > NOW()
          ORDER BY s.expiry_date ASC`,
          [warehouse_id, item.medicine_id]
        );

        const totalAvailableExact = exactStocks.reduce((sum, s) => sum + parseFloat(s.quantity || 0), 0);
        const hasSufficient = totalAvailableExact >= quantityRequested;

        const itemDetail = {
          request_item_type: 'branded',
          medicine_id: item.medicine_id,
          medicine_name: item.medicine_name,
          dosage: item.dosage,
          unit_type: item.unit_type,
          generic_id: genericIdToUse,
          generic_name: item.generic_name,
          generic_category: item.generic_category,
          quantity_requested: quantityRequested,
          exact_medicine: {
            medicine_id: item.medicine_id,
            medicine_name: item.medicine_name,
            stocks: exactStocks,
            total_available: totalAvailableExact,
            has_sufficient: hasSufficient
          },
          alternatives: [],
          needs_alternatives: !hasSufficient
        };

        // If insufficient, fetch alternatives from same generic
        if (!hasSufficient && genericIdToUse) {
          const [altStocks] = await connection.promise().query(
            `SELECT 
              s.stock_id,
              s.medicine_id,
              s.batch_number,
              s.quantity,
              s.expiry_date,
              s.price_per_unit,
              m.name AS medicine_name,
              m.dosage,
              m.unit AS unit_type
            FROM stock s
            JOIN medicines m ON s.medicine_id = m.medicine_id
            WHERE s.warehouse_id = ? 
              AND m.generic_id = ? 
              AND s.medicine_id != ? 
              AND s.quantity > 0 
              AND s.expiry_date > NOW()
            ORDER BY s.expiry_date ASC`,
            [warehouse_id, genericIdToUse, item.medicine_id]
          );

          // Group alternatives by medicine_id
          const altGrouped = {};
          for (const stock of altStocks) {
            if (!altGrouped[stock.medicine_id]) {
              altGrouped[stock.medicine_id] = {
                medicine_id: stock.medicine_id,
                medicine_name: stock.medicine_name,
                dosage: stock.dosage,
                unit_type: stock.unit_type,
                stocks: [],
                total_available: 0
              };
            }
            altGrouped[stock.medicine_id].stocks.push(stock);
            altGrouped[stock.medicine_id].total_available += parseFloat(stock.quantity || 0);
          }

          itemDetail.alternatives = Object.values(altGrouped);
        }

        stockDetails.push(itemDetail);

      } else if (isGenericRequest) {
        // GENERIC REQUEST: Get all medicines under this generic category
        const [genericStocks] = await connection.promise().query(
          `SELECT 
            s.stock_id,
            s.medicine_id,
            s.batch_number,
            s.quantity,
            s.expiry_date,
            s.price_per_unit,
            m.name AS medicine_name,
            m.dosage,
            m.unit AS unit_type
          FROM stock s
          JOIN medicines m ON s.medicine_id = m.medicine_id
          WHERE s.warehouse_id = ? 
            AND m.generic_id = ? 
            AND s.quantity > 0 
            AND s.expiry_date > NOW()
          ORDER BY s.expiry_date ASC`,
          [warehouse_id, item.generic_id]
        );

        // Group by medicine_id
        const grouped = {};
        for (const stock of genericStocks) {
          if (!grouped[stock.medicine_id]) {
            grouped[stock.medicine_id] = {
              medicine_id: stock.medicine_id,
              medicine_name: stock.medicine_name,
              dosage: stock.dosage,
              unit_type: stock.unit_type,
              stocks: [],
              total_available: 0
            };
          }
          grouped[stock.medicine_id].stocks.push(stock);
          grouped[stock.medicine_id].total_available += parseFloat(stock.quantity || 0);
        }

        const itemDetail = {
          request_item_type: 'generic',
          generic_id: item.generic_id,
          generic_name: item.generic_name,
          generic_category: item.generic_category,
          quantity_requested: quantityRequested,
          available_options: Object.values(grouped),
          exact_medicine: null,
          alternatives: [],
          needs_alternatives: false
        };

        stockDetails.push(itemDetail);
      }
    }

    return res.status(200).json({ 
      success: true, 
      warehouse_id: parseInt(warehouse_id),
      request_id: parseInt(request_id),
      request_type,
      stock_details: stockDetails 
    });

  } catch (error) {
    console.error("Error fetching warehouse order stocks:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal Server Error", 
      error: error.message 
    });
  } finally {
    connection.end();
  }
};

export default handler;
