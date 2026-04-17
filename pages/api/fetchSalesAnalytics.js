import mysql from "mysql2";
import dbConfig from "../../middleware/dbConfig";
const { getOrSet } = require("../../lib/cache");

// GET /api/fetchSalesAnalytics
// Returns comprehensive sales analytics for a specific pharmacy including:
// - All sales transactions with details
// - Sales by type (customer vs emergency)
// - Monthly and yearly analytics
// - Medicine-wise sales data

const handler = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const { pharmacy_id } = req.query;

  if (!pharmacy_id) {
    return res.status(400).json({
      success: false,
      message: "pharmacy_id parameter is required"
    });
  }

  try {
    const data = await getOrSet(`sales:${pharmacy_id}`, 900, async () => {
      const connection = mysql.createConnection(dbConfig);
      connection.connect();
      try {

    // Get all sales transactions with medicine and pharmacy details for specific pharmacy
    const [allTransactions] = await connection.promise().query(`
      SELECT 
        psh.id,
        psh.pharmacy_id,
        p.pharmacy_name,
        psh.medicine_id,
        m.name as medicine_name,
        m.dosage,
        m.unit,
        m.manufacturer,
        psh.quantity_sold,
        psh.transaction_date,
        psh.sale_type,
        psh.created_at
      FROM pharmacy_sales_history psh
      JOIN pharmacy p ON psh.pharmacy_id = p.pharmacy_id
      JOIN medicines m ON psh.medicine_id = m.medicine_id
      WHERE psh.pharmacy_id = ?
      ORDER BY psh.transaction_date DESC, psh.created_at DESC
    `, [pharmacy_id]);

    // Get sales summary by type for specific pharmacy
    const [salesByType] = await connection.promise().query(`
      SELECT 
        sale_type,
        COUNT(*) as transaction_count,
        SUM(quantity_sold) as total_quantity_sold
      FROM pharmacy_sales_history
      WHERE pharmacy_id = ?
      GROUP BY sale_type
    `, [pharmacy_id]);

    // Get monthly sales analytics for current year for specific pharmacy
    const [monthlySales] = await connection.promise().query(`
      SELECT 
        YEAR(transaction_date) as year,
        MONTH(transaction_date) as month,
        MONTHNAME(transaction_date) as month_name,
        sale_type,
        COUNT(*) as transaction_count,
        SUM(quantity_sold) as total_quantity_sold
      FROM pharmacy_sales_history
      WHERE pharmacy_id = ? AND YEAR(transaction_date) = YEAR(CURDATE())
      GROUP BY YEAR(transaction_date), MONTH(transaction_date), MONTHNAME(transaction_date), sale_type
      ORDER BY year DESC, month DESC
    `, [pharmacy_id]);

    // Get yearly sales analytics for specific pharmacy
    const [yearlySales] = await connection.promise().query(`
      SELECT 
        YEAR(transaction_date) as year,
        sale_type,
        COUNT(*) as transaction_count,
        SUM(quantity_sold) as total_quantity_sold
      FROM pharmacy_sales_history
      WHERE pharmacy_id = ?
      GROUP BY YEAR(transaction_date), sale_type
      ORDER BY year DESC
    `, [pharmacy_id]);

    // Get medicine-wise sales analytics for specific pharmacy
    const [medicineWiseSales] = await connection.promise().query(`
      SELECT 
        m.medicine_id,
        m.name as medicine_name,
        m.dosage,
        m.unit,
        m.manufacturer,
        psh.sale_type,
        COUNT(*) as transaction_count,
        SUM(psh.quantity_sold) as total_quantity_sold
      FROM pharmacy_sales_history psh
      JOIN medicines m ON psh.medicine_id = m.medicine_id
      WHERE psh.pharmacy_id = ?
      GROUP BY m.medicine_id, m.name, m.dosage, m.unit, m.manufacturer, psh.sale_type
      ORDER BY total_quantity_sold DESC
    `, [pharmacy_id]);

    // Get top performing medicines for specific pharmacy
    const [topMedicines] = await connection.promise().query(`
      SELECT 
        m.medicine_id,
        m.name as medicine_name,
        m.dosage,
        m.unit,
        COUNT(*) as total_transactions,
        SUM(psh.quantity_sold) as total_quantity_sold
      FROM pharmacy_sales_history psh
      JOIN medicines m ON psh.medicine_id = m.medicine_id
      WHERE psh.pharmacy_id = ?
      GROUP BY m.medicine_id, m.name, m.dosage, m.unit
      ORDER BY total_quantity_sold DESC
      LIMIT 10
    `, [pharmacy_id]);

    // Get pharmacy information
    const [pharmacyInfo] = await connection.promise().query(`
      SELECT 
        pharmacy_id,
        pharmacy_name,
        contact_number
      FROM pharmacy
      WHERE pharmacy_id = ?
    `, [pharmacy_id]);

    // Get recent transactions (last 30 days) for specific pharmacy
    const [recentTransactions] = await connection.promise().query(`
      SELECT 
        psh.id,
        psh.pharmacy_id,
        p.pharmacy_name,
        psh.medicine_id,
        m.name as medicine_name,
        m.dosage,
        m.unit,
        psh.quantity_sold,
        psh.transaction_date,
        psh.sale_type,
        psh.created_at
      FROM pharmacy_sales_history psh
      JOIN pharmacy p ON psh.pharmacy_id = p.pharmacy_id
      JOIN medicines m ON psh.medicine_id = m.medicine_id
      WHERE psh.pharmacy_id = ? AND psh.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      ORDER BY psh.transaction_date DESC, psh.created_at DESC
      LIMIT 50
    `, [pharmacy_id]);

      return {
        pharmacyInfo: pharmacyInfo[0] || null,
        allTransactions,
        salesByType,
        monthlySales,
        yearlySales,
        medicineWiseSales,
        topMedicines,
        recentTransactions
      };
      } finally {
        if (connection && connection.state !== 'disconnected') connection.end();
      }
    });

    return res.status(200).json({ success: true, data });

  } catch (error) {
    console.error("Error fetching sales analytics:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
};

export default handler;