import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Simple authentication check (you might want to improve this)
  const { cron_key } = req.body;
  
  if (cron_key !== 'auto_demand_order_cron_2025') {
    return res.status(401).json({ 
      success: false, 
      message: 'Unauthorized - Invalid cron key' 
    });
  }

  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    
    // Get all pharmacies with auto-ordering enabled
    const [pharmacies] = await connection.execute(`
      SELECT pharmacy_id, pharmacy_name 
      FROM pharmacy 
      WHERE auto_order_enabled = TRUE
    `);

    if (pharmacies.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No pharmacies have auto-ordering enabled',
        processed_pharmacies: 0
      });
    }

    const processedPharmacies = [];
    const errors = [];

    for (const pharmacy of pharmacies) {
      try {
        // Get demand forecast for this pharmacy
        const forecastResponse = await fetch(`${req.headers.origin || 'http://localhost:3000'}/api/demandForecast?pharmacy_id=${pharmacy.pharmacy_id}`, {
          headers: { 'X-Internal-Key': process.env.INTERNAL_API_KEY || 'pharma_internal_2025' }
        });
        const forecastData = await forecastResponse.json();

        if (forecastData.success && forecastData.forecast.length > 0) {
          // Filter medicines that need restocking
          const itemsNeedingRestock = forecastData.forecast
            .filter(item => item.stock_to_order > 0)
            .map(item => ({
              medicine_id: item.medicine_id,
              quantity: Math.ceil(item.stock_to_order)
            }));

          if (itemsNeedingRestock.length > 0) {
            // Start transaction for this pharmacy
            await connection.beginTransaction();

            // Create auto demand request
            const [requestResult] = await connection.execute(
              'INSERT INTO pharmacy_demand_request (pharmacy_id, remarks, status) VALUES (?, ?, ?)',
              [pharmacy.pharmacy_id, 'Automated monthly demand request based on Time Series forecast', 'pending']
            );

            const requestId = requestResult.insertId;

            // Insert demand request items
            const itemInsertPromises = itemsNeedingRestock.map(item => {
              return connection.execute(
                'INSERT INTO pharmacy_demand_request_items (request_id, medicine_id, quantity_requested) VALUES (?, ?, ?)',
                [requestId, item.medicine_id, item.quantity]
              );
            });

            await Promise.all(itemInsertPromises);

            // Commit transaction
            await connection.commit();

            processedPharmacies.push({
              pharmacy_id: pharmacy.pharmacy_id,
              pharmacy_name: pharmacy.pharmacy_name,
              request_id: requestId,
              items_count: itemsNeedingRestock.length,
              total_quantity: itemsNeedingRestock.reduce((sum, item) => sum + item.quantity, 0)
            });
          } else {
            processedPharmacies.push({
              pharmacy_id: pharmacy.pharmacy_id,
              pharmacy_name: pharmacy.pharmacy_name,
              request_id: null,
              message: 'No items needed restocking'
            });
          }
        } else {
          errors.push({
            pharmacy_id: pharmacy.pharmacy_id,
            pharmacy_name: pharmacy.pharmacy_name,
            error: 'Failed to get forecast data or no forecast available'
          });
        }
      } catch (error) {
        // Rollback transaction on error
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('Rollback error:', rollbackError);
        }
        
        errors.push({
          pharmacy_id: pharmacy.pharmacy_id,
          pharmacy_name: pharmacy.pharmacy_name,
          error: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Auto demand order processing completed',
      processed_pharmacies: processedPharmacies.length,
      successful_orders: processedPharmacies.filter(p => p.request_id).length,
      results: processedPharmacies,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error in auto demand order cron:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process auto demand orders',
      error: error.message
    });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}