import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { recordPrescriptionVersion } = require('./blockchainHelper');
const { logActivity } = require('../../lib/auditLogger');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { doctor_id, opd_number, diagnosis, medicines } = req.body;

    console.log('Received prescription data:', { doctor_id, opd_number, diagnosis, medicines });

    if (!doctor_id || !medicines || medicines.length === 0) {
        return res.status(400).json({
            success: false,
            message: `Missing required fields. Received: doctor_id=${!!doctor_id}, medicines=${!!medicines && medicines.length > 0}`
        });
    }

    // Validate opd_number is not empty
    if (!opd_number || opd_number.trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'OPD number is required and cannot be empty'
        });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        // Insert the prescription (no pharmacy_id provided by doctor)
        const [result] = await connection.execute(
            'INSERT INTO opd_prescriptions (doctor_id, opd_number, diagnosis) VALUES (?, ?, ?)',
            [doctor_id, opd_number, diagnosis || null]
        );

        const prescription_id = result.insertId;

        // Insert prescription medicines
        const medicineValues = medicines.map(medicine => [
            prescription_id,
            medicine.medicine_id,
            medicine.quantity,
            medicine.frequency,
            medicine.duration_days,
            medicine.instructions || null
        ]);

        await connection.query(
            'INSERT INTO opd_prescription_medicines (prescription_id, medicine_id, quantity, frequency, duration_days, instructions) VALUES ?',
            [medicineValues]
        );

        await connection.commit();

        // 🔗 BLOCKCHAIN: Record prescription VERSION (v1 - created) and store metadata
        const blockchainResult = await recordPrescriptionVersion({
            prescriptionId: prescription_id,
            opdNumber: opd_number,
            doctorId: doctor_id,
            pharmacyId: null, // Not served yet
            diagnosis: diagnosis || '',
            medicines: medicines.map(m => ({
                medicine_id: m.medicine_id,
                quantity: m.quantity,
                frequency: m.frequency,
                duration_days: m.duration_days
            })),
            remarks: `OPD: ${opd_number} - Created`
        }).catch(err => {
            console.error('Blockchain recording failed (non-blocking):', err);
            return { success: false };
        });

        // Store blockchain metadata in database BEFORE sending response
        if (blockchainResult && blockchainResult.success) {
            try {
                const dbConn = await mysql.createConnection(dbConfig);
                await dbConn.execute(
                    'UPDATE opd_prescriptions SET blockchain_timestamp = ?, blockchain_txhash = ?, blockchain_action = ? WHERE prescription_id = ?',
                    [blockchainResult.timestamp, blockchainResult.txHash, 'VERSION', prescription_id]
                );
                await dbConn.end();
                console.log(`✅ Blockchain metadata stored for prescription #${prescription_id}`);
            } catch (dbErr) {
                console.error('Failed to store blockchain metadata:', dbErr.message);
            }
        }

        await connection.end();

        logActivity({
          actor_type: 'doctor', actor_id: doctor_id, actor_name: `Doctor #${doctor_id}`,
          action: 'PRESCRIPTION_CREATED', entity_type: 'prescription', entity_id: prescription_id,
          description: `Doctor #${doctor_id} created prescription #${prescription_id} for patient ${opd_number} (${diagnosis || 'no diagnosis noted'})`,
          metadata: { opd_number, diagnosis, medicines_count: medicines.length }
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            message: 'Prescription created successfully',
            prescription_id
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
            await connection.end();
        }
        console.error('Database error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error creating prescription',
            error: error.message
        });
    }
}