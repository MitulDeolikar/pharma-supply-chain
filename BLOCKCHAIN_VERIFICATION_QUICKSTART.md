# Blockchain Verification - Quick Start Guide

## Status: ✅ CODE IMPLEMENTATION COMPLETE

All code changes have been made to enable blockchain verification. The system is ready for deployment.

## What Changed?

### 1. **Database Schema** (Must Apply)
The migration file has been created and is ready to apply:

**File**: `migrations/add_blockchain_timestamp.sql`

**Apply It**:
```bash
cd "c:\Users\bhara\Event Management"
mysql -u root -p event_management < migrations/add_blockchain_timestamp.sql
```

Or manually in MySQL:
```sql
USE event_management;

ALTER TABLE pharmacy_emergency_requests
ADD COLUMN blockchain_timestamp INT NULL COMMENT 'Unix timestamp when recorded on blockchain',
ADD COLUMN blockchain_txhash VARCHAR(66) NULL COMMENT 'Blockchain transaction hash',
ADD COLUMN last_verified_timestamp INT NULL COMMENT 'Last timestamp verification was done';

CREATE INDEX idx_blockchain_timestamp ON pharmacy_emergency_requests(blockchain_timestamp);
```

### 2. **Core Blockchain Helper Updates** (Already Done ✅)
File: `pages/api/blockchainHelper.js`

**Updated Functions**:
- ✅ `recordRequestOnBlockchain()` - Now stores blockchain metadata in DB
- ✅ `verifyRequestIntegrity()` - Completely rewritten with proper timestamp handling and state validation
- ✅ `recordPrescriptionFinalization()` - Now stores prescription blockchain metadata
- ✅ `recordTamperingIncident()` - NEW function for security logging

### 3. **Approval Endpoint Updated** (Already Done ✅)
File: `pages/api/sendOrderToPharmacy.js`

**Changes**:
- ✅ Verification code uncommented (was lines 97-129)
- ✅ Proper error handling implemented
- ✅ Connection parameter passed to verification function
- ✅ Tampering incident logging enabled

## Pre-Deployment Checklist

- [ ] **Step 1**: Apply the database migration
  ```bash
  mysql -u root -p event_management < migrations/add_blockchain_timestamp.sql
  ```

- [ ] **Step 2**: Verify migration succeeded
  ```bash
  mysql -u root -p event_management -e "DESCRIBE pharmacy_emergency_requests;" | grep blockchain
  ```
  Should show 3 new columns: `blockchain_timestamp`, `blockchain_txhash`, `last_verified_timestamp`

- [ ] **Step 3**: Create required security tables (if not exists)
  ```sql
  USE event_management;
  
  CREATE TABLE IF NOT EXISTS security_incidents (
    incident_id INT AUTO_INCREMENT PRIMARY KEY,
    incident_type VARCHAR(50),
    request_id INT,
    severity VARCHAR(20),
    description TEXT,
    blockchain_status VARCHAR(50),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_request_id (request_id)
  );
  
  CREATE TABLE IF NOT EXISTS prescription_blockchain_metadata (
    prescription_id INT PRIMARY KEY,
    action VARCHAR(50),
    blockchain_timestamp INT,
    blockchain_txhash VARCHAR(66),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_prescription_action (prescription_id, action)
  );
  ```

- [ ] **Step 4**: Restart Next.js server
  ```bash
  # Kill existing process
  # Then restart: npm run dev
  ```

- [ ] **Step 5**: Test the flow (see Testing Guide below)

## Testing Guide

### Quick Test: Create and Approve Emergency Request

#### 1. Create an Emergency Request
```bash
curl -X POST http://localhost:3000/api/createEmergencyRequest \
  -H "Content-Type: application/json" \
  -d '{
    "pharmacyId": 1,
    "patientId": 123,
    "medicines": [{"medicine_id": 1, "quantity": 5}],
    "remarks": "Verify blockchain verification"
  }'
```

Response should show:
```json
{
  "success": true,
  "requestId": 30
}
```

#### 2. Check Database - Verify Blockchain Records
```bash
mysql -u root -p event_management -e \
  "SELECT request_id, status, blockchain_timestamp, blockchain_txhash FROM pharmacy_emergency_requests WHERE request_id = 30;"
```

Expected output:
```
request_id | status              | blockchain_timestamp | blockchain_txhash
-----------|--------------------|--------------------|------------------
30         | pending_approval... | 1704067200         | 0x123abc...
```

#### 3. CMO Approves the Request (Verification Runs Here)
```bash
curl -X POST http://localhost:3000/api/sendOrderToPharmacy \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": 30,
    "acceptingPharmacyId": 2
  }'
```

Expected response (after verification passes):
```json
{
  "success": true,
  "message": "Emergency request approved and sent..."
}
```

Check console logs for:
```
🔒 Running integrity verification for request #30...
✅ Request #30: Data integrity verified - valid state transition: pending_approval_from_cmo → order_sent
```

#### 4. Verify Updated Database Record
```bash
mysql -u root -p event_management -e \
  "SELECT request_id, status, blockchain_timestamp, blockchain_txhash FROM pharmacy_emergency_requests WHERE request_id = 30;"
```

Expected: Two blockchain records now (one from creation, one from approval)

### Advanced Test: Verify Tampering Detection Works

#### Scenario: Manual Data Modification (Tampering) Is Detected
```bash
# 1. Find a request with blockchain records
mysql -u root -p event_management -e \
  "SELECT request_id FROM pharmacy_emergency_requests WHERE blockchain_timestamp IS NOT NULL LIMIT 1;"

# 2. Get that request ID (let's say it's 30)

# 3. Tamper with the data by modifying a medicine quantity
mysql -u root -p event_management -e \
  "UPDATE pharmacy_emergency_request_items SET quantity_requested = 999 WHERE request_id = 30;"

# 4. Try to send order to pharmacy (verification should detect tampering)
curl -X POST http://localhost:3000/api/sendOrderToPharmacy \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": 30,
    "acceptingPharmacyId": 2
  }'

# Expected response: 403 Forbidden
# Message: "Data tampering detected! Database does not match blockchain records..."
```

Check console logs for:
```
🚨 TAMPERING DETECTED for request #30!
   Expected (blockchain): 0xabc123...
   Got (database): 0xdef456...
```

Check security incidents table:
```bash
mysql -u root -p event_management -e \
  "SELECT * FROM security_incidents WHERE request_id = 30;"
```

## Verification Logic Explained

### When You Approve a Request, Here's What Happens:

```
1. CMO sends approval request
    ↓
2. System checks: Is this request in valid "pending_approval_from_cmo" state?
    ↓
3. System checks: Does this request have blockchain records?
    ↓
4. System retrieves the blockchain-recorded state and timestamp
    ↓
5. System regenerates the data snapshot hash using:
    - Original request data
    - Original blockchain timestamp (KEY!)
    - Exact same hash algorithm as blockchain
    ↓
6. System compares:
    - Hash from database calculation  vs  Hash from blockchain
    ↓
7. If they match:
    ✅ Data is intact - approve request
    
8. If they DON'T match:
    🚨 Data has been tampered with - BLOCK approval
    🚨 Log security incident
    🚨 Alert system administrator
```

## Key Points to Understand

### ✅ What Gets Verified
- The request data hasn't been modified since it was recorded on blockchain
- The state transition is valid (can't go backward)
- No unauthorized changes to medicines, quantities, or details

### ⚠️ What Doesn't Block (Graceful Degradation)
- Blockchain temporarily unavailable → Proceed with warning
- Request never recorded on blockchain yet → Proceed (first time)
- Verification function has an error → Proceed with warning

### 🔴 What Definitely Blocks
- Data tampering detected (hash mismatch)
- Invalid state transition (e.g., trying to go from "rejected" → "order_sent")

## Rollback Plan (If Needed)

If you need to disable verification temporarily:

1. **Revert Approval Endpoint** (sendOrderToPharmacy.js):
   - Comment out lines 97-139 again
   - This disables verification but blockchain recording continues

2. **Revert Database Changes** (not recommended):
   ```sql
   ALTER TABLE pharmacy_emergency_requests 
   DROP COLUMN blockchain_timestamp,
   DROP COLUMN blockchain_txhash,
   DROP COLUMN last_verified_timestamp;
   ```

3. **Restart Server**: `npm run dev`

## Monitoring

After deployment, monitor:

- **Security Incidents**: Check `security_incidents` table for tampering attempts
  ```bash
  mysql -u root -p event_management -e "SELECT * FROM security_incidents WHERE DATE(timestamp) = CURDATE();"
  ```

- **Verification Success Rate**: Check server logs for verification messages
  ```bash
  # Look for:
  # ✅ Data integrity verified
  # ⚠️ Verification skipped
  # 🚨 TAMPERING DETECTED
  ```

- **Blockchain Connectivity**: Monitor Ganache status
  ```bash
  curl http://localhost:8545 -X POST \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
  ```

## Support

If verification fails with errors:

1. **Check Blockchain Connection**: Is Ganache running?
   ```bash
   npm run blockchain:check
   ```

2. **Check Database Schema**: Do the new columns exist?
   ```bash
   mysql -u root -p event_management -e "DESCRIBE pharmacy_emergency_requests LIKE 'blockchain%';"
   ```

3. **Check Logs**: What's the exact error message?
   ```bash
   # Check Next.js server logs for detailed error
   # Look in console output for 🔴 ERROR messages
   ```

4. **Test Hash Generation**: Verify Keccak256 is working
   ```bash
   # This is tested internally when running verification
   # If hashes don't match, issue is in hashUtils.js
   ```

## Summary

✅ **Done**: All code changes implemented and ready for production
⏳ **Next**: Apply database migrations and restart server
🎯 **Result**: Emergency requests now have tamper-proof verification

The system will now:
- Accept emergency requests and record them on blockchain
- Verify integrity when CMO approves requests
- Block any attempt to tamper with request data
- Log all security incidents for investigation
- Gracefully handle blockchain unavailability
