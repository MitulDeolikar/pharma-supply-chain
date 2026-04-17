import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mysql from "mysql2";
import dbConfig from "../../middleware/dbConfig.js"; // adjust path if needed
const { logLogin } = require('../../lib/auditLogger');

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const connection = mysql.createConnection(dbConfig);

  try {
    connection.connect();

    // Check if the warehouse with the given email exists
    const [warehouseResult] = await connection
      .promise()
      .query("SELECT * FROM warehouse WHERE email = ?", [email]);

    const warehouse = warehouseResult[0];

    if (!warehouse) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Compare password
    const passwordMatch = await bcrypt.compare(password, warehouse.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Create JWT token
    const token = jwt.sign(
      { warehouse_id: warehouse.warehouse_id, role: 'warehouse' },
      process.env.JWT_SECRET || "hello",
      { expiresIn: "1h" }
    );

    logLogin({ user_type: 'warehouse', user_id: warehouse.warehouse_id, user_name: warehouse.name }).catch(() => {});

    res.status(200).json({
      success: true,
      message: "Warehouse login successful",
      warehouse: {
        warehouse_id: warehouse.warehouse_id,
        name: warehouse.name,
        email: warehouse.email,
        contact_number: warehouse.contact_number,
        district: warehouse.district,
        block: warehouse.block,
        address: warehouse.address,
      },
      token,
    });
  } catch (error) {
    console.error("Error logging in warehouse:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    connection.end();
  }
};

export default handler;
