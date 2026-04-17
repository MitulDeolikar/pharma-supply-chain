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

    // Check if the CMO with the given email exists
    const [cmoResult] = await connection
      .promise()
      .query("SELECT * FROM cmo WHERE email = ?", [email]);

    const cmo = cmoResult[0];

    if (!cmo) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Compare password
    const passwordMatch = await bcrypt.compare(password, cmo.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Create JWT token
    const token = jwt.sign(
      { cmo_id: cmo.cmo_id, role: 'cmo' },
      process.env.JWT_SECRET || "hello",
      { expiresIn: "1h" }
    );

    logLogin({ user_type: 'cmo', user_id: cmo.cmo_id, user_name: cmo.name }).catch(() => {});

    res.status(200).json({
      success: true,
      message: "CMO login successful",
      cmo: {
        id: cmo.cmo_id,
        name: cmo.name,
        email: cmo.email,
        contact_number: cmo.contact_number,
        district: cmo.district,
        block: cmo.block,
        address: cmo.address,
      },
      token,
    });
  } catch (error) {
    console.error("Error logging in CMO:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    connection.end();
  }
};

export default handler;
