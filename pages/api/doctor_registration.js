import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { username, password, contact_number, district, block, address } = req.body;

    try {
        const connection = await mysql.createConnection(dbConfig);

        // Check if username already exists
        const [existingUsers] = await connection.execute(
            'SELECT username FROM Doctor WHERE username = ?',
            [username]
        );

        if (existingUsers.length > 0) {
            await connection.end();
            return res.status(400).json({
                success: false,
                error: 'Username already exists'
            });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new doctor
        const [result] = await connection.execute(
            'INSERT INTO Doctor (username, password, contact_number, district, block, address) VALUES (?, ?, ?, ?, ?, ?)',
            [username, hashedPassword, contact_number, district, block, address]
        );

        await connection.end();

        return res.status(200).json({
            success: true,
            message: 'Doctor registered successfully',
            doctorId: result.insertId
        });

    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}