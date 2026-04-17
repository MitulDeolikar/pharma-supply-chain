import { spawn } from 'child_process';
import mysql from "mysql2";
import path from 'path';
import dbConfig from "../../middleware/dbConfig";

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pharmacy_id } = req.query;

  if (!pharmacy_id) {
    return res.status(400).json({ error: 'pharmacy_id is required' });
  }

  try {
    // Update the Python script to use the provided pharmacy_id
    const pythonScriptPath = path.join(process.cwd(), 'middleware', 'demandForecast.py');
    
    // Run Python script with pharmacy_id as argument
    const pythonProcess = spawn(process.env.PYTHON_CMD || 'python3', [pythonScriptPath, pharmacy_id]);
    
    let pythonOutput = '';
    let pythonError = '';

    pythonProcess.stdout.on('data', (data) => {
      pythonOutput += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      pythonError += data.toString();
    });

    pythonProcess.on('close', async (code) => {
      if (code !== 0) {
        console.error('Python script error:', pythonError);
        return res.status(500).json({ 
          error: 'Forecasting failed', 
          details: pythonError 
        });
      }

      try {
        // Parse the output to extract forecast data
        const lines = pythonOutput.split('\n');
        const forecastData = [];
        let currentMedicine = null;

        for (const line of lines) {
          if (line.includes('Medicine ') && line.includes(':')) {
            const medicineMatch = line.match(/Medicine (\d+):/);
            if (medicineMatch) {
              currentMedicine = {
                medicine_id: parseInt(medicineMatch[1]),
                medicine_name: '',
                predicted_demand: 0,
                current_stock: 0,
                stock_to_order: 0
              };
            }
          } else if (currentMedicine && line.includes('Predicted 30-day demand:')) {
            const demandMatch = line.match(/(\d+\.?\d*) units/);
            if (demandMatch) {
              currentMedicine.predicted_demand = parseFloat(demandMatch[1]);
            }
          } else if (currentMedicine && line.includes('Current stock:')) {
            const stockMatch = line.match(/(\d+\.?\d*) units/);
            if (stockMatch) {
              currentMedicine.current_stock = parseFloat(stockMatch[1]);
            }
          } else if (currentMedicine && line.includes('Need to order:')) {
            const orderMatch = line.match(/(\d+\.?\d*) units/);
            if (orderMatch) {
              currentMedicine.stock_to_order = parseFloat(orderMatch[1]);
              forecastData.push(currentMedicine);
              currentMedicine = null;
            }
          }
        }

        // Get medicine names from database
        const connection = mysql.createConnection(dbConfig);
        const medicineIds = forecastData.map(item => item.medicine_id);
        
        if (medicineIds.length > 0) {
          const [medicines] = await connection.promise().query(
            `SELECT medicine_id, name as medicine_name, dosage, unit 
             FROM medicines 
             WHERE medicine_id IN (${medicineIds.map(() => '?').join(',')})`,
            medicineIds
          );

          // Add medicine details to forecast data
          forecastData.forEach(forecast => {
            const medicine = medicines.find(m => m.medicine_id === forecast.medicine_id);
            if (medicine) {
              forecast.medicine_name = medicine.medicine_name;
              forecast.dosage = medicine.dosage;
              forecast.unit = medicine.unit;
            }
          });
        }

        connection.end();

        // Extract summary from output
        const summaryMatch = pythonOutput.match(/Total medicines analyzed: (\d+)/);
        const restockMatch = pythonOutput.match(/Medicines needing restock: (\d+)/);
        const totalOrderMatch = pythonOutput.match(/Total units to order: ([\d.]+)/);

        const summary = {
          total_medicines: summaryMatch ? parseInt(summaryMatch[1]) : 0,
          medicines_needing_restock: restockMatch ? parseInt(restockMatch[1]) : 0,
          total_units_to_order: totalOrderMatch ? parseFloat(totalOrderMatch[1]) : 0
        };

        res.status(200).json({
          success: true,
          forecast: forecastData,
          summary: summary
        });

      } catch (parseError) {
        console.error('Error parsing Python output:', parseError);
        res.status(500).json({ 
          error: 'Failed to parse forecast data',
          details: parseError.message 
        });
      }
    });

  } catch (error) {
    console.error('Error running demand forecast:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
}