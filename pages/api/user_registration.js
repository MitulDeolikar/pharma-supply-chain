import bcrypt from "bcryptjs";
import mysql from "mysql2";
import dbConfig from "../../middleware/dbConfig.js"; // adjust path if needed
const { invalidate, publish } = require('../../lib/cache');

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { pharmacy_name, username, password, contact_number, district, block, address } = req.body;

  // ✅ Validate required fields
  if (!pharmacy_name || !username || !password) {
    return res.status(400).json({ error: "Pharmacy name, username, and password are required" });
  }

  const connection = mysql.createConnection(dbConfig);

  try {
    connection.connect();

    // ✅ Check if the username is already registered
    const [existing] = await connection
      .promise()
      .query("SELECT * FROM pharmacy WHERE username = ?", [username]);

    if (existing.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // ✅ Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Insert into pharmacy table
    await connection
      .promise()
      .query(
        `INSERT INTO pharmacy 
          (pharmacy_name, username, password, contact_number, district, block, address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pharmacy_name, username, hashedPassword, contact_number, district, block, address]
      );

    // Invalidate pharmacy lists and prescription form data (which includes pharmacy dropdown)
    invalidate('pharmacies:all', 'prescription_form_data');
    publish('pharma:events', { type: 'pharmacy:registered', pharmacy_name });

    res.status(201).json({
      success: true,
      message: "Pharmacy registered successfully!",
    });

  } catch (error) {
    console.error("Error registering pharmacy:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    connection.end();
  }
};

export default handler;
