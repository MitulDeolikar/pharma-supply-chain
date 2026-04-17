import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { recordPrescriptionFinalization, verifyPrescriptionIntegrity } = require('./blockchainHelper');
const { logActivity } = require('../../lib/auditLogger');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { prescription_id } = req.body;

  if (!prescription_id) {
    return res.status(400).json({
      success: false,
      message: 'Prescription ID is required'
    });
  }

  try {
    const connection = await mysql.createConnection(dbConfig);

    // First check if pharmacy_id is NULL (required for NAC)
    const [prescriptions] = await connection.execute(
      'SELECT prescription_id, pharmacy_id, NAC FROM opd_prescriptions WHERE prescription_id = ?',
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

    // Check if pharmacy_id is NULL (medicine not available)
    if (prescription.pharmacy_id !== null) {
      await connection.end();
      return res.status(400).json({
        success: false,
        message: 'Cannot issue NAC. Medicine is available in pharmacy.'
      });
    }

    // 🔐 BLOCKCHAIN VERIFICATION: Check data integrity BEFORE issuing NAC
    const [prescriptionDetails] = await connection.execute(
      `SELECT p.prescription_id, p.opd_number, p.doctor_id, p.pharmacy_id, p.diagnosis
       FROM opd_prescriptions p
       WHERE p.prescription_id = ?`,
      [prescription_id]
    );

    const [medicineItems] = await connection.execute(
      'SELECT medicine_id, quantity, frequency, duration_days FROM opd_prescription_medicines WHERE prescription_id = ?',
      [prescription_id]
    );

    const prescDetail = prescriptionDetails[0];
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

    if (!verificationResult.isValid && !verificationResult.skipped && !verificationResult.notFound) {
      await connection.end();
      console.error(`🚨 SECURITY: Prescription #${prescription_id} failed integrity check before NAC issuance!`);
      return res.status(403).json({
        success: false,
        message: verificationResult.message || 'Data integrity check failed - possible tampering detected. NAC issuance blocked.',
        securityAlert: true
      });
    }

    console.log(`✅ Integrity check passed for prescription #${prescription_id} - proceeding with NAC issuance`);

    // Update NAC status to 1
    await connection.execute(
      'UPDATE opd_prescriptions SET NAC = 1 WHERE prescription_id = ?',
      [prescription_id]
    );

    // 🔗 BLOCKCHAIN: Record NAC FINALIZATION (finality event) and store metadata
    const blockchainResult = await recordPrescriptionFinalization({
      prescriptionId: prescription_id,
      opdNumber: prescDetail.opd_number,
      doctorId: prescDetail.doctor_id,
      pharmacyId: null,
      diagnosis: prescDetail.diagnosis || '',
      medicines: medicineItems.map(m => ({
        medicine_id: m.medicine_id,
        quantity: m.quantity,
        frequency: m.frequency,
        duration_days: m.duration_days
      })),
      action: 'NAC_ISSUED',
      remarks: 'NAC issued - medicine not available'
    }).catch(err => {
      console.error('Blockchain recording failed (non-blocking):', err);
      return { success: false };
    });

    // Store blockchain metadata in database BEFORE sending response
    if (blockchainResult && blockchainResult.success) {
      try {
        await connection.execute(
          'UPDATE opd_prescriptions SET blockchain_timestamp = ?, blockchain_txhash = ?, blockchain_action = ? WHERE prescription_id = ?',
          [blockchainResult.timestamp, blockchainResult.txHash, 'NAC_ISSUED', prescription_id]
        );
        console.log(`✅ Blockchain metadata stored for prescription #${prescription_id}`);
      } catch (dbErr) {
        console.error('Failed to store blockchain metadata:', dbErr.message);
      }
    }

    await connection.end();

    logActivity({
      actor_type: 'doctor', actor_id: prescription.doctor_id, actor_name: `Doctor #${prescription.doctor_id}`,
      action: 'NAC_ISSUED', entity_type: 'prescription', entity_id: prescription_id,
      description: `Doctor #${prescription.doctor_id} issued Not Available Certificate (NAC) for prescription #${prescription_id} — medicine(s) unavailable in network`,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'NAC issued successfully',
      alreadyIssued: prescription.NAC === 1
    });

  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error issuing NAC',
      error: error.message
    });
  }
}
