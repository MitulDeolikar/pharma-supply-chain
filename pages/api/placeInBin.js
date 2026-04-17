import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { stock_id, pharmacy_id } = req.body;

        if (!stock_id || !pharmacy_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Stock ID and Pharmacy ID are required' 
            });
        }

        const connection = await mysql.createConnection(dbConfig);

        // Start transaction
        await connection.beginTransaction();

        try {
            // First, verify that the stock belongs to this pharmacy and is expired
            const verifyQuery = `
                SELECT s.stock_id, s.quantity, s.expiry_date, m.name as medicine_name
                FROM stock s
                JOIN medicines m ON s.medicine_id = m.medicine_id
                WHERE s.stock_id = ? AND s.pharmacy_id = ? AND s.expiry_date < CURDATE()
            `;

            const [stockResult] = await connection.execute(verifyQuery, [stock_id, pharmacy_id]);

            if (stockResult.length === 0) {
                await connection.rollback();
                await connection.end();
                return res.status(400).json({ 
                    success: false, 
                    message: 'Stock not found, does not belong to this pharmacy, or is not expired' 
                });
            }

            // Check if this stock is already in the bin
            const binCheckQuery = `
                SELECT bin_id FROM medicine_bin 
                WHERE stock_id = ? AND pharmacy_id = ?
            `;

            const [binCheckResult] = await connection.execute(binCheckQuery, [stock_id, pharmacy_id]);

            if (binCheckResult.length > 0) {
                await connection.rollback();
                await connection.end();
                return res.status(400).json({ 
                    success: false, 
                    message: 'This medicine is already in the bin' 
                });
            }

            // Insert into medicine_bin table
            const insertBinQuery = `
                INSERT INTO medicine_bin (stock_id, pharmacy_id, binned_date)
                VALUES (?, ?, NOW())
            `;

            await connection.execute(insertBinQuery, [stock_id, pharmacy_id]);

            // Update stock quantity to 0 (or you could keep it as is for tracking)
            // For now, we'll keep the quantity but mark it as binned by the bin table entry
            
            await connection.commit();
            await connection.end();

            res.status(200).json({
                success: true,
                message: `${stockResult[0].medicine_name} has been placed in the bin successfully`
            });

        } catch (transactionError) {
            await connection.rollback();
            await connection.end();
            throw transactionError;
        }

    } catch (error) {
        console.error('Error placing medicine in bin:', error);
        
        // Check if it's a table doesn't exist error
        if (error.message.includes("medicine_bin")) {
            res.status(500).json({
                success: false,
                message: 'Database schema needs to be updated. Please create medicine_bin table.',
                sqlError: 'CREATE TABLE medicine_bin (bin_id INT AUTO_INCREMENT PRIMARY KEY, stock_id INT, pharmacy_id INT, binned_date DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (stock_id) REFERENCES stock(stock_id), FOREIGN KEY (pharmacy_id) REFERENCES pharmacy(pharmacy_id));'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}