const cron = require('node-cron');
const mysql = require('mysql2/promise');
const dbConfig = require('../../../middleware/dbConfig.js');
const { notifyAllCMOs } = require('../../../lib/fcmService');

// Track last SMS send time for pending requests (send every 15 mins)
let lastPendingRequestSmsTime = 0;
const SMS_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function startEmergencyRequestScheduler() {
  // Run every 5 minutes to check for requests that need AI analysis
  cron.schedule('*/5 * * * *', async () => {
    console.log('🤖 [AI Agent] Waking up... checking for pending requests');
    
    try {
      const connection = await mysql.createConnection(dbConfig);
      
      // Check if CMO ID 1 has auto_approval enabled
      const [cmoData] = await connection.execute(`SELECT auto_approval_enabled FROM cmo WHERE cmo_id = 1`);
      
      if (!cmoData.length || !cmoData[0].auto_approval_enabled) {
        console.log('⭕ CMO auto-approval is disabled. Sending pending requests notification to CMO...');
        
        // Send SMS to CMOs with pending requests summary (every 15 minutes)
        const now = Date.now();
        if (now - lastPendingRequestSmsTime >= SMS_INTERVAL_MS) {
          await notifyPendingRequestsToCMO(connection);
          lastPendingRequestSmsTime = now;
        }
        
        await connection.end();
        return;
      }
      
      // Find requests created 10+ minutes ago that are still PENDING
      const [pendingRequests] = await connection.execute(`
        SELECT 
          per.request_id,
          per.pharmacy_id,
          per.request_date,
          GROUP_CONCAT(
            JSON_OBJECT(
              'medicine_id', peri.medicine_id,
              'generic_id', peri.generic_id,
              'quantity_requested', peri.quantity_requested
            )
          ) as medicines_json
        FROM pharmacy_emergency_requests per
        LEFT JOIN pharmacy_emergency_request_items peri ON per.request_id = peri.request_id
        WHERE per.status = 'pending_approval_from_cmo'
        AND TIMESTAMPDIFF(MINUTE, per.request_date, NOW()) >= 10
        GROUP BY per.request_id
        LIMIT 10
      `);

      console.log(`📋 Found ${pendingRequests.length} requests ready for AI analysis`);

      for (const request of pendingRequests) {
        try {
          await analyzeAndApproveRequest(request, connection);
        } catch (error) {
          console.error(`❌ Error processing request ${request.request_id}:`, error);
        }
      }

      // Also handle DEMAND REQUEST auto-approval
      const [pendingDemandRequests] = await connection.execute(`
        SELECT 
          pdr.request_id,
          pdr.pharmacy_id,
          pdr.request_date,
          pdr.remarks
        FROM pharmacy_demand_request pdr
        WHERE pdr.status = 'pending'
        AND TIMESTAMPDIFF(MINUTE, pdr.request_date, NOW()) >= 10
        LIMIT 10
      `);

      console.log(`📋 Found ${pendingDemandRequests.length} demand requests ready for auto-approval`);

      for (const demandRequest of pendingDemandRequests) {
        try {
          await analyzeDemandRequest(demandRequest, connection);
        } catch (error) {
          console.error(`❌ Error processing demand request ${demandRequest.request_id}:`, error);
        }
      }

      await connection.end();
    } catch (error) {
      console.error('🔴 Scheduler error:', error);
    }
  });

  console.log('✅ Emergency Request AI Scheduler started (runs every 5 minutes)');
}

async function analyzeAndApproveRequest(request, connection) {
  console.log(`\n🔍 Analyzing request #${request.request_id}...`);

  try {
    // 🔎 VALIDATE REMARKS FIELD - MUST HAVE MEANINGFUL DESCRIPTION
    const remarksValidation = validateRemarksWithAI(request.remarks);
    if (!remarksValidation.isValid) {
      console.log(`🚫 REJECTED: Request #${request.request_id} - ${remarksValidation.reason}`);
      await connection.execute(`
        UPDATE pharmacy_emergency_requests 
        SET status = 'rejected', decision_reason = ?
        WHERE request_id = ?
      `, [remarksValidation.reason, request.request_id]);
      return;
    }

    console.log(`✅ Remarks validation passed: "${request.remarks.substring(0, 60)}..."`);

    // Parse medicines
    const medicines = request.medicines_json 
      ? JSON.parse(`[${request.medicines_json}]`)
      : [];

    if (medicines.length === 0) {
      console.log(`⚠️ No medicines found for request ${request.request_id}`);
      return;
    }

    // Get all eligible pharmacies and warehouses (using same logic as eligiblePharmacies.js)
    const eligiblePharmacies = await getEligiblePharmacies(request.request_id, request.pharmacy_id, medicines, connection);
    const eligibleWarehouses = await getEligibleWarehouses(request.request_id, medicines, connection);

    if (eligiblePharmacies.length === 0 && eligibleWarehouses.length === 0) {
      console.log(`⚠️ No eligible pharmacies or warehouses found for request ${request.request_id}`);
      return;
    }

    // Get distance data for each pharmacy and warehouse
    const pharmaciesWithDistance = await getDistanceData(request.request_id, eligiblePharmacies, connection, false);
    const warehousesWithDistance = await getDistanceData(request.request_id, eligibleWarehouses, connection, true);

    // Call AI to analyze and recommend best pharmacy or warehouse
    const recommendation = await getAIRecommendation(
      request.request_id,
      request.pharmacy_id,
      medicines,
      pharmaciesWithDistance,
      warehousesWithDistance
    );

    console.log(`🤖 AI Decision: ${recommendation.decision}`);
    console.log(`   Confidence: ${(recommendation.confidence * 100).toFixed(0)}%`);

    // Execute AI decision
    if (recommendation.decision === 'APPROVE' && (recommendation.selectedPharmacy || recommendation.selectedWarehouse)) {
      const selectedEntity = recommendation.selectedPharmacy || recommendation.selectedWarehouse;
      const isWarehouse = !!recommendation.selectedWarehouse;
      await autoApproveAndSendOrder(
        request.request_id,
        selectedEntity,
        recommendation.summary,
        connection,
        isWarehouse
      );
      console.log(`✅ Request #${request.request_id} auto-approved and sent to ${isWarehouse ? 'warehouse' : 'pharmacy'} ${selectedEntity.id}!`);
    } else if (recommendation.decision === 'FLAG_ALTERNATIVE') {
      // Mark as needing review but log AI suggestions
      await connection.execute(`
        UPDATE pharmacy_emergency_requests 
        SET ai_analysis = ?, ai_recommendation = ?
        WHERE request_id = ?
      `, [
        JSON.stringify(recommendation),
        recommendation.summary,
        request.request_id
      ]);
      console.log(`⚠️ Request #${request.request_id} flagged for CMO review (alternatives suggested)`);
    } else if (recommendation.decision === 'REJECT') {
      // Auto-reject if impossible
      await connection.execute(`
        UPDATE pharmacy_emergency_requests 
        SET status = 'rejected', decision_reason = ?
        WHERE request_id = ?
      `, [
        `Auto-rejected by AI: ${recommendation.summary}`,
        request.request_id
      ]);
      console.log(`❌ Request #${request.request_id} auto-rejected`);
    }

  } catch (error) {
    console.error(`Error in analyzeAndApproveRequest:`, error);
  }
}

async function notifyPendingRequestsToCMO(connection) {
  console.log('\n📱 Sending pending emergency requests notification to CMO...');

  try {
    // Fetch all pending emergency requests
    const [pendingRequests] = await connection.execute(`
      SELECT 
        per.request_id,
        per.pharmacy_id,
        p.pharmacy_name,
        per.request_date,
        COUNT(peri.request_id) as item_count,
        GROUP_CONCAT(DISTINCT peri.medicine_id) as medicine_ids,
        GROUP_CONCAT(DISTINCT peri.generic_id) as generic_ids
      FROM pharmacy_emergency_requests per
      JOIN pharmacy p ON per.pharmacy_id = p.pharmacy_id
      LEFT JOIN pharmacy_emergency_request_items peri ON per.request_id = peri.request_id
      WHERE per.status = 'pending_approval_from_cmo'
      GROUP BY per.request_id
      ORDER BY per.request_date ASC
    `);

    if (pendingRequests.length === 0) {
      console.log('✅ No pending emergency requests to notify about');
      return;
    }

    // Get CMO contact numbers
    const [cmos] = await connection.execute(`
      SELECT contact_number FROM cmo WHERE contact_number IS NOT NULL
    `);

    if (cmos.length === 0) {
      console.log('⚠️ No CMO contact numbers found');
      return;
    }

    // Build notification message
    const requestsSummary = pendingRequests.map((req, idx) => 
      `${idx + 1}. Request #${req.request_id} from ${req.pharmacy_name} (${req.item_count} items)`
    ).join(', ');

    const message = `⚠️ PENDING EMERGENCY REQUESTS (Auto-approval disabled): ${requestsSummary}. Total: ${pendingRequests.length}. Please approve or review.`;

    // Send SMS to all CMOs
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    for (const cmo of cmos) {
      try {
        let mobile = (cmo.contact_number || '').toString().replace(/[^0-9]/g, '');
        if (mobile.length === 10) mobile = '91' + mobile;
        if (!mobile.startsWith('+')) mobile = '+' + mobile;

        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const payload = new URLSearchParams({ To: mobile, From: fromNumber, Body: message });

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
          console.error(`SMS error to ${mobile}:`, resp.status, text);
        } else {
          console.log(`✅ Sent pending requests SMS to CMO ${mobile}`);
        }
      } catch (smsErr) {
        console.error(`Error sending SMS to CMO:`, smsErr);
      }
    }

    // Push notification to all CMO devices
    await notifyAllCMOs(
      connection,
      '⏳ Pending Emergency Requests',
      `${pendingRequests.length} emergency request(s) are pending your approval.`,
      { count: String(pendingRequests.length), type: 'pending_emergency_reminder' }
    ).catch(e => console.error('FCM scheduler notify CMO error:', e));

  } catch (error) {
    console.error('Error in notifyPendingRequestsToCMO:', error);
  }
}

async function analyzeDemandRequest(demandRequest, connection) {
  console.log(`\n🔍 Analyzing demand request #${demandRequest.request_id}...`);

  try {
    // 🔎 VALIDATE REMARKS FIELD - MUST HAVE MEANINGFUL DESCRIPTION
    const remarksValidation = validateRemarksWithAI(demandRequest.remarks);
    if (!remarksValidation.isValid) {
      console.log(`🚫 REJECTED: Demand Request #${demandRequest.request_id} - ${remarksValidation.reason}`);
      await connection.execute(`
        UPDATE pharmacy_demand_request 
        SET status = 'rejected', decision_reason = ?
        WHERE request_id = ?
      `, [remarksValidation.reason, demandRequest.request_id]);
      return;
    }

    console.log(`✅ Remarks validation passed: "${demandRequest.remarks.substring(0, 60)}..."`);

    const pharmacyId = demandRequest.pharmacy_id;

    // Check if the pharmacy's last demand request was more than 20 days ago
    // Only check approved/successful/received requests (not pending or rejected)
    const [lastRequest] = await connection.execute(`
      SELECT request_date FROM pharmacy_demand_request 
      WHERE pharmacy_id = ? AND request_id != ? AND status IN ('approved', 'order_successful', 'order_recieved')
      ORDER BY request_date DESC 
      LIMIT 1
    `, [pharmacyId, demandRequest.request_id]);

    let shouldApprove = false;
    let reason = '';

    if (lastRequest.length === 0) {
      // No previous approved request, so approve
      shouldApprove = true;
      reason = 'No previous demand request found. First request approved.';
    } else {
      const lastRequestDate = new Date(lastRequest[0].request_date);
      const today = new Date();
      const daysDifference = Math.floor((today - lastRequestDate) / (1000 * 60 * 60 * 24));

      if (daysDifference >= 20) {
        shouldApprove = true;
        reason = `Last request was ${daysDifference} days ago. Approved.`;
      } else {
        shouldApprove = false;
        reason = `Last request was only ${daysDifference} days ago. Must wait ${20 - daysDifference} more days.`;
      }
    }

    if (shouldApprove) {
      // Approve and set warehouse_id to 1
      await connection.execute(`
        UPDATE pharmacy_demand_request 
        SET 
          status = 'approved',
          accepting_warehouse_id = 1,
          decision_reason = ?
        WHERE request_id = ?
      `, [reason, demandRequest.request_id]);
      console.log(`✅ Demand Request #${demandRequest.request_id} auto-approved. ${reason}`);
    } else {
      // Reject
      await connection.execute(`
        UPDATE pharmacy_demand_request 
        SET 
          status = 'rejected',
          decision_reason = ?
        WHERE request_id = ?
      `, [reason, demandRequest.request_id]);
      console.log(`❌ Demand Request #${demandRequest.request_id} auto-rejected. ${reason}`);
    }

  } catch (error) {
    console.error(`Error in analyzeDemandRequest:`, error);
  }
}

async function getEligiblePharmacies(requestId, requestingPharmacyId, medicines, connection) {
  try {
    const medicineIds = medicines.filter(m => m.medicine_id !== null).map(m => m.medicine_id);
    const genericIds = medicines.filter(m => m.generic_id !== null).map(m => m.generic_id);

    // Get pharmacies with sufficient medicine stock
    let pharmaciesSql = `
      WITH pharmacy_stock_summary AS (
        SELECT 
          s.pharmacy_id,
          s.medicine_id,
          SUM(s.quantity) as total_quantity
        FROM stock s
        WHERE s.expiry_date > CURDATE()
        GROUP BY s.pharmacy_id, s.medicine_id
      ),
      pharmacy_generic_stock_summary AS (
        SELECT 
          s.pharmacy_id,
          m.generic_id,
          SUM(s.quantity) as total_quantity
        FROM stock s
        JOIN medicines m ON s.medicine_id = m.medicine_id
        WHERE s.expiry_date > CURDATE()
        AND m.generic_id IS NOT NULL
        GROUP BY s.pharmacy_id, m.generic_id
      )
      SELECT DISTINCT p.pharmacy_id, p.username as name, p.address, p.district, p.block, p.contact_number
      FROM pharmacy p
      WHERE p.pharmacy_id != ?
      AND NOT EXISTS (
        SELECT 1
        FROM pharmacy_emergency_request_items peri
        WHERE peri.request_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM (
            SELECT pss.pharmacy_id, pss.total_quantity
            FROM pharmacy_stock_summary pss
            WHERE pss.pharmacy_id = p.pharmacy_id
            AND pss.medicine_id = peri.medicine_id
            AND peri.medicine_id IS NOT NULL
            
            UNION ALL
            
            SELECT pgss.pharmacy_id, pgss.total_quantity
            FROM pharmacy_generic_stock_summary pgss
            WHERE pgss.pharmacy_id = p.pharmacy_id
            AND pgss.generic_id = peri.generic_id
            AND peri.generic_id IS NOT NULL
          ) AS combined_stock
          WHERE combined_stock.total_quantity >= peri.quantity_requested
        )
      )
      LIMIT 20
    `;

    const [pharmacies] = await connection.execute(pharmaciesSql, [requestingPharmacyId, requestId]);

    return pharmacies;
  } catch (error) {
    console.error('Error getting eligible pharmacies:', error);
    return [];
  }
}

async function getEligibleWarehouses(requestId, medicines, connection) {
  try {
    // Get warehouses with sufficient medicine stock
    let warehousesSql = `
      WITH warehouse_stock_summary AS (
        SELECT 
          s.warehouse_id,
          s.medicine_id,
          SUM(s.quantity) as total_quantity
        FROM stock s
        WHERE s.pharmacy_id IS NULL
        AND s.warehouse_id IS NOT NULL
        AND s.expiry_date > CURDATE()
        GROUP BY s.warehouse_id, s.medicine_id
      ),
      warehouse_generic_stock_summary AS (
        SELECT 
          s.warehouse_id,
          m.generic_id,
          SUM(s.quantity) as total_quantity
        FROM stock s
        JOIN medicines m ON s.medicine_id = m.medicine_id
        WHERE s.pharmacy_id IS NULL
        AND s.warehouse_id IS NOT NULL
        AND s.expiry_date > CURDATE()
        AND m.generic_id IS NOT NULL
        GROUP BY s.warehouse_id, m.generic_id
      )
      SELECT DISTINCT w.warehouse_id, w.name, w.address, w.district, w.block, w.contact_number
      FROM warehouse w
      WHERE NOT EXISTS (
        SELECT 1
        FROM pharmacy_emergency_request_items peri
        WHERE peri.request_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM (
            SELECT wss.warehouse_id, wss.total_quantity
            FROM warehouse_stock_summary wss
            WHERE wss.warehouse_id = w.warehouse_id
            AND wss.medicine_id = peri.medicine_id
            AND peri.medicine_id IS NOT NULL
            
            UNION ALL
            
            SELECT wgss.warehouse_id, wgss.total_quantity
            FROM warehouse_generic_stock_summary wgss
            WHERE wgss.warehouse_id = w.warehouse_id
            AND wgss.generic_id = peri.generic_id
            AND peri.generic_id IS NOT NULL
          ) AS combined_stock
          WHERE combined_stock.total_quantity >= peri.quantity_requested
        )
      )
      LIMIT 20
    `;

    const [warehouses] = await connection.execute(warehousesSql, [requestId]);

    return warehouses;
  } catch (error) {
    console.error('Error getting eligible warehouses:', error);
    return [];
  }
}

async function getDistanceData(requestId, entities, connection, isWarehouse = false) {
  try {
    // Get origin pharmacy location
    const [originData] = await connection.execute(`
      SELECT per.pharmacy_id, p.username as name, p.address, p.district, p.block
      FROM pharmacy_emergency_requests per
      JOIN pharmacy p ON per.pharmacy_id = p.pharmacy_id
      WHERE per.request_id = ?
    `, [requestId]);

    if (originData.length === 0) return entities;

    const origin = originData[0];

    // Rank by simple heuristics (distance assumption based on district)
    const entitiesWithMetrics = entities.map(entity => {
      let distance_score = 0;
      
      // Same district = better distance
      if (entity.district === origin.district) {
        distance_score = 5;
      } else {
        distance_score = 1; // Different district = likely far
      }

      return {
        ...entity,
        distance_score,  // Higher is better (closer)
        rank_score: distance_score,
        entity_type: isWarehouse ? 'warehouse' : 'pharmacy'
      };
    });

    // Sort by rank_score (distance first priority)
    return entitiesWithMetrics.sort((a, b) => b.rank_score - a.rank_score);
  } catch (error) {
    console.error('Error getting distance data:', error);
    return entities;
  }
}

async function getAIRecommendation(requestId, pharmacyId, medicines, pharmacies, warehouses) {
  const medicinesStr = medicines.map(m => {
    if (m.medicine_id) return `Medicine ID: ${m.medicine_id} x${m.quantity_requested}`;
    if (m.generic_id) return `Generic ID: ${m.generic_id} x${m.quantity_requested}`;
  }).join('\n');

  const pharmaciesStr = pharmacies.slice(0, 10).map((p, i) => 
    `${i + 1}. PHARMACY - ${p.name} (ID: ${p.pharmacy_id}) - ${p.district}, ${p.block} - Distance Score: ${p.distance_score}`
  ).join('\n');

  const warehousesStr = warehouses.slice(0, 10).map((w, i) => 
    `${i + 1}. WAREHOUSE - ${w.name} (ID: ${w.warehouse_id}) - ${w.district}, ${w.block} - Distance Score: ${w.distance_score}`
  ).join('\n');

  const allEntitiesStr = (pharmaciesStr + (warehousesStr ? '\n' + warehousesStr : '')).trim();

  const prompt = `You are a pharmaceutical supply chain AI agent. Analyze this emergency medicine request and recommend the BEST pharmacy or warehouse.

REQUESTED MEDICINES:
${medicinesStr}

ELIGIBLE PHARMACIES & WAREHOUSES (ranked by proximity):
${allEntitiesStr || 'No eligible pharmacies or warehouses found'}

IMPORTANT CRITERIA (in order of priority):
1. Can fulfill ALL requested medicines (exact or generic alternatives)
2. Closest distance (first preference)
3. Warehouse should only be selected if significantly better distance than all pharmacies
4. Stock freshness

Return ONLY valid JSON (no markdown, no code blocks):
{
  "decision": "APPROVE",
  "selectedPharmacy": null,
  "selectedWarehouse": {
    "id": <warehouse_id>,
    "name": "<warehouse_name>",
    "type": "warehouse"
  },
  "alternatives": [],
  "summary": "<brief reason for selection>",
  "confidence": 0.85
}

OR if recommending pharmacy:
{
  "decision": "APPROVE",
  "selectedPharmacy": {
    "id": <pharmacy_id>,
    "name": "<pharmacy_name>",
    "type": "pharmacy"
  },
  "selectedWarehouse": null,
  "alternatives": [],
  "summary": "<brief reason for selection>",
  "confidence": 0.85
}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 300
      })
    });

    const data = await response.json();
    
    // Check if API response is valid
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('Invalid API response:', data);
      return { 
        decision: 'REJECT', 
        summary: 'AI API returned invalid response', 
        confidence: 0 
      };
    }
    
    const responseText = data.choices[0].message.content.trim();
    
    // Parse JSON from response (remove markdown if present)
    let jsonStr = responseText;
    if (responseText.includes('```json')) {
      jsonStr = responseText.split('```json')[1].split('```')[0];
    } else if (responseText.includes('```')) {
      jsonStr = responseText.split('```')[1].split('```')[0];
    }
    
    const parsed = JSON.parse(jsonStr.trim());
    return parsed;
  } catch (error) {
    console.error('AI API error:', error);
    return { 
      decision: 'REJECT', 
      summary: 'AI analysis failed: ' + error.message, 
      confidence: 0 
    };
  }
}

async function autoApproveAndSendOrder(requestId, entity, summary, connection, isWarehouse = false) {
  try {
    const updateQuery = isWarehouse 
      ? `UPDATE pharmacy_emergency_requests 
         SET 
          status = 'order_sent',
          accepting_warehouse_id = ?,
          decision_reason = ?
         WHERE request_id = ?`
      : `UPDATE pharmacy_emergency_requests 
         SET 
          status = 'order_sent',
          accepting_pharmacy_id = ?,
          decision_reason = ?
         WHERE request_id = ?`;

    await connection.execute(updateQuery, [entity.id, `Auto-approved by AI: ${summary}`, requestId]);

    console.log(`   Order sent to ${isWarehouse ? 'warehouse' : 'pharmacy'} ${entity.id}`);
  } catch (error) {
    console.error('Error sending order:', error);
  }
}

/**
 * Validate remarks field for emergency and demand requests (LENIENT MODE)
 * Only rejects clearly invalid remarks (empty, null, spam patterns)
 * 
 * @param {string} remarks - The remarks field to validate
 * @returns {Object} - { isValid: boolean, reason: string }
 */
function validateRemarks(remarks) {
  // 1. CHECK IF EMPTY - STRICT (cannot be null/undefined/blank)
  if (!remarks || typeof remarks !== 'string' || remarks.trim().length === 0) {
    return {
      isValid: false,
      reason: 'Remarks field is empty. Please provide a description.'
    };
  }

  const trimmedRemarks = remarks.trim();

  // 2. CHECK FOR REPEATED PATTERNS/SPAM - STRICT (reject spam like "aaaaaa", "123123")
  if (isRepeatedPattern(trimmedRemarks)) {
    return {
      isValid: false,
      reason: 'Remarks appear to be spam (repeated characters). Please provide a real reason.'
    };
  }

  // 3. LENIENT: Accept anything else that's not empty or spam
  // Minimum length: 5 characters (very lenient)
  if (trimmedRemarks.length < 5) {
    return {
      isValid: false,
      reason: 'Remarks too short (minimum 5 characters needed).'
    };
  }

  // If it passes all checks, it's valid
  return {
    isValid: true,
    reason: 'Remarks validation passed'
  };
}

/**
 * Check if remarks is just repeated characters/patterns (SPAM DETECTION)
 * @param {string} remarks
 * @returns {boolean}
 */
function isRepeatedPattern(remarks) {
  // Check for repeated single character (aaa, bbb, etc.) - 6+ times
  const singleCharPattern = /(.)\1{5,}/;
  if (singleCharPattern.test(remarks)) {
    return true;
  }

  // Check for repeated patterns (123123123, abab, etc.)
  const patternMatch = remarks.match(/(.{2,}?)\1{2,}/);
  if (patternMatch) {
    return true;
  }

  return false;
}


async function validateRemarksWithAI(remarks) {
  if (!remarks || remarks.trim().length < 5) {
    return { isValid: false, reason: 'Remarks too short or empty.' };
  }

  const prompt = `As a Medical Review Agent, analyze the following medical supply request reason.
  
  REASON PROVIDED: "${remarks}"
  
  CRITERIA:
  - It must be a professional medical or logistical justification (e.g., "Critical stock shortage", "Emergency patient requirement", "High demand for generic alternatives").
  - Reject if it is spam (e.g., "asdf", "12345", "test").
  - Reject if it is nonsensical or lacks any medical context.
  
  Return ONLY JSON:
  {
    "isValid": boolean,
    "reason": "Brief explanation of why it was rejected, or 'Accepted' if valid"
  }`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 150
      })
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content.trim());
    return result;
  } catch (error) {
    console.error('AI Validation Error:', error);
    // Fallback to basic length check if API is down to avoid blocking system
    return { isValid: remarks.length > 10, reason: 'API Fallback validation' };
  }
}

module.exports = { startEmergencyRequestScheduler };
