# CMO Auto-Approval Preference Integration

## How CMO Toggle Controls Scheduler

The scheduler respects each CMO's auto-approval preference setting.

### **Database Schema**

```sql
-- CMO table
ALTER TABLE cmo ADD COLUMN auto_approval_enabled BOOLEAN DEFAULT FALSE;

-- Emergency requests table (tracking AI decisions)
SELECT * FROM pharmacy_emergency_requests;
-- New columns (optional, for audit):
-- - ai_analysis (JSON with full AI analysis)
-- - ai_recommendation (AI reason text)
-- - approval_notes (for both manual and AI approvals)
```

### **Flow When Request Reaches 10 Minutes**

```
Scheduler wakes up every 5 minutes
    ↓
Finds requests older than 10 minutes
    ↓
For EACH request:
    - Check accepting_cmo_id
    - Get CMO's auto_approval_enabled setting
    ↓
If auto_approval_enabled = TRUE:
    ✅ Run AI analysis
    ✅ Find best pharmacy
    ✅ Auto-approve and send order
    ↓
If auto_approval_enabled = FALSE:
    ⭕ Skip AI analysis
    ⭕ Leave for CMO to manually approve
    ⭕ CMO will see it in their dashboard
```

### **Current Implementation Status**

**What's Working:**
- ✅ CMO toggle button (`/pages/admin.js`)
- ✅ Toggle API endpoints (`toggleCMOAutoApproval.js`, `getCMOPreference.js`)
- ✅ Database migration ready
- ✅ Scheduler file created

**What Needs Integration:**
- 🔗 Scheduler should check CMO preference before running AI
- 🔗 Database migration needs to be executed

---

## 📝 SQL Migration

Run this in MySQL to add the toggle column:

```sql
-- Add auto_approval_enabled to cmo table
ALTER TABLE cmo ADD COLUMN auto_approval_enabled BOOLEAN DEFAULT FALSE;

-- Verify it was added
DESC cmo;

-- Check current values
SELECT cmo_id, name, auto_approval_enabled FROM cmo;
```

After running, your API calls will work!

---

## 🔗 Integration Steps (Coming Next)

### **Step 1: Update Scheduler to Check CMO Preference**

In `lib/emergencyRequestScheduler.js`, before calling `getAIRecommendation()`:

```javascript
// Get the CMO for this request
const [cmoData] = await connection.execute(`
  SELECT cmo_id, auto_approval_enabled 
  FROM cmo 
  WHERE cmo_id = (
    SELECT cmo_assigned_id FROM pharmacy_emergency_requests WHERE request_id = ?
  )
`, [request.request_id]);

if (cmoData.length === 0 || !cmoData[0].auto_approval_enabled) {
  console.log(`⭕ CMO ${cmoData[0].cmo_id} has auto-approval DISABLED - skipping AI`);
  return; // Skip this request
}

// Otherwise continue with AI analysis
```

### **Step 2: Check That CMO ID Column Exists**

```sql
-- Check if pharmacy_emergency_requests has a CMO ID column
DESC pharmacy_emergency_requests;

-- If not, add it:
ALTER TABLE pharmacy_emergency_requests 
ADD COLUMN cmo_assigned_id INT, 
ADD FOREIGN KEY (cmo_assigned_id) REFERENCES cmo(cmo_id);
```

### **Step 3: Test the Integration**

1. Log in as CMO
2. Toggle auto-approval OFF
3. Create test emergency request as pharmacy
4. Wait 10 minutes
5. Check that request is NOT auto-approved
6. Toggle auto-approval ON
7. Create another emergency request
8. Wait 10 minutes
9. Check that request IS auto-approved

---

## 📊 Related Files

| File | Purpose |
|------|---------|
| `/pages/admin.js` | CMO dashboard with toggle button |
| `/pages/api/toggleCMOAutoApproval.js` | Saves toggle preference |
| `/pages/api/getCMOPreference.js` | Gets current toggle state |
| `lib/emergencyRequestScheduler.js` | Scheduler (needs CMO check added) |
| `server.js` | Initializes scheduler on startup |

---

## 💡 Key Points

1. **Auto-approval is optional** - CMO can turn it off anytime
2. **Default is OFF** - CMOs must manually enable if they want AI approval  
3. **Per-CMO setting** - Each CMO has their own preference
4. **Respects CMO control** - Scheduler won't auto-approve without permission
5. **Audit trail** - All auto-approvals logged with AI reasoning

---

## 🔄 Request Status Flow

```
Created → Pending Approval (0-10 mins)
            ↓
         (CMO might approve manually anytime)
            ↓
      10 min mark reached
            ↓
      If CMO auto-approval ON:
         → AI analyzes → Order sent (status: order_sent)
            ↓
      If CMO auto-approval OFF:
         → Waiting for CMO (stays pending)
```

---

## 📌 Remember

- **CMO toggle = permission** for AI to auto-approve
- **Scheduler = executor** that respects this permission
- **Both work together** for smart automation

The CMO stays in control! 🎉
