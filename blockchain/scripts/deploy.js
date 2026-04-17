const hre = require("hardhat");

async function main() {
  console.log("Deploying EmergencyRequestLedger contract...");

  const EmergencyRequestLedger = await hre.ethers.getContractFactory("EmergencyRequestLedger");
  const contract = await EmergencyRequestLedger.deploy();

  await contract.waitForDeployment();

  const address = await contract.getAddress();
  
  console.log("✅ EmergencyRequestLedger deployed to:", address);
  console.log("\n📝 IMPORTANT: Add this to your .env file:");
  console.log(`BLOCKCHAIN_CONTRACT_ADDRESS=${address}`);
  
  return address;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
