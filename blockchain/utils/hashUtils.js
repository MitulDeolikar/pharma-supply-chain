const { ethers } = require('ethers');

/**
 * Generate snapshot hash for emergency request
 * This hash represents the complete state of a request at a point in time
 * 
 * @param {Object} requestData - The request data
 * @param {number} requestData.requestId - Request ID
 * @param {number} requestData.pharmacyId - Requesting pharmacy ID
 * @param {string} requestData.status - Current status
 * @param {Array} requestData.medicines - Array of medicine items
 * @param {string} requestData.remarks - Optional remarks
 * @param {number} requestData.actorId - ID of person performing action
 * @param {number} requestData.timestamp - Unix timestamp
 * @param {number} requestData.acceptingPharmacyId - Accepting pharmacy ID (optional)
 * @param {number} requestData.acceptingWarehouseId - Accepting warehouse ID (optional)
 * @param {string} requestData.acceptingEntityType - 'pharmacy' or 'warehouse' (optional)
 * @returns {string} - Keccak256 hash
 */
function generateRequestSnapshot(requestData) {
  const {
    requestId,
    pharmacyId,
    status,
    medicines = [],
    remarks = '',
    actorId,
    timestamp,
    acceptingPharmacyId = null,
    acceptingWarehouseId = null,
    acceptingEntityType = null
  } = requestData;

  // Sort medicines by ID to ensure consistent hashing
  const sortedMedicines = [...medicines].sort((a, b) => {
    const aId = a.medicine_id || a.generic_id;
    const bId = b.medicine_id || b.generic_id;
    return aId - bId;
  });

  // Build canonical snapshot string
  const medicinesString = sortedMedicines
    .map(m => {
      const id = m.medicine_id || `G${m.generic_id}`;
      return `${id}:${m.quantity_requested}`;
    })
    .join('|');

  // Build snapshot data array
  const snapshotParts = [
    `request_id=${requestId}`,
    `pharmacy_id=${pharmacyId}`,
    `status=${status}`,
    `medicines=${medicinesString}`,
    `remarks=${remarks}`,
    `actor=${actorId}`,
    `timestamp=${timestamp}`
  ];

  // Add accepting entity information if present
  if (acceptingPharmacyId) {
    snapshotParts.push(`accepting_pharmacy_id=${acceptingPharmacyId}`);
  }
  if (acceptingWarehouseId) {
    snapshotParts.push(`accepting_warehouse_id=${acceptingWarehouseId}`);
  }
  if (acceptingEntityType) {
    snapshotParts.push(`accepting_entity_type=${acceptingEntityType}`);
  }

  const snapshotData = snapshotParts.join('::');

  // Generate Keccak256 hash
  const hash = ethers.keccak256(ethers.toUtf8Bytes(snapshotData));
  
  console.log('📸 Snapshot generated:', {
    requestId,
    status,
    medicineCount: medicines.length,
    hash: hash.substring(0, 10) + '...'
  });
  console.log('🔍 Full snapshot data:', snapshotData);

  return hash;
}

/**
 * Map database status to blockchain enum
 */
function mapStatusToBlockchain(dbStatus) {
  const statusMap = {
    'pending_approval_from_cmo': 1, // PENDING_APPROVAL
    'order_sent': 3,                // ORDER_SENT
    'order_successful': 4,          // ORDER_SUCCESSFUL
    'order_received': 5,            // ORDER_RECEIVED
    'rejected': 6                   // REJECTED
  };

  return statusMap[dbStatus] || 0; // Default to CREATED
}

/**
 * Map blockchain enum to database status
 */
function mapBlockchainToStatus(blockchainState) {
  const stateMap = {
    0: 'created',
    1: 'pending_approval_from_cmo',
    2: 'approved',
    3: 'order_sent',
    4: 'order_successful',
    5: 'order_received',
    6: 'rejected'
  };

  return stateMap[blockchainState] || 'unknown';
}

/**
 * Verify if a snapshot hash matches the current database state
 * Used for tamper detection
 */
async function verifySnapshotIntegrity(requestData, recordedHash) {
  const currentHash = generateRequestSnapshot(requestData);
  const isValid = currentHash === recordedHash;

  if (!isValid) {
    console.warn('⚠️ SNAPSHOT MISMATCH DETECTED!');
    console.warn('Expected:', recordedHash);
    console.warn('Current:', currentHash);
  }

  return isValid;
}

/**
 * Generate snapshot hash for prescription
 * This hash represents the complete state of a prescription at a point in time
 * 
 * @param {Object} prescriptionData - The prescription data
 * @param {number} prescriptionData.prescriptionId - Prescription ID
 * @param {string} prescriptionData.opdNumber - OPD registration number
 * @param {number} prescriptionData.doctorId - Doctor ID
 * @param {number|null} prescriptionData.pharmacyId - Pharmacy ID (null if not served)
 * @param {string} prescriptionData.diagnosis - Diagnosis
 * @param {Array} prescriptionData.medicines - Array of medicine items
 * @param {string} prescriptionData.action - Action type (CREATED, PHARMACY_SERVED, NAC_ISSUED)
 * @param {number} prescriptionData.timestamp - Unix timestamp
 * @returns {string} - Keccak256 hash
 */
function generatePrescriptionSnapshot(prescriptionData) {
  const {
    prescriptionId,
    opdNumber,
    doctorId,
    pharmacyId,
    diagnosis,
    medicines = [],
    action,
    timestamp
  } = prescriptionData;

  // Sort medicines by ID to ensure consistent hashing
  const sortedMedicines = [...medicines].sort((a, b) => {
    return (a.medicine_id || 0) - (b.medicine_id || 0);
  });

  // Build canonical medicine string
  const medicinesString = sortedMedicines
    .map(m => {
      return `${m.medicine_id}:${m.quantity}:${m.frequency}:${m.duration_days}`;
    })
    .join('|');

  const snapshotData = [
    `prescription_id=${prescriptionId}`,
    `opd_number=${opdNumber}`,
    `doctor_id=${doctorId}`,
    `pharmacy_id=${pharmacyId || 'NULL'}`,
    `diagnosis=${diagnosis || ''}`,
    `medicines=${medicinesString}`,
    `action=${action}`,
    `timestamp=${timestamp}`
  ].join('::');

  // Generate Keccak256 hash
  const hash = ethers.keccak256(ethers.toUtf8Bytes(snapshotData));
  
  console.log('📸 Prescription Snapshot generated:', {
    prescriptionId,
    action,
    medicineCount: medicines.length,
    hash: hash.substring(0, 10) + '...'
  });

  return hash;
}

module.exports = {
  generateRequestSnapshot,
  generatePrescriptionSnapshot,
  mapStatusToBlockchain,
  mapBlockchainToStatus,
  verifySnapshotIntegrity
};
