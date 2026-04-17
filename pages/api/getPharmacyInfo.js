import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { getOrSet } = require('../../lib/cache');

export default async function handler(req, res) {
	if (req.method !== 'GET') {
		return res.status(405).json({ success: false, message: 'Method not allowed' });
	}

	try {
		const { pharmacyId } = req.query;
		if (!pharmacyId) {
			return res.status(400).json({ success: false, message: 'pharmacyId is required' });
		}

		const pharmacy = await getOrSet(`pharmacy:${pharmacyId}`, 43200, async () => {
			const connection = await mysql.createConnection(dbConfig);
			const [rows] = await connection.execute(
				`SELECT pharmacy_id, username as name, pharmacy_name, address, district, block, contact_number
				 FROM pharmacy
				 WHERE pharmacy_id = ?`,
				[pharmacyId]
			);
			await connection.end();
			if (!rows || rows.length === 0) return null;
			const { pharmacy_id, name, pharmacy_name, address, district, block, contact_number } = rows[0];
			return { pharmacy_id, name, pharmacy_name, address, district, block, contact_number };
		});

		if (!pharmacy) {
			return res.status(404).json({ success: false, message: 'Pharmacy not found' });
		}

		return res.status(200).json({ success: true, pharmacy });

	} catch (error) {
		console.error('getPharmacyInfo error:', error);
		return res.status(500).json({ success: false, message: 'Server error' });
	}
}

