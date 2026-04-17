// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title EmergencyRequestLedger
 * @dev Immutable ledger for pharmacy emergency & demand request state transitions
 * Records critical state changes with tamper-proof snapshots
 * Optimized for Remix IDE deployment to Sepolia testnet
 */
contract EmergencyRequestLedger {
    
    // Structure for each state transition record
    struct StateCommit {
        uint256 requestId;
        string requestType;         // "EMERGENCY" or "DEMAND"
        string state;               // Current state as string for flexibility
        bytes32 snapshotHash;       // Hash of complete request snapshot
        address actor;              // Who made this transition
        uint256 timestamp;
        string remarks;
    }
    
    // Mapping: requestId => array of all state commits
    mapping(uint256 => StateCommit[]) public requestHistory;
    
    // Counter for total requests recorded
    uint256 public totalRequestsRecorded;
    
    // Events for off-chain tracking
    event RequestStateRecorded(
        uint256 indexed requestId,
        string requestType,
        string state,
        bytes32 snapshotHash,
        address indexed actor,
        uint256 timestamp
    );
    
    /**
     * @dev Record a state transition for a request (emergency or demand)
     * @param requestId The request ID from MySQL database
     * @param requestType "EMERGENCY" or "DEMAND"
     * @param state The new state (e.g., "CREATED", "APPROVED", "DISPATCHED", "RECEIVED")
     * @param snapshotHash Keccak256 hash of request snapshot
     * @param remarks Optional remarks
     */
    function recordStateTransition(
        uint256 requestId,
        string memory requestType,
        string memory state,
        bytes32 snapshotHash,
        string memory remarks
    ) external {
        StateCommit memory commit = StateCommit({
            requestId: requestId,
            requestType: requestType,
            state: state,
            snapshotHash: snapshotHash,
            actor: msg.sender,
            timestamp: block.timestamp,
            remarks: remarks
        });
        
        // If first time recording this request, increment counter
        if (requestHistory[requestId].length == 0) {
            totalRequestsRecorded++;
        }
        
        requestHistory[requestId].push(commit);
        
        emit RequestStateRecorded(
            requestId,
            requestType,
            state,
            snapshotHash,
            msg.sender,
            block.timestamp
        );
    }
    
    /**
     * @dev Get the full history of a request
     * @param requestId The request ID to query
     * @return Array of all state commits for this request
     */
    function getRequestHistory(uint256 requestId) 
        external 
        view 
        returns (StateCommit[] memory) 
    {
        return requestHistory[requestId];
    }
    
    /**
     * @dev Get the total number of state records for a request
     * @param requestId The request ID to query
     * @return Number of state transitions recorded
     */
    function getHistoryCount(uint256 requestId) 
        external 
        view 
        returns (uint256) 
    {
        return requestHistory[requestId].length;
    }
    
    /**
     * @dev Get a specific state record
     * @param requestId The request ID
     * @param index The index in the history array
     * @return The state commit at that index
     */
    function getStateCommit(uint256 requestId, uint256 index)
        external
        view
        returns (StateCommit memory)
    {
        require(index < requestHistory[requestId].length, "Index out of bounds");
        return requestHistory[requestId][index];
    }
    
    /**
     * @dev Get the latest state of a request
     * @param requestId The request ID
     * @return The most recent state commit
     */
    function getLatestState(uint256 requestId)
        external
        view
        returns (StateCommit memory)
    {
        require(requestHistory[requestId].length > 0, "No history for this request");
        uint256 lastIndex = requestHistory[requestId].length - 1;
        return requestHistory[requestId][lastIndex];
    }
}
