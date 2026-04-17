const { ethers } = require('ethers');

async function checkGanache() {
  try {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    
    console.log('\n🔍 Checking Ganache Status...\n');
    
    // Get all accounts
    const accounts = await provider.listAccounts();
    console.log(`📋 Total accounts: ${accounts.length}\n`);
    
    // Check balance for each account
    for (let i = 0; i < Math.min(accounts.length, 5); i++) {
      const address = accounts[i].address;
      const balance = await provider.getBalance(address);
      const ethBalance = ethers.formatEther(balance);
      console.log(`Account ${i}: ${address}`);
      console.log(`Balance: ${ethBalance} ETH\n`);
    }
    
    // Check our configured wallet
    const privateKey = process.env.BLOCKCHAIN_PRIVATE_KEY || '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
    const wallet = new ethers.Wallet(privateKey, provider);
    const walletBalance = await provider.getBalance(wallet.address);
    
    console.log('💼 Configured Wallet:');
    console.log(`Address: ${wallet.address}`);
    console.log(`Balance: ${ethers.formatEther(walletBalance)} ETH\n`);
    
    // Check if address matches any account
    const matchIndex = accounts.findIndex(acc => acc.address.toLowerCase() === wallet.address.toLowerCase());
    if (matchIndex >= 0) {
      console.log(`✅ Wallet matches Ganache account #${matchIndex}`);
    } else {
      console.log(`❌ Wallet does NOT match any Ganache account!`);
      console.log(`\n🔧 Fix: Use one of the private keys from Ganache's accounts`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkGanache();
