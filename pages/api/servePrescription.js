import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { recordPrescriptionFinalization, verifyPrescriptionIntegrity } = require('./blockchainHelper');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { prescription_id, pharmacy_id } = req.body;

  if (!prescription_id || !pharmacy_id) {
    return res.status(400).json({
      success: false,
      message: 'Prescription ID and Pharmacy ID are required'
    });
  }

  try {
    const connection = await mysql.createConnection(dbConfig);

    // Check if prescription exists and is assigned to this pharmacy
    const [prescriptions] = await connection.execute(
      'SELECT prescription_id, opd_number, doctor_id, pharmacy_id, diagnosis FROM opd_prescriptions WHERE prescription_id = ?',
      [prescription_id]
    );

    if (prescriptions.length === 0) {
      await connection.end();
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    const prescription = prescriptions[0];

    // Verify this pharmacy is assigned to this prescription
    if (prescription.pharmacy_id !== pharmacy_id) {
      await connection.end();
      return res.status(403).json({
        success: false,
        message: 'This prescription is not assigned to your pharmacy'
      });
    }

    // Fetch medicine details
    const [medicineItems] = await connection.execute(
      'SELECT medicine_id, quantity, frequency, duration_days FROM opd_prescription_medicines WHERE prescription_id = ?',
      [prescription_id]
    );

    // 🔐 BLOCKCHAIN VERIFICATION: Check data integrity BEFORE serving
    console.log(`🔒 Running integrity verification for prescription #${prescription_id} before serving...`);

    const verificationResult = await verifyPrescriptionIntegrity(prescription_id, {
      prescriptionId: prescription_id,
      opdNumber: prescription.opd_number,
      doctorId: prescription.doctor_id,
      pharmacyId: prescription.pharmacy_id,
      diagnosis: prescription.diagnosis || '',
      medicines: medicineItems.map(m => ({
        medicine_id: m.medicine_id,
        quantity: m.quantity,
        frequency: m.frequency,
        duration_days: m.duration_days
      }))
    }, connection); // Pass connection to fetch stored metadata

    // Block serving if tampering is detected
    if (!verificationResult.isValid && !verificationResult.skipped && !verificationResult.notFound) {
      await connection.end();
      console.error(`🚨 SECURITY: Prescription #${prescription_id} failed integrity check before serving!`);
      return res.status(403).json({
        success: false,
        message: verificationResult.message || 'Data integrity check failed - possible tampering detected. Serving blocked.',
        securityAlert: true
      });
    }

    console.log(`✅ Integrity check passed for prescription #${prescription_id} - proceeding with serving`);

    // Update prescription status to served
    await connection.execute(
      'UPDATE opd_prescriptions SET served = 1 WHERE prescription_id = ?',
      [prescription_id]
    );

    // 🔗 BLOCKCHAIN: Record FINALIZATION (pharmacy served) and store metadata
    const blockchainResult = await recordPrescriptionFinalization({
      prescriptionId: prescription_id,
      opdNumber: prescription.opd_number,
      doctorId: prescription.doctor_id,
      pharmacyId: prescription.pharmacy_id,
      diagnosis: prescription.diagnosis || '',
      medicines: medicineItems.map(m => ({
        medicine_id: m.medicine_id,
        quantity: m.quantity,
        frequency: m.frequency,
        duration_days: m.duration_days
      })),
      action: 'PHARMACY_SERVED',
      remarks: `Prescription served by pharmacy ${pharmacy_id}`
    }).catch(err => {
      console.error('Blockchain recording failed (non-blocking):', err);
      return { success: false };
    });

    // Store blockchain metadata in database BEFORE sending response
    if (blockchainResult && blockchainResult.success) {
      try {
        await connection.execute(
          'UPDATE opd_prescriptions SET blockchain_timestamp = ?, blockchain_txhash = ?, blockchain_action = ? WHERE prescription_id = ?',
          [blockchainResult.timestamp, blockchainResult.txHash, 'PHARMACY_SERVED', prescription_id]
        );
        console.log(`✅ Blockchain metadata stored for prescription #${prescription_id}`);
      } catch (dbErr) {
        console.error('Failed to store blockchain metadata:', dbErr.message);
      }
    }

    await connection.end();

    return res.status(200).json({
      success: true,
      message: 'Prescription successfully served'
    });

  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error serving prescription',
      error: error.message
    });
  }
}
