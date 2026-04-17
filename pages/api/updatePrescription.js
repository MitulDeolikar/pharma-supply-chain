import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { recordPrescriptionVersion, verifyPrescriptionIntegrity } = require('./blockchainHelper');

export default async function handler(req, res) {
    if (req.method !== 'PUT') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { prescription_id, diagnosis, pharmacy_id, medicines } = req.body;

    console.log('Received update data:', { prescription_id, diagnosis, pharmacy_id, medicines });

    if (!prescription_id || !medicines || medicines.length === 0) {
        return res.status(400).json({
            success: false,
            message: `Missing required fields. Received: prescription_id=${!!prescription_id}, medicines=${!!medicines && medicines.length > 0}`
        });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        // 🔐 BLOCKCHAIN VERIFICATION: Verify current data before editing
        const [prescDetails] = await connection.execute(
            'SELECT prescription_id, opd_number, doctor_id, pharmacy_id, diagnosis FROM opd_prescriptions WHERE prescription_id = ?',
            [prescription_id]
        );

        if (prescDetails.length === 0) {
            await connection.end();
            return res.status(404).json({
                success: false,
                message: 'Prescription not found'
            });
        }

        const prescDetail = prescDetails[0];

        // Fetch current medicines before editing
        const [medicineItems] = await connection.execute(
            'SELECT medicine_id, quantity, frequency, duration_days FROM opd_prescription_medicines WHERE prescription_id = ?',
            [prescription_id]
        );

        console.log(`🔒 Running integrity verification for prescription #${prescription_id} before editing...`);

        // Verify data integrity against blockchain BEFORE making changes
        const verificationResult = await verifyPrescriptionIntegrity(prescription_id, {
            prescriptionId: prescription_id,
            opdNumber: prescDetail.opd_number,
            doctorId: prescDetail.doctor_id,
            pharmacyId: prescDetail.pharmacy_id,
            diagnosis: prescDetail.diagnosis || '',
            medicines: medicineItems.map(m => ({
                medicine_id: m.medicine_id,
                quantity: m.quantity,
                frequency: m.frequency,
                duration_days: m.duration_days
            }))
        }, connection); // Pass connection to fetch stored metadata

        // Block edit if tampering is detected
        if (!verificationResult.isValid && !verificationResult.skipped && !verificationResult.notFound) {
            await connection.end();
            console.error(`🚨 SECURITY: Prescription #${prescription_id} failed integrity check before edit!`);
            return res.status(403).json({
                success: false,
                message: verificationResult.message || 'Data integrity check failed - possible tampering detected. Edit blocked.',
                securityAlert: true
            });
        }

        console.log(`✅ Integrity check passed for prescription #${prescription_id} - proceeding with edit`);

        await connection.beginTransaction();

        // Update the prescription (only update fields that should be updated by doctor)
        await connection.execute(
            'UPDATE opd_prescriptions SET diagnosis = ? WHERE prescription_id = ?',
            [diagnosis || null, prescription_id]
        );

        // Delete existing medicine entries
        await connection.execute(
            'DELETE FROM opd_prescription_medicines WHERE prescription_id = ?',
            [prescription_id]
        );

        // Insert updated medicine entries
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

        // 🔗 BLOCKCHAIN: Record prescription VERSION (edited) and store metadata
        const blockchainResult = await recordPrescriptionVersion({
            prescriptionId: prescription_id,
            opdNumber: prescDetail.opd_number,
            doctorId: prescDetail.doctor_id,
            pharmacyId: prescDetail.pharmacy_id,
            diagnosis: diagnosis || '',
            medicines: medicines.map(m => ({
                medicine_id: m.medicine_id,
                quantity: m.quantity,
                frequency: m.frequency,
                duration_days: m.duration_days
            })),
            remarks: 'Prescription edited by doctor'
        }).catch(err => {
            console.error('Blockchain recording failed (non-blocking):', err);
            return { success: false };
        });

        // Store blockchain metadata in database BEFORE sending response
        if (blockchainResult && blockchainResult.success) {
            try {
                await connection.execute(
                    'UPDATE opd_prescriptions SET blockchain_timestamp = ?, blockchain_txhash = ?, blockchain_action = ? WHERE prescription_id = ?',
                    [blockchainResult.timestamp, blockchainResult.txHash, 'VERSION', prescription_id]
                );
                console.log(`✅ Blockchain metadata stored for prescription #${prescription_id}`);
            } catch (dbErr) {
                console.error('Failed to store blockchain metadata:', dbErr.message);
            }
        }

        await connection.end();

        return res.status(200).json({
            success: true,
            message: 'Prescription updated successfully'
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
            await connection.end();
        }
        console.error('Database error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating prescription',
            error: error.message
        });
    }
}