const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🚀 Deploying contracts to Ganache...\n');

  // Connect to Ganache
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  
  // Use Ganache's first account (comes with 1000 ETH automatically!)
  const accounts = await provider.listAccounts();
  const deployerAddress = accounts[0].address;
  const deployer = await provider.getSigner(0);
  
  console.log('📍 Deploying with account:', deployerAddress);
  const balance = await provider.getBalance(deployerAddress);
  console.log('💰 Account balance:', ethers.formatEther(balance), 'ETH\n');

  // Read contract source files
  const requestLedgerSource = fs.readFileSync(
    path.join(__dirname, '../contracts/EmergencyRequestLedger.sol'),
    'utf8'
  );
  const prescriptionLedgerSource = fs.readFileSync(
    path.join(__dirname, '../contracts/PrescriptionLedger.sol'),
    'utf8'
  );

  // Compile contracts using solc
  const solc = require('solc');
  
  const input = {
    language: 'Solidity',
    sources: {
      'EmergencyRequestLedger.sol': { content: requestLedgerSource },
      'PrescriptionLedger.sol': { content: prescriptionLedgerSource },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode'],
        },
      },
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  };

  console.log('⚙️  Compiling contracts...');
  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  // Check for errors
  if (output.errors) {
    const errors = output.errors.filter(e => e.severity === 'error');
    if (errors.length > 0) {
      console.error('❌ Compilation errors:');
      errors.forEach(err => console.error(err.formattedMessage));
      process.exit(1);
    }
  }

  console.log('✅ Contracts compiled successfully!\n');

  // Deploy EmergencyRequestLedger
  console.log('📤 Deploying EmergencyRequestLedger...');
  const RequestLedger = output.contracts['EmergencyRequestLedger.sol'].EmergencyRequestLedger;
  const requestFactory = new ethers.ContractFactory(
    RequestLedger.abi,
    RequestLedger.evm.bytecode.object,
    deployer
  );
  const requestContract = await requestFactory.deploy();
  await requestContract.waitForDeployment();
  const requestAddress = await requestContract.getAddress();
  console.log('✅ EmergencyRequestLedger deployed to:', requestAddress);

  // Deploy PrescriptionLedger
  console.log('\n📤 Deploying PrescriptionLedger...');
  const PrescriptionLedger = output.contracts['PrescriptionLedger.sol'].PrescriptionLedger;
  const prescriptionFactory = new ethers.ContractFactory(
    PrescriptionLedger.abi,
    PrescriptionLedger.evm.bytecode.object,
    deployer
  );
  const prescriptionContract = await prescriptionFactory.deploy();
  await prescriptionContract.waitForDeployment();
  const prescriptionAddress = await prescriptionContract.getAddress();
  console.log('✅ PrescriptionLedger deployed to:', prescriptionAddress);

  // Save deployment info
  const deploymentInfo = {
    network: 'Ganache Local',
    requestContractAddress: requestAddress,
    prescriptionContractAddress: prescriptionAddress,
    deployerAddress: deployerAddress,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(__dirname, '../deployment-info.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log('\n🎉 Deployment complete!\n');
  console.log('═══════════════════════════════════════════════════════');
  console.log('📋 COPY THESE TO YOUR .env FILE:');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`REQUEST_CONTRACT_ADDRESS=${requestAddress}`);
  console.log(`PRESCRIPTION_CONTRACT_ADDRESS=${prescriptionAddress}`);
  console.log(`BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545`);
  console.log(`BLOCKCHAIN_PRIVATE_KEY=${await deployer.provider.send('eth_accounts', []).then(accounts => 'GANACHE_ACCOUNT_0')}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
