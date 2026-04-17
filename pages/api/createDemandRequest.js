import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';
const { logActivity } = require('../../lib/auditLogger');
const { invalidate, invalidatePattern, publish } = require('../../lib/cache');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { pharmacy_id, remarks, items, is_auto_generated } = req.body;

  if (!pharmacy_id || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Pharmacy ID and items array are required' 
    });
  }

  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    
    // Start transaction
    await connection.beginTransaction();

    // Determine default remarks based on whether it's auto-generated
    const defaultRemarks = is_auto_generated
      ? 'Automated monthly demand request based on Time Series forecast'
      : 'Time Series-based demand forecast order';

    // Insert main demand request with default status
    const [requestResult] = await connection.execute(
      'INSERT INTO pharmacy_demand_request (pharmacy_id, remarks, status) VALUES (?, ?, ?)',
      [pharmacy_id, remarks || defaultRemarks, 'pending']
    );

    const requestId = requestResult.insertId;

    // Insert demand request items
    // Support storing generic_id when provided; keep medicine_id NULL for generic-only items
    const itemValues = items.map(item => [
      requestId,
      item.medicine_id || null,
      item.generic_id || null,
      item.quantity
    ]);

    await connection.query(
      'INSERT INTO pharmacy_demand_request_items (request_id, medicine_id, generic_id, quantity_requested) VALUES ?',
      [itemValues]
    );

    // Commit transaction
    await connection.commit();

    // Enrich request with pharmacy and medicine names, send SMS to CMO(s) via Twilio (best-effort)
    let responseItems = [];
    let pharmacyName = `Pharmacy ${pharmacy_id}`;
    try {
      // Fetch pharmacy name
      const [phRows] = await connection.execute('SELECT pharmacy_name FROM pharmacy WHERE pharmacy_id = ?', [pharmacy_id]);
      if (phRows && phRows.length > 0 && phRows[0].pharmacy_name) {
        pharmacyName = phRows[0].pharmacy_name;
      }

      // Fetch medicine and generic names for items
      const medIds = items.map(i => i.medicine_id).filter(Boolean);
      const genIds = items.map(i => i.generic_id).filter(Boolean);

      const medMap = new Map();
      if (medIds.length > 0) {
        const placeholders = medIds.map(() => '?').join(',');
        const [medRows] = await connection.execute(
          `SELECT medicine_id, name FROM medicines WHERE medicine_id IN (${placeholders})`,
          medIds
        );
        medRows.forEach(m => medMap.set(String(m.medicine_id), m.name));
      }

      const genMap = new Map();
      if (genIds.length > 0) {
        const placeholdersG = genIds.map(() => '?').join(',');
        const [gRows] = await connection.execute(`SELECT generic_id, generic_name FROM generic_medicines WHERE generic_id IN (${placeholdersG})`, genIds);
        gRows.forEach(g => genMap.set(String(g.generic_id), g.generic_name));
      }

      responseItems = items.map(i => ({
        medicine_id: i.medicine_id || null,
        generic_id: i.generic_id || null,
        name: i.medicine_id ? (medMap.get(String(i.medicine_id)) || 'Unknown') : (i.generic_id ? (genMap.get(String(i.generic_id)) || 'Unknown Generic') : 'Unknown'),
        quantity: i.quantity
      }));

      const [cmos] = await connection.execute('SELECT contact_number FROM cmo WHERE contact_number IS NOT NULL');
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_FROM_NUMBER;

      const sendSms = async (to, body) => {
        if (!accountSid || !authToken || !fromNumber) {
          console.warn('Twilio not configured, skipping SMS');
          return;
        }

        let mobile = (to || '').toString().replace(/[^0-9]/g, '');
        if (mobile.length === 10) mobile = '91' + mobile;
        if (!mobile.startsWith('+')) mobile = '+' + mobile;

        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const payload = new URLSearchParams({ To: mobile, From: fromNumber, Body: body });

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
            const nodeFetch = await import('node-fetch');
            resp = await nodeFetch.default(url, {
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
        } catch (e) {
          console.error('Failed to send SMS via Twilio:', e.message || e);
        }
      };

      // Compose message with pharmacy name and items summary
      const itemsSummary = responseItems.length > 0
        ? responseItems.map(it => `${it.name} x${it.quantity}`).join(', ')
        : `${items.length} items`;
      const message = `New demand request #${requestId} created for ${pharmacyName}. Items: ${itemsSummary}. Remarks: ${remarks || ''}`;

      for (const row of cmos) {
        if (row.contact_number) await sendSms(row.contact_number, message);
      }
    } catch (smsErr) {
      console.error('Error while notifying CMO(s):', smsErr);
    }

    invalidate('demand_requests:all');
    invalidatePattern('analytics:cmo:*');
    publish('pharma:events', { type: 'demand:created', request_id: requestId, pharmacy_id });

    logActivity({
      actor_type: 'pharmacy', actor_id: pharmacy_id, actor_name: `Pharmacy #${pharmacy_id}`,
      action: is_auto_generated ? 'DEMAND_REQUEST_AUTO_CREATED' : 'DEMAND_REQUEST_CREATED',
      entity_type: 'demand_request', entity_id: requestId,
      description: is_auto_generated
        ? `Auto-generated demand request #${requestId} for Pharmacy #${pharmacy_id} (ML forecast triggered)`
        : `Pharmacy #${pharmacy_id} created demand request #${requestId} for ${items.length} medicine(s)`,
      metadata: { items_count: items.length, remarks }
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: 'Demand request created successfully',
      request_id: requestId,
      items_count: items.length,
      pharmacy_name: pharmacyName,
      items: responseItems
    });

  } catch (error) {
    // Rollback transaction on error
    if (connection) {
      await connection.rollback();
    }
    
    console.error('Error creating demand request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create demand request',
      error: error.message
    });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}