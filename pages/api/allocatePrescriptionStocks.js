import mysql from "mysql2";
import dbConfig from "../../middleware/dbConfig";
const { recordPrescriptionFinalization, verifyPrescriptionIntegrity } = require('./blockchainHelper');
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, publish } = require('../../lib/cache');

// POST /api/allocatePrescriptionStocks
// Body: { pharmacy_id: number, medicines: [{ medicine_id, requiredQuantity, name? }] }
// Allocates requiredQuantity from stocks with earliest expiry first (FEFO).
// If all medicines can be fulfilled, updates stock quantities in a transaction and returns allocation details.
// If any medicine cannot be fully fulfilled, no DB changes are made and a descriptive error is returned.

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const { pharmacy_id, medicines, prescription_id } = req.body || {};
  if (!pharmacy_id || !prescription_id || !Array.isArray(medicines) || medicines.length === 0) {
    return res.status(400).json({ success: false, message: "Missing pharmacy_id, prescription_id or medicines in request body" });
  }

  const connection = mysql.createConnection(dbConfig);

  try {
    connection.connect();
    await connection.promise().beginTransaction();

    // 🔐 BLOCKCHAIN VERIFICATION: Check data integrity BEFORE allocating stocks
    const [prescriptionDetails] = await connection.promise().query(
      `SELECT p.prescription_id, p.opd_number, p.doctor_id, p.pharmacy_id, p.diagnosis
       FROM opd_prescriptions p
       WHERE p.prescription_id = ?`,
      [prescription_id]
    );

    if (prescriptionDetails.length === 0) {
      await connection.promise().rollback();
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    const [medicineItems] = await connection.promise().query(
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
      })),
      action: 'VERSION' // Verify against LATEST VERSION (not just creation)
    });

    if (!verificationResult.isValid && !verificationResult.skipped && !verificationResult.notFound) {
      await connection.promise().rollback();
      console.error(`🚨 SECURITY: Prescription #${prescription_id} failed integrity check before pharmacy serving!`);
      return res.status(403).json({
        success: false,
        message: verificationResult.message || 'Data integrity check failed - possible tampering detected. Pharmacy serving blocked.',
        securityAlert: true
      });
    }

    console.log(`✅ Integrity check passed for prescription #${prescription_id} - proceeding with pharmacy serving`);

    const allocationsResult = {};
    const shortages = [];

    // First pass: check availability for all medicines
    for (const med of medicines) {
      const medId = med.medicine_id || med.id;
      const needed = Number(med.requiredQuantity ?? med.quantity ?? 0);
      if (!medId || needed <= 0) {
        allocationsResult[medId || med.name || "unknown"] = { allocations: [], needed, message: "No quantity required or missing medicine_id" };
        continue;
      }

      const [rows] = await connection.promise().query(
        `SELECT stock_id, quantity, batch_number, expiry_date, price_per_unit
         FROM stock
         WHERE pharmacy_id = ? AND medicine_id = ? AND quantity > 0 AND expiry_date > NOW()
         ORDER BY expiry_date ASC`,
        [pharmacy_id, medId]
      );

      const totalAvailable = rows.reduce((s, r) => s + parseFloat(r.quantity || 0), 0);
      if (totalAvailable < needed) {
        shortages.push({ medicine_id: medId, needed, available: totalAvailable, name: med.name || null });
      }
      // store rows for second pass
      allocationsResult[medId] = { rows, needed, allocations: [] };
    }

    if (shortages.length > 0) {
      await connection.promise().rollback();
      return res.status(400).json({
        success: false,
        message: "Insufficient stock for one or more medicines",
        shortages,
      });
    }

    // Second pass: perform allocations and update stocks
    for (const key of Object.keys(allocationsResult)) {
      const entry = allocationsResult[key];
      const medId = key;
      let remaining = Number(entry.needed || 0);
      const rows = entry.rows || [];

      for (const row of rows) {
        if (remaining <= 0) break;
        const available = parseFloat(row.quantity || 0);
        if (available <= 0) continue;

        const allocateQty = Math.min(available, remaining);
        const newQty = parseFloat((available - allocateQty).toFixed(2));

        // Update DB
        await connection.promise().query(
          `UPDATE stock SET quantity = ? WHERE stock_id = ?`,
          [newQty, row.stock_id]
        );

        // Record allocation detail
        entry.allocations.push({
          stock_id: row.stock_id,
          batch_number: row.batch_number,
          expiry_date: row.expiry_date,
          price_per_unit: row.price_per_unit,
          allocated: allocateQty,
          previous_quantity: available,
          new_quantity: newQty,
        });

        remaining -= allocateQty;
      }

      // Sanity check
      if (remaining > 0) {
        // This shouldn't happen because we checked availability earlier, but just in case rollback
        await connection.promise().rollback();
        return res.status(500).json({ success: false, message: `Allocation failed for medicine ${medId}` });
      }
    }

    // After preparing all stock updates, attempt to assign this prescription to the pharmacy
    // within the same transaction to make allocation + assignment atomic.
    try {
      const [assignResult] = await connection.promise().query(
        `UPDATE opd_prescriptions SET pharmacy_id = ? WHERE prescription_id = ? AND (pharmacy_id IS NULL OR pharmacy_id = '')`,
        [pharmacy_id, prescription_id]
      );

      // If no rows were affected, the prescription was already assigned — rollback and inform caller
      if (assignResult.affectedRows === 0) {
        await connection.promise().rollback();
        return res.status(409).json({ success: false, message: 'Prescription already assigned to another pharmacy' });
      }
    } catch (e) {
      console.error('Error assigning prescription to pharmacy:', e);
      try {
        await connection.promise().rollback();
      } catch (rbErr) {
        console.error('Rollback error after assignment failure:', rbErr);
      }
      return res.status(500).json({ success: false, message: 'Allocation succeeded but failed to assign prescription', error: e.message });
    }

    // Log sales history for each medicine allocated
    try {
      for (const key of Object.keys(allocationsResult)) {
        const entry = allocationsResult[key];
        const medId = key;
        const totalAllocated = entry.allocations.reduce((sum, allocation) => sum + allocation.allocated, 0);
        
        if (totalAllocated > 0) {
          await connection.promise().query(
            `INSERT INTO pharmacy_sales_history (pharmacy_id, medicine_id, quantity_sold, transaction_date, sale_type) 
             VALUES (?, ?, ?, CURDATE(), 'customer')`,
            [pharmacy_id, medId, totalAllocated]
          );
        }
      }
    } catch (e) {
      console.error('Error logging sales history:', e);
      // Don't rollback the main transaction for sales history logging failure
      // The allocation was successful, sales history is supplementary
    }

    // Commit only after successful assignment and sales history logging
    await connection.promise().commit();

    // Invalidate: pharmacy stock (deducted) and sales analytics
    invalidate(`stock:${pharmacy_id}`, `sales:${pharmacy_id}`);
    publish('pharma:events', { type: 'prescription:served', prescription_id, pharmacy_id, doctor_id: prescDetail.doctor_id, opd_number: prescDetail.opd_number });

    // 🔗 BLOCKCHAIN: Record pharmacy FINALIZATION (finality event)
    recordPrescriptionFinalization({
      prescriptionId: prescription_id,
      opdNumber: prescDetail.opd_number,
      doctorId: prescDetail.doctor_id,
      pharmacyId: pharmacy_id,
      diagnosis: prescDetail.diagnosis || '',
      medicines: medicineItems.map(m => ({
        medicine_id: m.medicine_id,
        quantity: m.quantity,
        frequency: m.frequency,
        duration_days: m.duration_days
      })),
      action: 'PHARMACY_SERVED',
      remarks: `Served by pharmacy ${pharmacy_id}`
    }).catch(err => {
      console.error('Blockchain recording failed (non-blocking):', err);
    });

    // Build nice response without raw rows
    const responseAllocations = {};
    for (const k of Object.keys(allocationsResult)) {
      const entry = allocationsResult[k];
      responseAllocations[k] = {
        needed: entry.needed,
        allocations: entry.allocations,
      };
    }

    // Fetch medicine names for audit metadata
    const medIds = Object.keys(responseAllocations).filter(Boolean);
    let medNameMap = {};
    if (medIds.length > 0) {
      try {
        const [medRows] = await connection.promise().query(
          `SELECT medicine_id, name, dosage FROM medicines WHERE medicine_id IN (${medIds.map(() => '?').join(',')})`,
          medIds
        );
        medRows.forEach(r => { medNameMap[r.medicine_id] = `${r.name}${r.dosage ? ' ' + r.dosage : ''}`; });
      } catch (_) {}
    }

    // Build allocation summary for audit log
    const allocationSummary = medIds.map(medId => ({
      medicine_id: Number(medId),
      medicine_name: medNameMap[medId] || `Medicine #${medId}`,
      quantity_allocated: responseAllocations[medId].needed,
      batches: (responseAllocations[medId].allocations || []).map(a => ({
        batch_number: a.batch_number,
        quantity: a.allocated,
        expiry_date: a.expiry_date,
      })),
    }));

    logActivity({
      actor_type: 'pharmacy', actor_id: pharmacy_id, actor_name: `Pharmacy #${pharmacy_id}`,
      action: 'PRESCRIPTION_SERVED', entity_type: 'prescription', entity_id: prescription_id,
      description: `Pharmacy #${pharmacy_id} served prescription #${prescription_id} — stock deducted for ${medIds.length} medicine(s)`,
      metadata: { medicines_count: medIds.length, allocations: allocationSummary }
    }).catch(() => {});

    return res.status(200).json({ success: true, message: "Allocation successful", allocations: responseAllocations });
  } catch (error) {
    console.error("Error allocating stocks:", error);
    try {
      await connection.promise().rollback();
    } catch (e) {
      console.error("Rollback error:", e);
    }
    return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  } finally {
    connection.end();
  }
};

export default handler;
