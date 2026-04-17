# 🔍 Alternative Medicines & Database Changes Analysis

## Question: Do requested items change in the database when CMO approves alternative medicines?

## ✅ **Answer: NO - Original Request Items NEVER Change**

---

## 📊 How It Works

### Database Tables Involved:

1. **`pharmacy_emergency_requests`** - Main request table
   - Stores: request_id, pharmacy_id, accepting_pharmacy_id, status

2. **`pharmacy_emergency_request_items`** - Request items table
   - Stores: request_item_id, request_id, medicine_id, quantity_requested
   - **This table is NEVER modified after creation**

3. **`stock`** - Pharmacy stock table
   - This is where actual deductions happen

---

## 🔄 Complete Flow

### Step 1: Request Creation (User Action)
```sql
-- User requests Medicine M123 (Paracetamol 500mg)
INSERT INTO pharmacy_emergency_request_items 
VALUES (1, request_id=5, medicine_id=123, quantity_requested=10);
```

**Database State:**
```
pharmacy_emergency_request_items:
request_item_id | request_id | medicine_id | quantity_requested
1               | 5          | 123         | 10
```

**Status:** `pending_approval_from_cmo`

---

### Step 2: CMO Searches for Pharmacies

#### Scenario A: Exact Medicine Available
```javascript
// API: eligiblePharmacies.js
// Finds pharmacies with medicine_id = 123
Response: [
  {
    pharmacy_id: 10,
    medicine_id: 123,
    medicine_name: "Paracetamol 500mg",
    available: 50,
    is_alternative: false  // ← Exact match!
  }
]
```

**Database remains unchanged**

#### Scenario B: Exact Medicine NOT Available, Alternatives Found
```javascript
// API: eligiblePharmacies.js (line ~163)
// Medicine M123 not found, but same generic_id medicines exist

Response: [
  {
    pharmacy_id: 10,
    is_alternative: true,  // ← Alternative flag
    requestItems: [
      {
        original_medicine_id: 123,  // Original request
        is_alternative: true,
        alternative_generic_id: 5,   // Same category
        quantity_requested: 10
      }
    ],
    stocks: [
      { medicine_id: 124, medicine_name: "Paracetamol 650mg", quantity: 20 },
      { medicine_id: 125, medicine_name: "Paracetamol 1000mg", quantity: 15 }
    ]
  }
]
```

**Database STILL unchanged - only UI shows alternatives**

---

### Step 3: CMO Sends Order (Approval)

```javascript
// API: sendOrderToPharmacy.js (line ~64)

// Updates ONLY the main request table
UPDATE pharmacy_emergency_requests 
SET accepting_pharmacy_id = 10, 
    status = 'order_sent'
WHERE request_id = 5;
```

**Database State After Approval:**
```
pharmacy_emergency_requests:
request_id | pharmacy_id | accepting_pharmacy_id | status
5          | 3           | 10                    | order_sent

pharmacy_emergency_request_items: (UNCHANGED!)
request_item_id | request_id | medicine_id | quantity_requested
1               | 5          | 123         | 10  ← Still original!
```

**Key Point:** The `pharmacy_emergency_request_items` table is **NEVER updated**. It always keeps the original request!

---

### Step 4: Accepting Pharmacy Confirms Receipt

When the accepting pharmacy confirms, they select which **actual medicines** they're sending:

```javascript
// UI Flow: selectMedicineStocks.js
// Pharmacy selects from their stock:
Selected: [
  { stock_id: 50, medicine_id: 124, medicine_name: "Paracetamol 650mg", quantity: 5 },
  { stock_id: 51, medicine_id: 125, medicine_name: "Paracetamol 1000mg", quantity: 5 }
]
// Total: 10 units (matches quantity_requested)
```

---

### Step 5: Stock Allocation (Actual Deduction)

```javascript
// API: allocateEmergencyOrderStocks.js (line ~98)

// For EACH selected medicine/stock:
UPDATE stock 
SET quantity = quantity - allocated_quantity
WHERE stock_id = ?;

// Example:
UPDATE stock SET quantity = 15 WHERE stock_id = 50;  // Was 20, now 15
UPDATE stock SET quantity = 10 WHERE stock_id = 51;  // Was 15, now 10
```

**Final Database State:**
```
pharmacy_emergency_requests:
request_id | status
5          | order_successful  ← Status updated

pharmacy_emergency_request_items: (STILL UNCHANGED!)
request_item_id | request_id | medicine_id | quantity_requested
1               | 5          | 123         | 10  ← Still shows original request

stock: (Changed)
stock_id | pharmacy_id | medicine_id | quantity
50       | 10          | 124         | 15  ← Was 20
51       | 10          | 125         | 10  ← Was 15

pharmacy_sales_history: (New records)
history_id | pharmacy_id | medicine_id | quantity_sold | sale_type
100        | 10          | 124         | 5             | emergency
101        | 10          | 125         | 5             | emergency
```

---

## 🎯 Summary Table

| What Changes? | When? | Table | Original Data Preserved? |
|--------------|-------|-------|-------------------------|
| **Request items** | Never | `pharmacy_emergency_request_items` | ✅ YES - Never modified |
| **Request status** | CMO approval | `pharmacy_emergency_requests` | ✅ YES - Only status updated |
| **Accepting pharmacy** | CMO approval | `pharmacy_emergency_requests` | ✅ YES - Added, not changed |
| **Stock quantities** | Receipt confirmation | `stock` | ❌ NO - Deducted |
| **Sales history** | Receipt confirmation | `pharmacy_sales_history` | N/A - New records added |

---

## 🔐 Why This Design is Good

### 1. **Audit Trail**
```sql
-- You can always see what was ORIGINALLY requested:
SELECT * FROM pharmacy_emergency_request_items WHERE request_id = 5;
-- Shows: medicine_id = 123 (original request)
```

### 2. **Traceability**
```sql
-- You can see what was ACTUALLY sent:
SELECT * FROM pharmacy_sales_history 
WHERE pharmacy_id = 10 AND sale_type = 'emergency';
-- Shows: medicine_id = 124, 125 (actual medicines sent)
```

### 3. **Blockchain Consistency**
```javascript
// Blockchain records the ORIGINAL request
Hash includes: medicine_id = 123, quantity = 10

// This never changes, providing immutable proof of:
// - What was originally requested
// - What was approved
// - When it happened
```

---

## 🧪 Example Scenario

**Original Request:**
- Medicine: Amoxicillin 500mg (medicine_id = 10)
- Quantity: 20 tablets

**What Pharmacy Sends (Alternative):**
- Medicine: Amoxicillin 250mg (medicine_id = 11)
- Quantity: 40 tablets (equivalent dose)

**Database:**
```
pharmacy_emergency_request_items:
medicine_id = 10  ← Original request NEVER changes

pharmacy_sales_history:
medicine_id = 11  ← What was actually sent
```

**Result:** You have complete transparency:
- Original intent is preserved
- Actual fulfillment is recorded
- Audit trail is complete

---

## ✅ Final Answer

**NO, the requested items in `pharmacy_emergency_request_items` table DO NOT change when:**
1. CMO approves the request
2. Alternative medicines are sent
3. Pharmacy confirms receipt

**The original request data is PERMANENTLY preserved for:**
- Audit purposes
- Blockchain verification
- Traceability
- Compliance

**Only changes that occur:**
- `pharmacy_emergency_requests.status` updates
- `pharmacy_emergency_requests.accepting_pharmacy_id` is set
- `stock` quantities are deducted
- `pharmacy_sales_history` records what was actually sent

**This ensures complete transparency and auditability! 🎉**
