import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { bin_id, pharmacy_id } = req.body;

        if (!bin_id || !pharmacy_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Bin ID and Pharmacy ID are required' 
            });
        }

        const connection = await mysql.createConnection(dbConfig);

        // Start transaction
        await connection.beginTransaction();

        try {
            // First, verify that the bin entry belongs to this pharmacy
            const verifyQuery = `
                SELECT mb.bin_id, mb.stock_id, s.stock_id, m.name as medicine_name
                FROM medicine_bin mb
                JOIN stock s ON mb.stock_id = s.stock_id
                JOIN medicines m ON s.medicine_id = m.medicine_id
                WHERE mb.bin_id = ? AND mb.pharmacy_id = ?
            `;

            const [binResult] = await connection.execute(verifyQuery, [bin_id, pharmacy_id]);

            if (binResult.length === 0) {
                await connection.rollback();
                await connection.end();
                return res.status(400).json({ 
                    success: false, 
                    message: 'Bin entry not found or does not belong to this pharmacy' 
                });
            }

            // Remove from medicine_bin table
            const deleteBinQuery = `
                DELETE FROM medicine_bin 
                WHERE bin_id = ? AND pharmacy_id = ?
            `;

            const [deleteResult] = await connection.execute(deleteBinQuery, [bin_id, pharmacy_id]);

            if (deleteResult.affectedRows === 0) {
                await connection.rollback();
                await connection.end();
                return res.status(400).json({ 
                    success: false, 
                    message: 'Failed to remove medicine from bin' 
                });
            }

            await connection.commit();
            await connection.end();

            res.status(200).json({
                success: true,
                message: `${binResult[0].medicine_name} has been restored from the bin successfully`
            });

        } catch (transactionError) {
            await connection.rollback();
            await connection.end();
            throw transactionError;
        }

    } catch (error) {
        console.error('Error restoring medicine from bin:', error);
        
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