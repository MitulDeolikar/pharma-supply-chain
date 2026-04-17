import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { recordRequestOnBlockchain } = require('./blockchainHelper');
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, invalidatePattern, publish } = require('../../lib/cache');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            message: 'Method not allowed'
        });
    }

    const { pharmacy_id, medicines, remarks } = req.body;

    if (!pharmacy_id || !medicines || !Array.isArray(medicines) || medicines.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields'
        });
    }

    // Validate and sanitize incoming medicines array.
    const validatedMedicines = [];
    for (let i = 0; i < medicines.length; i++) {
        const m = medicines[i] || {};
        const medIdRaw = m.medicine_id ?? m.medicineId ?? null;
        const genIdRaw = m.generic_id ?? m.genericId ?? null;
        const medId = medIdRaw ? String(medIdRaw).trim() : null;
        const genId = genIdRaw ? String(genIdRaw).trim() : null;
        const qty = Number(m.quantity_requested ?? m.quantityRequested ?? 0);

        if (!medId && !genId) {
            return res.status(400).json({ success: false, message: `Medicine entry #${i + 1} must include either medicine_id or generic_id` });
        }

        if (!Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({ success: false, message: `Medicine entry #${i + 1} has invalid quantity` });
        }

        // If branded provided, clear generic; if generic provided, clear medicine
        const finalMedId = medId || null;
        const finalGenId = finalMedId ? null : (genId || null);

        validatedMedicines.push({ medicine_id: finalMedId, generic_id: finalGenId, quantity_requested: qty });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        
        // 🔍 VALIDATION: Check if pharmacy already has sufficient stock for requested medicines
        // Separate medicine_id and generic_id requests
        const medicineIds = validatedMedicines
            .filter(m => m.medicine_id !== null)
            .map(m => Number(m.medicine_id));
        const genericIds = validatedMedicines
            .filter(m => m.generic_id !== null)
            .map(m => Number(m.generic_id));

        // Check specific medicines stock
        if (medicineIds.length > 0) {
            const medicinePlaceholders = medicineIds.map(() => '?').join(',');
            const [medicineStocks] = await connection.execute(`
                SELECT s.medicine_id, SUM(s.quantity) as total_quantity
                FROM stock s
                WHERE s.pharmacy_id = ?
                AND s.medicine_id IN (${medicinePlaceholders})
                AND s.expiry_date > CURDATE()
                GROUP BY s.medicine_id
            `, [pharmacy_id, ...medicineIds]);

            const medicineStockMap = new Map(medicineStocks.map(s => [s.medicine_id, s.total_quantity]));

            // Get medicine names for detailed error message
            const [medicineNames] = await connection.execute(`
                SELECT medicine_id, name, dosage, unit FROM medicines WHERE medicine_id IN (${medicinePlaceholders})
            `, medicineIds);
            const medicineNameMap = new Map(medicineNames.map(m => [m.medicine_id, m]));

            // Check each requested medicine
            for (const m of validatedMedicines) {
                if (m.medicine_id !== null) {
                    const ownStock = medicineStockMap.get(Number(m.medicine_id)) || 0;
                    if (ownStock >= m.quantity_requested) {
                        const medInfo = medicineNameMap.get(Number(m.medicine_id));
                        const medName = medInfo ? `${medInfo.name} (${medInfo.dosage} ${medInfo.unit || ''})` : `Medicine ID: ${m.medicine_id}`;
                        await connection.end();
                        return res.status(400).json({
                            success: false,
                            message: `❌ Stock Conflict Detected - Request Rejected`,
                            details: `The medicine "${medName}" has sufficient stock in your pharmacy:\n\nYou requested: ${m.quantity_requested} units\nYour current stock: ${ownStock} units\n\nSince you already have enough stock, creating an emergency request is unnecessary. Please use your existing inventory to fulfill patient demands.`
                        });
                    }
                }
            }
        }

        // Check generic medicines stock
        if (genericIds.length > 0) {
            const genericPlaceholders = genericIds.map(() => '?').join(',');
            const [genericStocks] = await connection.execute(`
                SELECT m.generic_id, SUM(s.quantity) as total_quantity
                FROM stock s
                JOIN medicines m ON s.medicine_id = m.medicine_id
                WHERE s.pharmacy_id = ?
                AND m.generic_id IN (${genericPlaceholders})
                AND s.expiry_date > CURDATE()
                GROUP BY m.generic_id
            `, [pharmacy_id, ...genericIds]);

            const genericStockMap = new Map(genericStocks.map(s => [s.generic_id, s.total_quantity]));

            // Get generic names for detailed error message
            const [genericNames] = await connection.execute(`
                SELECT generic_id, generic_name FROM generic_medicines WHERE generic_id IN (${genericPlaceholders})
            `, genericIds);
            const genericNameMap = new Map(genericNames.map(g => [g.generic_id, g.generic_name]));

            // Check each requested generic medicine
            for (const m of validatedMedicines) {
                if (m.generic_id !== null) {
                    const ownGenericStock = genericStockMap.get(Number(m.generic_id)) || 0;
                    if (ownGenericStock >= m.quantity_requested) {
                        const genName = genericNameMap.get(Number(m.generic_id)) || `Generic ID: ${m.generic_id}`;
                        await connection.end();
                        return res.status(400).json({
                            success: false,
                            message: `❌ Stock Conflict Detected - Request Rejected`,
                            details: `The generic category "${genName}" has sufficient combined stock in your pharmacy:\n\nYou requested: ${m.quantity_requested} units\nYour current stock (all medicines in this category): ${ownGenericStock} units\n\nSince you already have enough stock, creating an emergency request is unnecessary. Please use your existing inventory to fulfill patient demands.`
                        });
                    }
                }
            }
        }

        await connection.beginTransaction();

        // 1️⃣ Create emergency request
        const [result] = await connection.execute(
            'INSERT INTO pharmacy_emergency_requests (pharmacy_id, remarks) VALUES (?, ?)',
            [pharmacy_id, remarks || null]
        );

        const request_id = result.insertId;

        // 2️⃣ Insert request items
        // Support items that may specify a `generic_id` instead of `medicine_id`.
        const itemValues = [];
        for (const m of validatedMedicines) {
            const medId = m.medicine_id || null;
            const genId = m.generic_id || null;
            itemValues.push([request_id, medId, genId, m.quantity_requested]);
        }

        await connection.query(
            'INSERT INTO pharmacy_emergency_request_items (request_id, medicine_id, generic_id, quantity_requested) VALUES ?',
            [itemValues]
        );

        await connection.commit();

        // 3️⃣ Enrich emergency request with pharmacy and medicine names; send SMS to CMOs via Twilio (best-effort)
        let pharmacyName = `Pharmacy ${pharmacy_id}`;
        let responseItems = [];
        try {
            // pharmacy name
            const [phRows] = await connection.execute('SELECT pharmacy_name FROM pharmacy WHERE pharmacy_id = ?', [pharmacy_id]);
            if (phRows && phRows.length > 0 && phRows[0].pharmacy_name) {
                pharmacyName = phRows[0].pharmacy_name;
            }

            // medicines array may contain `medicine_id` or `generic_id`.
            const medIds = validatedMedicines.map(m => m.medicine_id).filter(Boolean);
            if (medIds.length > 0) {
                const placeholders = medIds.map(() => '?').join(',');
                const [medRows] = await connection.execute(
                    `SELECT medicine_id, name FROM medicines WHERE medicine_id IN (${placeholders})`,
                    medIds
                );
                const medMap = new Map(medRows.map(m => [String(m.medicine_id), m.name]));
                // map medicine items
                responseItems = validatedMedicines.map(m => ({
                    medicine_id: m.medicine_id || null,
                    generic_id: m.generic_id || null,
                    name: m.medicine_id ? (medMap.get(String(m.medicine_id)) || 'Unknown') : null,
                    quantity_requested: m.quantity_requested
                }));
            } else {
                // no direct medicine ids; build placeholders for generics if present
                responseItems = validatedMedicines.map(m => ({
                    medicine_id: m.medicine_id || null,
                    generic_id: m.generic_id || null,
                    name: null,
                    quantity_requested: m.quantity_requested
                }));
            }

            // For items with generic_id and no name, fetch generic names
            const genericIdsToFetch = Array.from(new Set(responseItems.filter(it => it.generic_id && !it.name).map(it => it.generic_id)));
            if (genericIdsToFetch.length > 0) {
                const placeholdersG = genericIdsToFetch.map(() => '?').join(',');
                const [gRows] = await connection.execute(`SELECT generic_id, generic_name FROM generic_medicines WHERE generic_id IN (${placeholdersG})`, genericIdsToFetch);
                const gMap = new Map(gRows.map(g => [String(g.generic_id), g.generic_name]));
                responseItems = responseItems.map(it => ({
                    ...it,
                    name: it.name || (it.generic_id ? (gMap.get(String(it.generic_id)) || 'Unknown Generic') : it.name)
                }));
            }

            const [cmos] = await connection.execute('SELECT contact_number FROM cmo WHERE contact_number IS NOT NULL');
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            const fromNumber = process.env.TWILIO_FROM_NUMBER;

            const sendSms = async (to, message) => {
                if (!accountSid || !authToken || !fromNumber) {
                    console.warn('Twilio not configured, skipping SMS');
                    return;
                }

                let mobile = (to || '').toString().replace(/[^0-9]/g, '');
                if (mobile.length === 10) mobile = '91' + mobile;
                if (!mobile.startsWith('+')) mobile = '+' + mobile;

                const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
                const payload = new URLSearchParams({ To: mobile, From: fromNumber, Body: message });

                try {
                    let resp;
                    if (typeof fetch === 'function') {
                        resp = await fetch(url, {
                            method: 'POST',
                            headers: {
                                Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                                'Content-Type': 'application/x-www-form-urlencoded'
                            },
                            body: payload
                        });
                    } else {
                        
                        resp = await fetch(url, {
                            method: 'POST',
                            headers: {
                                Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                                'Content-Type': 'application/x-www-form-urlencoded'
                            },
                            body: payload
                        });
                    }

                    const text = await resp.text();
                    if (!resp.ok) {
                        console.error('Twilio error:', resp.status, text);
                    } else {
                        console.log('Twilio response:', text);
                    }
                } catch (err) {
                    console.error('SMS send failed via Twilio:', err.message || err);
                }
            };

            const itemsSummary = responseItems.length > 0
                ? responseItems.map(it => `${it.name} x${it.quantity_requested}`).join(', ')
                : `${validatedMedicines.length} items`;

            const smsMessage = `Emergency request #${request_id} created by ${pharmacyName}. Items: ${itemsSummary}.` + (remarks ? ` Remarks: ${remarks}` : '');

            for (const cmo of cmos) {
                await sendSms(cmo.contact_number, smsMessage);
            }
        } catch (smsErr) {
            console.error('SMS notification error:', smsErr);
        }

        // 🔗 BLOCKCHAIN: Record request creation
        // Normalize medicine data types for consistent hashing
        const normalizedMedicines = validatedMedicines.map(m => ({
            medicine_id: m.medicine_id ? Number(m.medicine_id) : null,
            generic_id: m.generic_id ? Number(m.generic_id) : null,
            quantity_requested: Number(m.quantity_requested)
        }));

        // Record on blockchain (non-blocking)
        recordRequestOnBlockchain({
            requestId: request_id,
            pharmacyId: pharmacy_id,
            status: 'pending_approval_from_cmo',
            medicines: normalizedMedicines,
            remarks: remarks || '',
            actorId: pharmacy_id, // Pharmacy is the creator
            acceptingPharmacyId: null,
            acceptingWarehouseId: null,
            acceptingEntityType: null
        }).then(async (result) => {
            // If blockchain recording succeeds, update DB with metadata
            if (result.success) {
                try {
                    const blockchainConnection = await mysql.createConnection(dbConfig);
                    await blockchainConnection.execute(`
                        UPDATE pharmacy_emergency_requests 
                        SET blockchain_timestamp = ?, blockchain_txhash = ?
                        WHERE request_id = ?
                    `, [result.timestamp, result.txHash, request_id]);
                    console.log(`💾 Stored blockchain metadata for request #${request_id}`);
                    await blockchainConnection.end();
                } catch (dbErr) {
                    console.error('⚠️ Failed to store blockchain metadata:', dbErr.message);
                    // Non-blocking - don't fail the request
                }
            } else {
                console.error('⚠️ Blockchain recording result:', result);
            }
        }).catch(err => {
            console.error('Blockchain recording error (non-blocking):', err);
        });

        await connection.end();

        invalidate('emergency_requests:all');
        invalidatePattern('analytics:cmo:*');
        publish('pharma:events', { type: 'emergency:created', request_id, pharmacy_id, pharmacy_name: pharmacyName });

        logActivity({
          actor_type: 'pharmacy', actor_id: pharmacy_id, actor_name: pharmacyName,
          action: 'EMERGENCY_REQUEST_CREATED', entity_type: 'emergency_request', entity_id: request_id,
          description: `${pharmacyName} created emergency request #${request_id} for ${validatedMedicines.length} medicine(s)`,
          metadata: { items: responseItems.map(i => ({ name: i.name, qty: i.quantity_requested })) }
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            message: 'Emergency request created successfully',
            request_id,
            pharmacy_name: pharmacyName,
            items: responseItems
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
            await connection.end();
        }

        console.error('Database error:', error);

        return res.status(500).json({
            success: false,
            message: 'Error creating emergency request',
            error: error.message
        });
    }
}
