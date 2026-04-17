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
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  const connection = mysql.createConnection(dbConfig);

  try {
    connection.connect();

    // ✅ Check if the doctor exists
    const [doctorResult] = await connection
      .promise()
      .query("SELECT * FROM doctor WHERE username = ?", [username]);
    const doctor = doctorResult[0];

    if (!doctor) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // ✅ Compare password
    const passwordMatch = await bcrypt.compare(password, doctor.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // ✅ Create JWT token
    const token = jwt.sign(
      { doctor_id: doctor.doctor_id, role: 'doctor' },
      process.env.JWT_SECRET || "hello",
      { expiresIn: "1h" }
    );

    logLogin({ user_type: 'doctor', user_id: doctor.doctor_id, user_name: doctor.username }).catch(() => {});

    res.status(200).json({
      success: true,
      message: "Doctor login successful",
      doctor: {
        doctor_id: doctor.doctor_id,
        username: doctor.username,
        contact_number: doctor.contact_number,
        district: doctor.district,
        block: doctor.block,
        address: doctor.address,
      },
      token,
    });
  } catch (error) {
    console.error("Error logging in doctor:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    connection.end();
  }
}
