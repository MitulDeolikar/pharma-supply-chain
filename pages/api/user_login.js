import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mysql from "mysql2";
import dbConfig from "../../middleware/dbConfig.js"; // adjust path if needed
const { logLogin } = require('../../lib/auditLogger');

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { username, password } = req.body;

  // ✅ Validate input
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const connection = mysql.createConnection(dbConfig);

  try {
    connection.connect();

    // ✅ Check if the pharmacy exists
    const [pharmacyResult] = await connection
      .promise()
      .query("SELECT * FROM pharmacy WHERE username = ?", [username]);
    const pharmacy = pharmacyResult[0];

    if (!pharmacy) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // ✅ Compare password
    const passwordMatch = await bcrypt.compare(password, pharmacy.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // ✅ Create JWT token
    const token = jwt.sign(
      { pharmacy_id: pharmacy.pharmacy_id, role: 'pharmacy' },
      process.env.JWT_SECRET || "hello",
      { expiresIn: "1h" }
    );

    logLogin({ user_type: 'pharmacy', user_id: pharmacy.pharmacy_id, user_name: pharmacy.pharmacy_name }).catch(() => {});

    res.status(200).json({
      success: true,
      message: "Pharmacy login successful",
      pharmacy: {
        id: pharmacy.pharmacy_id,
        pharmacy_name: pharmacy.pharmacy_name
      },
      token,
    });
  } catch (error) {
    console.error("Error logging in pharmacy:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    connection.end();
  }
}
