import bcrypt from "bcryptjs";
import mysql from "mysql2";
import dbConfig from "../../middleware/dbConfig";

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { name, email, password, contact_number, district, block, address } = req.body;

  // Validate input
  if (!email || !password || !name) {
    return res
      .status(400)
      .json({ error: "Email, password, and name are required" });
  }

  const connection = mysql.createConnection(dbConfig);

  try {
    connection.connect();

    // Check if the email is already registered
    const [checkEmailResult] = await connection
      .promise()
      .query("SELECT * FROM cmo WHERE email = ?", [email]);

    if (checkEmailResult.length > 0) {
      return res.status(400).json({ error: "Email is already registered" });
    }

    // Hash the password before storing it in the database
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new CMO into the database
    await connection
      .promise()
      .query(
        `INSERT INTO cmo 
          (name, email, password, contact_number, district, block, address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, email, hashedPassword, contact_number, district, block, address]
      );

    res.status(201).json({
      success: true,
      message: "CMO registered successfully",
      email,
    });
  } catch (error) {
    console.error("Error registering CMO:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    connection.end();
  }
};

export default handler;
