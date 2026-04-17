const blockchainService = require('../../blockchain/utils/blockchainService');
const { generateRequestSnapshot, generatePrescriptionSnapshot } = require('../../blockchain/utils/hashUtils');

/**
 * Record emergency request state transition on blockchain
 * This is called after MySQL updates succeed
 * NOTE: This function ONLY handles blockchain recording, not DB updates
 * Caller is responsible for updating database with returned metadata
 * 
 * @param {Object} params
 * @param {number} params.requestId - Emergency request ID
 * @param {number} params.pharmacyId - Pharmacy ID
 * @param {string} params.status - New status
 * @param {Array} params.medicines - Medicine items
 * @param {string} params.remarks - Optional remarks
 * @param {number} params.actorId - Actor performing this transition
 * @param {string} params.requestType - "EMERGENCY" or "DEMAND"
 * @returns {Promise<Object>} - Transaction receipt with blockchain metadata
 */
async function recordRequestOnBlockchain(params) {
  try {
    const {
      requestId,
      pharmacyId,
      status,
      medicines,
      remarks = '',
      actorId,
      requestType = 'EMERGENCY',
      acceptingPharmacyId = null,
      acceptingWarehouseId = null,
      acceptingEntityType = null
    } = params;

    // Check if blockchain is available
    const isAvailable = await blockchainService.isAvailable();
    if (!isAvailable) {
      console.warn('⚠️ Blockchain unavailable, skipping recording');
      return { success: false, error: 'Blockchain unavailable' };
    }

    // Generate snapshot hash
    const timestamp = Math.floor(Date.now() / 1000);
    
    console.log('🔗 Recording on blockchain with params:', {
      requestId,
      pharmacyId,
      status,
      medicineCount: medicines.length,
      acceptingPharmacyId,
      acceptingWarehouseId,
      acceptingEntityType
    });
    
    const snapshotHash = generateRequestSnapshot({
      requestId,
      pharmacyId,
      status,
      medicines,
      remarks,
      actorId,
      timestamp,
      acceptingPharmacyId,
      acceptingWarehouseId,
      acceptingEntityType
    });

    console.log(`📸 Snapshot generated for request #${requestId}:`, snapshotHash);

    // Get contract instance
    const contract = await blockchainService.getRequestContract();

    // Record on blockchain
    console.log(`📤 Recording request #${requestId} state: ${status}...`);
    
    const tx = await contract.recordStateTransition(
      requestId,
      requestType,
      status,
      snapshotHash,
      remarks
    );

    console.log(`⏳ Transaction sent: ${tx.hash}`);
    
    const receipt = await tx.wait();
    
    console.log(`✅ Request #${requestId} recorded on blockchain! Block: ${receipt.blockNumber}`);

    // Return blockchain metadata for caller to store in database
    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      snapshotHash,
      timestamp
    };

  } catch (error) {
    console.error('❌ Blockchain recording failed:', error.message);
    // Don't throw - blockchain failure shouldn't break the app
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get request history from blockchain
 */
async function getRequestHistoryFromBlockchain(requestId) {
  try {
    const contract = await blockchainService.getRequestContract();
    const history = await contract.getRequestHistory(requestId);
    
    return {
      success: true,
      requestId: Number(requestId),
      totalRecords: history.length,
      history: history.map(h => ({
        requestId: Number(h.requestId),
        requestType: h.requestType,
        state: h.state,
        snapshotHash: h.snapshotHash,
        actor: h.actor,
        timestamp: Number(h.timestamp),
        dateTime: new Date(Number(h.timestamp) * 1000).toLocaleString(),
        remarks: h.remarks
      }))
    };
  } catch (error) {
    console.error('Error fetching blockchain history:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Verify request integrity against blockchain
 * Checks that:
 * 1. Current DB state matches what was recorded on blockchain
 * 2. State transition is valid (no backward transitions)
 * 
 * @param {number} requestId - Request ID to verify
 * @param {Object} currentData - Current data from database
 * @param {Object} connection - MySQL connection for reading DB metadata
 * @returns {Promise<Object>} Verification result
 */
async function verifyRequestIntegrity(requestId, currentData, connection = null) {
  try {
    // Valid state transitions for emergency requests
    const validTransitions = {
      'pending_approval_from_cmo': ['order_sent', 'rejected'],
      'order_sent': ['order_successful', 'rejected'],
      'order_successful': ['order_recieved', 'rejected'],
      'order_recieved': ['rejected'],
      'rejected': []
    };

    // Check if blockchain is available
    const isAvailable = await blockchainService.isAvailable();
    if (!isAvailable) {
      console.warn('⚠️ Blockchain unavailable, skipping verification');
      return {
        success: true,
        isValid: true,
        message: 'Blockchain unavailable - verification skipped',
        skipped: true
      };
    }

    const contract = await blockchainService.getRequestContract();
    
    // Safely get history count - handle case where request not on chain
    let historyCount = 0;
    try {
      const count = await contract.getHistoryCount(requestId);
      historyCount = Number(count);
    } catch (err) {
      console.log(`⚠️ Could not fetch history count (request may not be on chain yet): ${err.message}`);
      historyCount = 0;
    }
    
    // If this is the first record, nothing to verify yet
    if (historyCount === 0) {
      console.log(`⚠️ Request #${requestId} has no blockchain records yet - this is the first recording`);
      return {
        success: true,
        isValid: true,
        message: 'Request not yet recorded on blockchain',
        notFound: true
      };
    }

    // Get the latest state from blockchain - now we know it exists
    let latestState;
    try {
      latestState = await contract.getLatestState(requestId);
    } catch (err) {
      console.error(`❌ Error fetching latest state: ${err.message}`);
      return {
        success: false,
        error: `Could not fetch latest blockchain state: ${err.message}`,
        isValid: true  // Allow transaction on error
      };
    }

    const lastBlockchainStatus = latestState.state;
    console.log(`📋 Blockchain history count: ${historyCount}, Last status: ${lastBlockchainStatus}`);

    // Verify state transition is valid
    const newStatus = currentData.status;
    const allowedTransitions = validTransitions[lastBlockchainStatus] || [];
    
    if (!allowedTransitions.includes(newStatus)) {
      console.error(`🚨 INVALID STATE TRANSITION: ${lastBlockchainStatus} → ${newStatus}`);
      console.error(`   Valid transitions from ${lastBlockchainStatus}: ${allowedTransitions.join(', ')}`);
      return {
        success: true,
        isValid: false,
        lastRecordedState: lastBlockchainStatus,
        attemptedState: newStatus,
        message: `❌ SECURITY ALERT: Invalid state transition! Cannot go from "${lastBlockchainStatus}" to "${newStatus}". Valid transitions: ${allowedTransitions.join(', ')}`
      };
    }

    // Get blockchain timestamp - use block.timestamp from contract
    let blockchainTimestamp = Number(latestState.timestamp);
    console.log(`⏰ Blockchain timestamp from contract: ${blockchainTimestamp}`);

    // Try to get the stored blockchain_timestamp from DB (more reliable if available)
    if (connection) {
      try {
        const [dbRecord] = await connection.execute(`
          SELECT blockchain_timestamp FROM pharmacy_emergency_requests WHERE request_id = ?
        `, [requestId]);
        
        if (dbRecord.length > 0 && dbRecord[0].blockchain_timestamp) {
          blockchainTimestamp = dbRecord[0].blockchain_timestamp;
          console.log(`💾 Using stored blockchain_timestamp from DB: ${blockchainTimestamp}`);
        }
      } catch (dbErr) {
        console.warn('⚠️ Could not fetch blockchain_timestamp from DB, using contract timestamp:', dbErr.message);
      }
    }
    
    console.log('🔍 Verifying snapshot with:', {
      requestId: Number(requestId),
      pharmacyId: currentData.pharmacyId,
      status: lastBlockchainStatus,
      medicineCount: currentData.medicines?.length,
      timestamp: blockchainTimestamp
    });
    
    // Generate snapshot using the EXACT same data and timestamp as original recording
    const verificationSnapshot = generateRequestSnapshot({
      ...currentData,
      requestId: Number(requestId),
      status: lastBlockchainStatus,
      timestamp: blockchainTimestamp
    });
    
    // Compare hashes
    const blockchainHashStr = latestState.snapshotHash.toString();
    const matches = verificationSnapshot === blockchainHashStr;
    
    if (!matches) {
      console.error(`🚨 TAMPERING DETECTED for request #${requestId}!`);
      console.error(`   Expected (blockchain): ${blockchainHashStr}`);
      console.error(`   Got (database): ${verificationSnapshot}`);
      console.error(`   Last recorded state: ${latestState.state}`);
      console.error(`   Last recorded timestamp: ${blockchainTimestamp}`);
      return {
        success: true,
        isValid: false,
        blockchainHash: blockchainHashStr,
        currentHash: verificationSnapshot,
        lastRecordedState: latestState.state,
        lastRecordedTime: new Date(blockchainTimestamp * 1000).toLocaleString(),
        message: '🚨 SECURITY ALERT: Data tampering detected! Database does not match blockchain records. This request has been flagged for review.'
      };
    }

    console.log(`✅ Request #${requestId} integrity verified - valid transition from "${lastBlockchainStatus}" to "${newStatus}"`);
    
    return {
      success: true,
      isValid: true,
      lastRecordedState: latestState.state,
      newState: newStatus,
      lastRecordedTime: new Date(blockchainTimestamp * 1000).toLocaleString(),
      message: `✅ Data integrity verified - valid state transition: ${lastBlockchainStatus} → ${newStatus}`
    };

  } catch (error) {
    console.error('❌ Verification error (non-blocking):', error.message);
    // If verification fails for any reason, log but allow transaction to proceed
    return {
      success: false,
      error: error.message,
      isValid: true,
      message: 'Verification error - transaction allowed to proceed'
    };
  }
}

/**
 * Record prescription version on blockchain (create/edit)
 * This is called after MySQL create/update succeeds
 * 
 * @param {Object} params
 * @param {number} params.prescriptionId - Prescription ID
 * @param {string} params.opdNumber - OPD number
 * @param {number} params.doctorId - Doctor ID
 * @param {number|null} params.pharmacyId - Pharmacy ID (null if not served)
 * @param {string} params.diagnosis - Diagnosis
 * @param {Array} params.medicines - Medicine items
 * @param {string} params.remarks - Remarks (e.g., "Created", "Edited")
 * @returns {Promise<Object>} - Transaction receipt
 */
async function recordPrescriptionVersion(params) {
  try {
    const {
      prescriptionId,
      opdNumber,
      doctorId,
      pharmacyId,
      diagnosis,
      medicines,
      remarks = 'Version saved'
    } = params;

    // Check if blockchain is available
    const isAvailable = await blockchainService.isAvailable();
    if (!isAvailable) {
      console.warn('⚠️ Blockchain unavailable, skipping prescription recording');
      return { success: false, error: 'Blockchain unavailable' };
    }

    // Generate snapshot hash
    const timestamp = Math.floor(Date.now() / 1000);
    const snapshotHash = generatePrescriptionSnapshot({
      prescriptionId,
      opdNumber,
      doctorId,
      pharmacyId,
      diagnosis,
      medicines,
      action: 'VERSION',
      timestamp
    });

    console.log(`📸 Prescription v${timestamp} snapshot for #${prescriptionId}:`, snapshotHash);

    // Get prescription contract instance
    const contract = await blockchainService.getPrescriptionContract();

    console.log(`📤 Recording prescription #${prescriptionId} version...`);
    
    const tx = await contract.recordPrescriptionVersion(
      prescriptionId,
      snapshotHash,
      remarks,
      { gasLimit: 500000 } // Increased gas limit
    );

    console.log(`⏳ Transaction sent: ${tx.hash}`);
    
    const receipt = await tx.wait();
    
    console.log(`✅ Prescription #${prescriptionId} version recorded! Block: ${receipt.blockNumber}`);

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      snapshotHash
    };

  } catch (error) {
    console.error('❌ Blockchain version recording failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Record prescription finalization on blockchain (serving/NAC)
 * This is called after MySQL updates succeed
 * NOTE: Caller is responsible for updating database with returned metadata
 * 
 * @param {Object} params
 * @param {number} params.prescriptionId - Prescription ID
 * @param {string} params.opdNumber - OPD number
 * @param {number} params.doctorId - Doctor ID
 * @param {number|null} params.pharmacyId - Pharmacy ID (null for NAC)
 * @param {string} params.diagnosis - Diagnosis
 * @param {Array} params.medicines - Medicine items
 * @param {string} params.action - Action type (PHARMACY_SERVED or NAC_ISSUED)
 * @param {string} params.remarks - Remarks
 * @returns {Promise<Object>} - Transaction receipt with blockchain metadata
 */
async function recordPrescriptionFinalization(params) {
  try {
    const {
      prescriptionId,
      opdNumber,
      doctorId,
      pharmacyId,
      diagnosis,
      medicines,
      action,
      remarks = ''
    } = params;

    // Check if blockchain is available
    const isAvailable = await blockchainService.isAvailable();
    if (!isAvailable) {
      console.warn('⚠️ Blockchain unavailable, skipping prescription finalization');
      return { success: false, error: 'Blockchain unavailable' };
    }

    // Generate snapshot hash
    const timestamp = Math.floor(Date.now() / 1000);
    const snapshotHash = generatePrescriptionSnapshot({
      prescriptionId,
      opdNumber,
      doctorId,
      pharmacyId,
      diagnosis,
      medicines,
      action,
      timestamp
    });

    console.log(`📸 Prescription finalization snapshot for #${prescriptionId}:`, snapshotHash);

    // Get prescription contract instance
    const contract = await blockchainService.getPrescriptionContract();

    console.log(`📤 Recording prescription #${prescriptionId} finalization: ${action}...`);
    
    const tx = await contract.recordPrescriptionFinalization(
      prescriptionId,
      snapshotHash,
      action,
      remarks || `Finalized as ${action}`,
      { gasLimit: 500000 } // Increased gas limit
    );

    console.log(`⏳ Transaction sent: ${tx.hash}`);
    
    const receipt = await tx.wait();
    
    console.log(`✅ Prescription #${prescriptionId} finalized! Block: ${receipt.blockNumber}`);

    // Return blockchain metadata for caller to store in database
    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      snapshotHash,
      timestamp
    };

  } catch (error) {
    console.error('❌ Blockchain finalization recording failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Record prescription state on blockchain (DEPRECATED - use recordPrescriptionVersion or recordPrescriptionFinalization)
 * This is called after MySQL updates succeed
 * 
 * @param {Object} params
 * @param {number} params.prescriptionId - Prescription ID
 * @param {string} params.opdNumber - OPD number
 * @param {number} params.doctorId - Doctor ID
 * @param {number|null} params.pharmacyId - Pharmacy ID (null if NAC)
 * @param {string} params.diagnosis - Diagnosis
 * @param {Array} params.medicines - Medicine items
 * @param {string} params.action - Action type (CREATED, PHARMACY_SERVED, NAC_ISSUED)
 * @param {number} params.actorId - Actor performing this action
 * @returns {Promise<Object>} - Transaction receipt
 */
async function recordPrescriptionOnBlockchain(params) {
  try {
    const {
      prescriptionId,
      opdNumber,
      doctorId,
      pharmacyId,
      diagnosis,
      medicines,
      action,
      actorId
    } = params;

    // Check if blockchain is available
    const isAvailable = await blockchainService.isAvailable();
    if (!isAvailable) {
      console.warn('⚠️ Blockchain unavailable, skipping prescription recording');
      return { success: false, error: 'Blockchain unavailable' };
    }

    // Generate snapshot hash
    const timestamp = Math.floor(Date.now() / 1000);
    const snapshotHash = generatePrescriptionSnapshot({
      prescriptionId,
      opdNumber,
      doctorId,
      pharmacyId,
      diagnosis,
      medicines,
      action,
      timestamp
    });

    console.log(`📸 Prescription snapshot generated for #${prescriptionId}:`, snapshotHash);

    // Get prescription contract instance
    const contract = await blockchainService.getPrescriptionContract();

    // Record on blockchain based on action type
    console.log(`📤 Recording prescription #${prescriptionId} action: ${action}...`);
    
    let tx;
    if (action === 'CREATED') {
      // Record initial creation
      tx = await contract.recordPrescriptionCreation(
        prescriptionId,
        snapshotHash,
        opdNumber
      );
    } else if (action === 'PHARMACY_SERVED') {
      // Record pharmacy serving
      tx = await contract.recordPrescriptionServed(
        prescriptionId,
        snapshotHash,
        `Served by pharmacy ${pharmacyId}`
      );
    } else if (action === 'NAC_ISSUED') {
      // Record NAC issuance
      tx = await contract.recordPrescriptionServed(
        prescriptionId,
        snapshotHash,
        'NAC issued - medicine not available'
      );
    } else {
      throw new Error(`Unknown action type: ${action}`);
    }

    console.log(`⏳ Transaction sent: ${tx.hash}`);
    
    const receipt = await tx.wait();
    
    console.log(`✅ Prescription #${prescriptionId} recorded on blockchain! Block: ${receipt.blockNumber}`);

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      snapshotHash
    };

  } catch (error) {
    console.error('❌ Blockchain prescription recording failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Verify prescription integrity against blockchain
 * Compares current database state with last recorded blockchain hash
 * Uses stored blockchain metadata from DB when available
 * 
 * @param {number} prescriptionId - Prescription ID to verify
 * @param {Object} currentData - Current data from database
 * @param {Object} connection - MySQL connection for fetching stored metadata
 * @returns {Promise<Object>} Verification result
 */
async function verifyPrescriptionIntegrity(prescriptionId, currentData, connection = null) {
  try {
    // Check if blockchain is available
    const isAvailable = await blockchainService.isAvailable();
    if (!isAvailable) {
      console.warn('⚠️ Blockchain unavailable, skipping prescription verification');
      return {
        success: true,
        isValid: true,
        message: 'Blockchain unavailable - verification skipped',
        skipped: true
      };
    }

    const contract = await blockchainService.getPrescriptionContract();
    let blockchainTimestamp = null;
    let blockchainAction = null;

    // Try to get stored blockchain metadata from database (more reliable if available)
    if (connection) {
      try {
        const [metadata] = await connection.execute(
          'SELECT blockchain_timestamp, blockchain_action FROM opd_prescriptions WHERE prescription_id = ?',
          [prescriptionId]
        );
        if (metadata.length > 0 && metadata[0].blockchain_timestamp) {
          blockchainTimestamp = Number(metadata[0].blockchain_timestamp);
          blockchainAction = metadata[0].blockchain_action;
          console.log(`📋 Using stored metadata: timestamp=${blockchainTimestamp}, action=${blockchainAction}`);
        }
      } catch (dbErr) {
        console.warn('⚠️ Could not fetch stored metadata from DB:', dbErr.message);
      }
    }

    // If no stored metadata, fetch from blockchain
    if (!blockchainTimestamp || !blockchainAction) {
      console.log('📢 Fetching metadata from blockchain...');
      const latestState = await contract.getLatestPrescriptionState(prescriptionId);
      
      // Check if prescription exists on blockchain
      if (latestState.snapshotHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        console.warn(`⚠️ Prescription #${prescriptionId} not found on blockchain`);
        return {
          success: true,
          isValid: true,
          message: 'Prescription not yet recorded on blockchain',
          notFound: true
        };
      }
      
      blockchainTimestamp = Number(latestState.timestamp);
      blockchainAction = latestState.action;
      console.log(`📋 Retrieved from blockchain: timestamp=${blockchainTimestamp}, action=${blockchainAction}`);
    }

    console.log(`🔍 Verifying prescription #${prescriptionId}:`);
    console.log(`   Stored action: ${blockchainAction}`);
    console.log(`   Stored timestamp: ${blockchainTimestamp} (${new Date(blockchainTimestamp * 1000).toLocaleString()})`);
    
    // Generate snapshot using the SAME timestamp AND action as stored
    const currentSnapshot = generatePrescriptionSnapshot({
      ...currentData,
      prescriptionId: Number(prescriptionId),
      action: blockchainAction,
      timestamp: blockchainTimestamp
    });
    
    // Compare with what's on blockchain
    const latestState = await contract.getLatestPrescriptionState(prescriptionId);
    const matches = currentSnapshot === latestState.snapshotHash;
    
    if (!matches) {
      console.error(`🚨 PRESCRIPTION TAMPERING DETECTED for #${prescriptionId}!`);
      console.error(`Expected (blockchain): ${latestState.snapshotHash}`);
      console.error(`Got (database): ${currentSnapshot}`);
      console.error('Stored timestamp:', blockchainTimestamp, '(', new Date(blockchainTimestamp * 1000).toLocaleString(), ')');
      console.error('Stored action:', blockchainAction);
      console.error('Current data:', JSON.stringify(currentData, null, 2));
    } else {
      console.log(`✅ Prescription #${prescriptionId} integrity verified - no tampering detected`);
    }
    
    return {
      success: true,
      isValid: matches,
      blockchainHash: latestState.snapshotHash,
      currentHash: currentSnapshot,
      lastRecordedTime: new Date(blockchainTimestamp * 1000).toLocaleString(),
      message: matches 
        ? 'Prescription integrity verified - no tampering detected' 
        : '🚨 SECURITY ALERT: Prescription data tampering detected! Database does not match blockchain records. This transaction has been blocked for security reasons.'
    };
  } catch (error) {
    console.error('❌ Error verifying prescription integrity:', error.message);
    return {
      success: false,
      error: error.message,
      isValid: true,
      message: 'Verification error - transaction allowed to proceed'
    };
  }
}

/**
 * Record a security incident when tampering is detected
 * Logs details to database for audit and investigation
 * 
 * @param {number} requestId - Request ID that failed verification
 * @param {Object} verificationResult - Result from verifyRequestIntegrity()
 * @param {Object} connection - MySQL connection
 * @returns {Promise<void>}
 */
async function recordTamperingIncident(requestId, verificationResult, connection) {
  try {
    if (!connection) {
      console.warn('⚠️ Cannot log tampering incident - no database connection');
      return;
    }

    const query = `
      INSERT INTO security_incidents 
      (incident_type, request_id, severity, description, blockchain_status, timestamp)
      VALUES ('TAMPERING_DETECTED', ?, 'CRITICAL', ?, ?, NOW())
    `;

    const description = `Blockchain verification failed: ${verificationResult.message || 'Data mismatch detected'}. Last recorded state: ${verificationResult.lastRecordedState || 'unknown'}`;
    
    await connection.execute(query, [requestId, description, 'VERIFICATION_FAILED']);
    
    console.log(`📋 Tampering incident logged for request #${requestId}`);
  } catch (err) {
    console.warn('⚠️ Could not log tampering incident to database:', err.message);
    // Don't throw - this is best-effort logging
  }
}

module.exports = {
  recordRequestOnBlockchain,
  getRequestHistoryFromBlockchain,
  verifyRequestIntegrity,
  recordPrescriptionVersion,
  recordPrescriptionFinalization,
  recordPrescriptionOnBlockchain, // Deprecated but kept for compatibility
  verifyPrescriptionIntegrity,
  recordTamperingIncident
};
