# 🚀 Complete Execution Guide: Emergency Request AI Scheduler

## Quick Start (3 Steps)

### **Step 1: Execute Database Migration**

Open your MySQL client and run:

```sql
-- Add auto_approval_enabled column to cmo table
ALTER TABLE cmo ADD COLUMN auto_approval_enabled BOOLEAN DEFAULT FALSE;

-- Verify it worked
DESC cmo;

-- You should see auto_approval_enabled in the list
```

### **Step 2: Start the Scheduler**

In terminal, from project root:

```bash
# Option A: Using custom server (RECOMMENDED)
npm run dev:with-scheduler

# OR Option B: Standard dev mode + manual init
npm run dev
# Then visit: http://localhost:3002/api/scheduler/init
```

You should see:
```
🚀 Starting server...
✅ Emergency Request AI Scheduler started (runs every 5 minutes)
✅ Server running on http://localhost:3002
```

### **Step 3: Test It**

Create an emergency request as pharmacy → Wait 10+ minutes → See auto-approval happen!

---

## 📋 Detailed Pre-Execution Checklist

### **1. Verify Dependencies**

```bash
npm list node-cron
npm list mysql2
npm list dotenv
```

All should show versions (not "not installed").

### **2. Verify Environment Variables**

Check your `.env` or `.env.local` file:

```env
# Required for Groq AI
GROQ_API_KEY=your_key_here

# Required for Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=pharmacy_db
```

If any are missing, add them.

### **3. Verify Database Connection**

Test your DB connection:

```bash
mysql -h localhost -u root -p pharmacy_db -e "SELECT * FROM pharmacy LIMIT 1;"
```

Should show pharmacy records without errors.

### **4. Verify Groq API Key**

Test the API key:

```bash
curl -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"mixtral-8x7b-32768","messages":[{"role":"user","content":"hello"}],"max_tokens":10}'
```

Should return a valid JSON response (not "Invalid API key").

---

## 🔧 Step-by-Step Setup

### **Phase 1: Database Setup (5 minutes)**

```bash
# 1. Open MySQL
mysql -h localhost -u root -p

# 2. Select your database
USE pharmacy_db;

# 3. Add the column
ALTER TABLE cmo ADD COLUMN auto_approval_enabled BOOLEAN DEFAULT FALSE;

# 4. Verify
DESC cmo;
# Look for: auto_approval_enabled | TINYINT(1)

# 5. Check existing data
SELECT cmo_id, name, auto_approval_enabled FROM cmo;
# Should show all CMOs with auto_approval_enabled = 0 (FALSE)

# 6. Exit
EXIT;
```

### **Phase 2: Environment Setup (2 minutes)**

Check your `.env.local`:

```bash
# Windows PowerShell
Get-Content .env.local | Select-String "GROQ"

# Or just open the file
notepad .env.local
```

Make sure you have:
```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxx...
```

If missing, add it!

### **Phase 3: Start Scheduler (1 minute)**

Option A (Recommended):
```bash
npm run dev:with-scheduler
```

Option B (If you prefer standard npm):
```bash
npm run dev
# In another terminal or browser: http://localhost:3002/api/scheduler/init
```

### **Phase 4: Test Scheduler (15+ minutes)**

Now follow the testing procedure below.

---

## 🧪 Testing Procedure

### **Test Case 1: Manual Time Travel (Quick Test)**

This lets you instantly test without waiting 10 minutes.

```sql
-- 1. Create emergency request (normally through UI)
-- Go to http://localhost:3002/pharmacySearch
-- Create request, note the request_id (let's say it's 42)

-- 2. Move request back in time (simulate 10+ minute wait)
UPDATE pharmacy_emergency_requests 
SET request_date = DATE_SUB(NOW(), INTERVAL 11 MINUTE)
WHERE request_id = 42;

-- 3. Verify it worked
SELECT request_id, request_date, status, TIMESTAMPDIFF(MINUTE, request_date, NOW()) as minutes_old
FROM pharmacy_emergency_requests 
WHERE request_id = 42;
-- Should show: minutes_old = 11

-- 4. Wait for next scheduler run (max 5 minutes)
-- Watch the terminal output

-- 5. Check if auto-approved
SELECT request_id, status, accepting_pharmacy_id, approval_notes
FROM pharmacy_emergency_requests 
WHERE request_id = 42;
-- Should show: status = 'order_sent', accepting_pharmacy_id = some_id
```

### **Test Case 2: Real Wait (Verify Working)**

```sql
-- 1. Create request (note current time and request_id)
-- (Done through UI, wait 10 real minutes)

-- 2. After 10 minutes, check status
SELECT request_id, status, accepting_pharmacy_id 
FROM pharmacy_emergency_requests 
WHERE request_id = YOUR_REQUEST_ID;

-- 3. Should show order_sent automatically
```

### **Test Case 3: Verify Generic Medicine Alternatives**

```sql
-- Create request with generic medicines (not specific brands)
-- Check that AI correctly finds pharmacies with alternative medicines
-- Example: Request Cetirizine (generic)
--          AI should find pharmacies with ANY antihistamine brand

-- After 10 minutes, request should be approved to a pharmacy with alternatives
```

---

## 📊 Monitoring the Scheduler

### **Watch Terminal Output**

When scheduler runs, you'll see:

```
🤖 [AI Agent] Waking up... checking for pending requests
📋 Found 2 requests ready for AI analysis

Analyzing request #42...
📋 Found 5 eligible pharmacies
🔍 Analyzing request #42...

   Pharmacy 2 (Westside) - Same district - Distance Score: 5
   Pharmacy 5 (Central) - Same district - Distance Score: 5  
   Pharmacy 8 (Downtown) - Different district - Distance Score: 1

🤖 AI Decision: APPROVE
   Confidence: 89%
   Summary: Located in same district with sufficient stock and good expiry dates

✅ Request #42 auto-approved and sent to pharmacy 2!
   Order sent to pharmacy 2
```

### **Database Monitoring**

Check requests in real-time:

```sql
-- All pending requests
SELECT request_id, status, request_date, TIMESTAMPDIFF(MINUTE, request_date, NOW()) as min_old
FROM pharmacy_emergency_requests
WHERE status IN ('pending_approval_from_cmo', 'order_sent')
ORDER BY request_date DESC;

-- Recently approved (by AI)
SELECT request_id, status, accepting_pharmacy_id, approval_notes
FROM pharmacy_emergency_requests 
WHERE status = 'order_sent' 
AND approval_notes LIKE '%Auto-approved by AI%'
ORDER BY approval_date DESC
LIMIT 5;

-- All rejections
SELECT request_id, status, rejection_reason
FROM pharmacy_emergency_requests 
WHERE status = 'rejected'
ORDER BY request_date DESC
LIMIT 5;
```

---

## 🐛 Debugging Issues

### **Issue 1: "Scheduler not starting"**

**Check 1:** Is server.js running?
```bash
# You should see this in terminal:
# ✅ Emergency Request AI Scheduler started
```

**Check 2:** Is node-cron installed?
```bash
npm list node-cron
# Should show: node-cron@4.2.1
```

**Check 3:** Check for errors in terminal
```bash
# Look for red error messages
# If you see errors, share the full error message
```

---

### **Issue 2: "Requests not auto-approving"**

**Check 1:** Are requests actually pending?
```sql
SELECT request_id, status, request_date 
FROM pharmacy_emergency_requests 
ORDER BY request_date DESC LIMIT 3;
-- All should have status = 'pending_approval_from_cmo' (exactly this string)
```

**Check 2:** Is request old enough?
```sql
SELECT request_id, request_date, TIMESTAMPDIFF(MINUTE, request_date, NOW()) as min_old
FROM pharmacy_emergency_requests
WHERE status = 'pending_approval_from_cmo'
ORDER BY request_date DESC;
-- Should show min_old >= 10
```

**Check 3:** Are there eligible pharmacies?
```sql
-- Manually check if any pharmacy has the requested medicine
SELECT DISTINCT p.pharmacy_id, p.username, SUM(s.quantity) as total
FROM pharmacy p
JOIN stock s ON p.pharmacy_id = s.pharmacy_id
WHERE s.medicine_id = (SELECT medicine_id FROM medicines WHERE name LIKE '%Paracetamol%' LIMIT 1)
AND s.expiry_date > CURDATE()
GROUP BY p.pharmacy_id;
-- Should show at least 1 pharmacy with quantity > 0
```

---

### **Issue 3: "Groq API not responding"**

**Check 1:** Is API key valid?
```bash
GROQ_API_KEY=your_key
curl -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"mixtral-8x7b-32768",
    "messages":[{"role":"user","content":"test"}],
    "max_tokens":10
  }'
```

Should return valid JSON, not error.

**Check 2:** Check terminal for API errors
Look in terminal output for:
```
AI API error: ...
```

**Fix:** Get a new Groq API key from https://console.groq.com

---

## 📈 Performance Tuning

### **Scheduler Runs Too Frequently?**

Change `*/5` (every 5 minutes) to:
- `*/10` = every 10 minutes
- `0 * * * *` = every hour

In `lib/emergencyRequestScheduler.js`:
```javascript
cron.schedule('*/10 * * * *', async () => {
  // Now runs every 10 minutes
})
```

### **Want Auto-Approval Faster?**

Change `>= 10` to `>= 5`:

In `lib/emergencyRequestScheduler.js`:
```javascript
AND TIMESTAMPDIFF(MINUTE, per.request_date, NOW()) >= 5  // 5 min instead of 10
```

### **Want to Process More Requests Per Run?**

Change `LIMIT 10` to `LIMIT 20`:

In `lib/emergencyRequestScheduler.js`:
```javascript
LIMIT 20  // Process 20 requests per scheduler run instead of 10
```

---

## ✅ Verification Checklist

Before claiming success, verify ALL of these:

- [ ] Database migration executed (run DESC cmo; and see the column)
- [ ] Server started without errors (npm run dev:with-scheduler)
- [ ] Scheduler initialized (see "✅ Scheduler started" message)
- [ ] Emergency request created (through UI)
- [ ] Request moved back 10+ minutes (SQL query)
- [ ] Scheduler processed it (see logs in terminal)
- [ ] Database updated (status = 'order_sent')
- [ ] Accepting pharmacy populated (column != null)
- [ ] AI reasoning logged (approval_notes contains "Auto-approved")

**If all pass: 🎉 YOU'RE DONE!**

---

## 💬 To Answer Your Questions

### **"Do we need Crew AI API?"**

**NO** ❌

**Why:**
- Your task is simple: rank eligible pharmacies
- Groq Mixtral handles this perfectly
- Crew AI is for complex multi-agent workflows
- Your current setup: Groq is sufficient and faster

**When to use Crew AI:**
- Multiple agents collaborating
- Complex reasoning chains
- Very hard decision-making
- YOUR use case: Not needed

---

### **"How does the cron job work?"**

**Mechanism:**
1. Node-cron library reads schedule: `'*/5 * * * *'`
2. Runs the function every 5 minutes automatically
3. Checks database for eligible requests
4. Calls Groq AI for ranking
5. Updates database with results

**No manual triggers needed** - it just runs on its own! ✨

---

### **"How to run the cron job?"**

**Answer:**

```bash
npm run dev:with-scheduler
```

That's it! The scheduler starts automatically.

---

## 📞 Need Help?

If something doesn't work:

1. Check terminal output (most errors are there)
2. Run SQL queries above to verify database state
3. Check that request_date is LESS than current time
4. Verify GROQ_API_KEY in .env is valid
5. Share full error message from terminal

---

## 🎯 Final Summary

| Step | Command | Time |
|------|---------|------|
| 1. DB Migration | MySQL `ALTER TABLE...` | 1 min |
| 2. Start Server | `npm run dev:with-scheduler` | 1 min |
| 3. Create Request | Through UI | 2 min |
| 4. Wait/Simulate | Wait 10 min or SQL | 11 min |
| 5. Verify | Check database | 1 min |
| **TOTAL** | | **16 minutes** |

**Total Setup Time: ~20 minutes MAX**

Happy auto-approving! 🚀
