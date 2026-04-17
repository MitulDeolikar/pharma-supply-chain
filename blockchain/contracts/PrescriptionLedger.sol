// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title PrescriptionLedger
 * @dev Immutable ledger for prescription lifecycle with VERSIONING
 * Records every create/edit as a version + finalization (PHARMACY_SERVED, NAC_ISSUED)
 */
contract PrescriptionLedger {
    
    // Structure for prescription state
    struct PrescriptionState {
        uint256 prescriptionId;
        uint256 version;            // Version number (1, 2, 3...)
        string action;              // VERSION, PHARMACY_SERVED, NAC_ISSUED
        bytes32 snapshotHash;       // Hash of prescription data
        address actor;              // Doctor or pharmacy wallet
        uint256 timestamp;
        string remarks;
    }
    
    // Mapping: prescriptionId => array of all state transitions
    mapping(uint256 => PrescriptionState[]) public prescriptionHistory;
    
    // Mapping: prescriptionId => latest state (for quick access)
    mapping(uint256 => PrescriptionState) public latestPrescriptionState;
    
    // Tracking
    uint256 public totalPrescriptions;
    
    // Events
    event PrescriptionRecorded(
        uint256 indexed prescriptionId,
        uint256 version,
        string action,
        bytes32 snapshotHash,
        address indexed actor,
        uint256 timestamp
    );
    
    /**
     * @dev Record prescription version (creation or edit)
     * Every create/edit increments version number
     */
    function recordPrescriptionVersion(
        uint256 prescriptionId,
        bytes32 snapshotHash,
        string memory remarks
    ) external {
        // Calculate version number
        uint256 version = prescriptionHistory[prescriptionId].length + 1;
        
        PrescriptionState memory state = PrescriptionState({
            prescriptionId: prescriptionId,
            version: version,
            action: "VERSION",
            snapshotHash: snapshotHash,
            actor: msg.sender,
            timestamp: block.timestamp,
            remarks: remarks
        });
        
        // If first record of this prescription
        if (prescriptionHistory[prescriptionId].length == 0) {
            totalPrescriptions++;
        }
        
        prescriptionHistory[prescriptionId].push(state);
        latestPrescriptionState[prescriptionId] = state;
        
        emit PrescriptionRecorded(
            prescriptionId,
            version,
            "VERSION",
            snapshotHash,
            msg.sender,
            block.timestamp
        );
    }
    
    /**
     * @dev Record prescription finalization (pharmacy serving or NAC)
     * This is the final state - prescription cannot be edited after this
     */
    function recordPrescriptionFinalization(
        uint256 prescriptionId,
        bytes32 snapshotHash,
        string memory action,
        string memory remarks
    ) external {
        require(
            keccak256(bytes(action)) == keccak256(bytes("PHARMACY_SERVED")) ||
            keccak256(bytes(action)) == keccak256(bytes("NAC_ISSUED")),
            "Invalid action: must be PHARMACY_SERVED or NAC_ISSUED"
        );
        
        // Get version number (continuation from last VERSION)
        uint256 version = prescriptionHistory[prescriptionId].length + 1;
        
        PrescriptionState memory state = PrescriptionState({
            prescriptionId: prescriptionId,
            version: version,
            action: action,
            snapshotHash: snapshotHash,
            actor: msg.sender,
            timestamp: block.timestamp,
            remarks: remarks
        });
        
        prescriptionHistory[prescriptionId].push(state);
        latestPrescriptionState[prescriptionId] = state;
        
        emit PrescriptionRecorded(
            prescriptionId,
            version,
            action,
            snapshotHash,
            msg.sender,
            block.timestamp
        );
    }
    
    /**
     * @dev Get complete history of a prescription
     */
    function getPrescriptionHistory(uint256 prescriptionId) 
        external 
        view 
        returns (PrescriptionState[] memory) 
    {
        return prescriptionHistory[prescriptionId];
    }
    
    /**
     * @dev Get latest state of a prescription
     */
    function getLatestPrescriptionState(uint256 prescriptionId) 
        external 
        view 
        returns (
            uint256 prescriptionId_,
            uint256 version,
            string memory action,
            bytes32 snapshotHash,
            address actor,
            uint256 timestamp,
            string memory remarks
        ) 
    {
        PrescriptionState memory state = latestPrescriptionState[prescriptionId];
        
        // Check if prescription exists
        require(
            prescriptionHistory[prescriptionId].length > 0,
            "Prescription not found"
        );
        
        return (
            state.prescriptionId,
            state.version,
            state.action,
            state.snapshotHash,
            state.actor,
            state.timestamp,
            state.remarks
        );
    }
    
    /**
     * @dev Get prescription version count
     */
    function getPrescriptionVersionCount(uint256 prescriptionId) 
        external 
        view 
        returns (uint256) 
    {
        return prescriptionHistory[prescriptionId].length;
    }
    
    /**
     * @dev Check if prescription is finalized
     */
    function isPrescriptionFinalized(uint256 prescriptionId) 
        external 
        view 
        returns (bool) 
    {
        if (prescriptionHistory[prescriptionId].length == 0) {
            return false;
        }
        
        PrescriptionState memory state = latestPrescriptionState[prescriptionId];
        return (
            keccak256(bytes(state.action)) == keccak256(bytes("PHARMACY_SERVED")) ||
            keccak256(bytes(state.action)) == keccak256(bytes("NAC_ISSUED"))
        );
    }
}
