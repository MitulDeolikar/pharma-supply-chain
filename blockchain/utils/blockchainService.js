const { ethers } = require('ethers');

/**
 * Blockchain connection service
 * Works with Ganache local blockchain
 */
class BlockchainService {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.requestContract = null;
    this.prescriptionContract = null;
    this.initialized = false;
  }

  /**
   * Initialize blockchain connection to Ganache
   */
  async initialize() {
    if (this.initialized) return;

    // Mark initialized early — prevents repeated calls from hammering the retry loop
    this.initialized = true;

    const requestContractAddress = process.env.REQUEST_CONTRACT_ADDRESS;
    const prescriptionContractAddress = process.env.PRESCRIPTION_CONTRACT_ADDRESS;

    // Skip entirely when no contracts are deployed — avoids the ethers v6
    // "JsonRpcProvider failed to detect network; retry in 1s" spam in logs
    if (!requestContractAddress && !prescriptionContractAddress) {
      return;
    }

    try {
      // Get configuration from environment
      const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545';
      const privateKey = process.env.BLOCKCHAIN_PRIVATE_KEY;

      // staticNetwork suppresses ethers v6's internal network-detection polling loop
      // Ganache always uses chain ID 1337
      const ganacheNetwork = new ethers.Network('ganache', 1337);
      this.provider = new ethers.JsonRpcProvider(rpcUrl, ganacheNetwork, { staticNetwork: ganacheNetwork });
      
      if (privateKey && privateKey !== 'YOUR_PRIVATE_KEY_HERE') {
        this.signer = new ethers.Wallet(privateKey, this.provider);
        console.log('✅ Using configured wallet:', await this.signer.getAddress());
      } else {
        console.warn('⚠️ No private key configured');
        this.signer = null;
      }

      // Initialize Request Contract
      if (requestContractAddress && requestContractAddress !== 'YOUR_CONTRACT_ADDRESS') {
        const requestABI = [
          "function recordStateTransition(uint256 requestId, string memory requestType, string memory state, bytes32 snapshotHash, string memory remarks) external",
          "function getRequestHistory(uint256 requestId) external view returns (tuple(uint256 requestId, string requestType, string state, bytes32 snapshotHash, address actor, uint256 timestamp, string remarks)[])",
          "function getHistoryCount(uint256 requestId) external view returns (uint256)",
          "function getLatestState(uint256 requestId) external view returns (tuple(uint256 requestId, string requestType, string state, bytes32 snapshotHash, address actor, uint256 timestamp, string remarks))",
          "event RequestStateRecorded(uint256 indexed requestId, string requestType, string state, bytes32 snapshotHash, address indexed actor, uint256 timestamp)"
        ];
        this.requestContract = new ethers.Contract(
          requestContractAddress,
          requestABI,
          this.signer || this.provider
        );
        console.log('✅ Request contract loaded:', requestContractAddress);
      }

      // Initialize Prescription Contract
      if (prescriptionContractAddress && prescriptionContractAddress !== 'YOUR_CONTRACT_ADDRESS') {
        const prescriptionABI = [
          "function recordPrescriptionVersion(uint256 prescriptionId, bytes32 snapshotHash, string memory remarks) external",
          "function recordPrescriptionFinalization(uint256 prescriptionId, bytes32 snapshotHash, string memory action, string memory remarks) external",
          "function getPrescriptionHistory(uint256 prescriptionId) external view returns (tuple(uint256 prescriptionId, uint256 version, string action, bytes32 snapshotHash, address actor, uint256 timestamp, string remarks)[])",
          "function getLatestPrescriptionState(uint256 prescriptionId) external view returns (uint256 prescriptionId_, uint256 version, string memory action, bytes32 snapshotHash, address actor, uint256 timestamp, string memory remarks)",
          "function getPrescriptionVersionCount(uint256 prescriptionId) external view returns (uint256)",
          "function isPrescriptionFinalized(uint256 prescriptionId) external view returns (bool)",
          "event PrescriptionRecorded(uint256 indexed prescriptionId, uint256 version, string action, bytes32 snapshotHash, address indexed actor, uint256 timestamp)"
        ];
        this.prescriptionContract = new ethers.Contract(
          prescriptionContractAddress,
          prescriptionABI,
          this.signer || this.provider
        );
        console.log('✅ Prescription contract loaded:', prescriptionContractAddress);
      }

      this.initialized = true;
      console.log('✅ Blockchain service initialized');
      console.log(`🔗 Network: Ganache Local Blockchain`);
      
    } catch (error) {
      console.error('❌ Blockchain initialization failed:', error.message);
      // Don't throw - allow app to continue without blockchain
      // initialized stays true so we don't retry and flood logs
    }
  }

  /**
   * Get request contract instance
   */
  async getRequestContract() {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.requestContract) {
      throw new Error('Request contract not configured. Please deploy and set REQUEST_CONTRACT_ADDRESS in .env');
    }
    return this.requestContract;
  }

  /**
   * Get prescription contract instance
   */
  async getPrescriptionContract() {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.prescriptionContract) {
      throw new Error('Prescription contract not configured. Please deploy and set PRESCRIPTION_CONTRACT_ADDRESS in .env');
    }
    return this.prescriptionContract;
  }

  /**
   * Get signer address
   */
  async getSignerAddress() {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.signer) {
      throw new Error('No wallet configured. Please set BLOCKCHAIN_PRIVATE_KEY in .env');
    }
    return await this.signer.getAddress();
  }

  /**
   * Check if blockchain is available
   */
  async isAvailable() {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      if (!this.provider) return false;
      await this.provider.getBlockNumber();
      return true;
    } catch (error) {
      console.error('Blockchain unavailable:', error.message);
      return false;
    }
  }

  /**
   * Check if contracts are configured
   */
  isConfigured() {
    const requestAddr = process.env.REQUEST_CONTRACT_ADDRESS;
    const prescriptionAddr = process.env.PRESCRIPTION_CONTRACT_ADDRESS;
    return (
      (requestAddr && requestAddr !== 'YOUR_CONTRACT_ADDRESS') ||
      (prescriptionAddr && prescriptionAddr !== 'YOUR_CONTRACT_ADDRESS')
    );
  }
}

// Export singleton instance
module.exports = new BlockchainService();
