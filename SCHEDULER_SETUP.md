# Emergency Request AI Scheduler - Setup Guide

## ✅ What's Implemented

The background scheduler automatically approves emergency requests after 10 minutes by:
1. **Checking every 5 minutes** for pending requests older than 10 minutes
2. **Finding eligible pharmacies** using the same logic as `eligiblePharmacies.js`
3. **Ranking pharmacies** by distance (same district preferred)
4. **Using Groq AI** (Mixtral 8x7b) to select best pharmacy
5. **Auto-approving** and sending order to selected pharmacy
6. **Handling generic medicines** with alternative selection

---

## 🚀 How to Run the Scheduler

### **Option 1: Using Custom Server (RECOMMENDED)**

This is the cleanest way to ensure the scheduler runs when your server starts:

```bash
# First, install dependencies (if you haven't)
npm install

# Start server with scheduler
node server.js
```

You should see:
```
🚀 Starting server...
✅ Emergency Request AI Scheduler started (runs every 5 minutes)
✅ Server running on http://localhost:3002
```

### **Option 2: Using Standard npm (With Manual Init)**

If you prefer using `npm run dev`:

```bash
npm run dev
```

Then in a browser, visit once:
```
http://localhost:3002/api/scheduler/init
```

Response:
```json
{
  "success": true,
  "message": "✅ Emergency request scheduler initialized"
}
```

After that, the scheduler runs in the background automatically.

---

## 📋 How It Works

### **Timeline of Auto-Approval**

```
Emergency Request Created (t=0)
          ↓ (CMO gets SMS notification)
          ↓
t=5min:   Scheduler checks... (not eligible yet)
t=10min:  Scheduler checks... (REQUEST IS ELIGIBLE!)
          ↓
          → Fetches all eligible pharmacies
          → Ranks by distance (same district first)
          → Calls Groq AI to select best one
          → Auto-approves and sends order
          ↓
          (Order sent, hospital notified)
```

### **Scheduler Logic** (`lib/emergencyRequestScheduler.js`)

1. **Runs Every 5 Minutes** - Node-cron executes the task
2. **Finds Pending Requests** - Queries for:
   - `status = 'pending_approval_from_cmo'`
   - `TIMESTAMPDIFF(MINUTE, request_date, NOW()) >= 10`
3. **Gets Eligible Pharmacies** - Uses same SQL as `eligiblePharmacies.js`:
   - Checks if pharmacy has all requested medicines (branded OR generic)
   - Excludes originating pharmacy
   - Returns up to 20 matches
4. **Ranks by Distance** - Simple heuristic:
   - Same district = closer (score = 5)
   - Different district = farther (score = 1)
5. **Calls Groq AI** - Sends ranked list to Mixtral 8x7b:
   - AI analyzes stock availability
   - AI selects best match
   - Returns JSON with selected pharmacy ID
6. **Auto-Approves** - Updates database:
   - Sets `status = 'order_sent'`
   - Records `accepting_pharmacy_id`
   - Sets `approval_date = NOW()`
   - Stores AI reasoning in `approval_notes`

---

## 🤖 About Groq AI vs Crew AI

### **You Asked: "Do we need Crew AI API?"**

**Answer: NO** ❌

**Why Groq is Sufficient:**
- ✅ Groq Mixtral 8x7b handles decision-making well
- ✅ Simple ranking task (doesn't need multi-agent orchestration)
- ✅ Fast response times (250ms average)
- ✅ Cheap (free tier available)
- ✅ Already configured in your `.env`

**When You'd Need Crew AI:**
- Complex workflows with multiple specialized agents
- Agent A researches options, Agent B analyzes, Agent C decides
- Long multi-step processes with memory
- Human-in-the-loop feedback loops
- For your use case: **OVERKILL**

**Your Current Setup is Perfect:**
```
Pharmacy waits 10 mins → Groq AI ranks pharmacies → Order sent
(Simple, fast, effective)
```

---

## 📊 Database Changes Needed

### **1. Execute Migration (if not done)**

```sql
ALTER TABLE cmo ADD COLUMN auto_approval_enabled BOOLEAN DEFAULT FALSE;
```

### **2. Verify Column Exists**

```sql
DESC cmo;
```

Look for `auto_approval_enabled` in the output.

---

## 🔧 Configuration

### **Environment Vars** (`.env` or `.env.local`)

Make sure these are set:

```env
# Already should exist
GROQ_API_KEY=your_groq_api_key_here
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=pharmacy_db

# Node-cron runs in UTC by default
NODE_ENV=development  # or production
```

### **Cron Schedule Explained**

```javascript
cron.schedule('*/5 * * * *', async () => {
  // This says: "Run every 5 minutes"
  // Format: minute hour day month dayOfWeek
  // */5 = every 5 minutes
})
```

To change frequency:
- Every 10 minutes: `'*/10 * * * *'`
- Every minute: `'* * * * *'`
- Every hour: `'0 * * * *'`

---

## 🧪 Testing the Scheduler

### **Step 1: Create a Test Emergency Request**

1. Log in as pharmacy
2. Go to emergency requests
3. Create a request with some medicines
4. Note the request creation time (t=0)

### **Step 2: Wait 10 Minutes**

You can either:
- Wait 10 actual minutes
- Or manually update the database:

```sql
UPDATE pharmacy_emergency_requests 
SET request_date = DATE_SUB(NOW(), INTERVAL 11 MINUTE)
WHERE request_id = <your_request_id>;
```

### **Step 3: Check Scheduler Output**

Watch the terminal where you ran `node server.js`:

```
🔍 Analyzing request #5...
📋 Found 3 eligible pharmacies

   Pharmacy 2 (Westside) - Same district - Distance Score: 5
   Pharmacy 4 (Downtown) - Different district - Distance Score: 1
   Pharmacy 7 (Central) - Same district - Distance Score: 5

🤖 AI Decision: APPROVE
   Confidence: 87%
   
✅ Request #5 auto-approved and sent to pharmacy 2!
   Order sent to pharmacy 2
```

### **Step 4: Check Database**

```sql
SELECT request_id, status, accepting_pharmacy_id, approval_notes 
FROM pharmacy_emergency_requests 
WHERE request_id = <your_request_id>;
```

Should show:
- `status = 'order_sent'`
- `accepting_pharmacy_id = 2` (or whichever pharmacy was selected)
- `approval_notes` contains AI reason

---

## 📝 Logs to Monitor

The scheduler logs everything to console:

```
🤖 [AI Agent] Waking up...
📋 Found X requests ready
🔍 Analyzing request #...
🤖 AI Decision: APPROVE
✅ Request auto-approved!
```

### **To Save Logs to File** (Optional)

```bash
# Redirect output to log file
node server.js > scheduler.log 2>&1 &
```

---

## ⚙️ Customization

### **Change Request Age Threshold**

In `lib/emergencyRequestScheduler.js`, line ~25:

```javascript
// Current: >= 10 minutes
AND TIMESTAMPDIFF(MINUTE, per.request_date, NOW()) >= 10

// Change to: >= 5 minutes
AND TIMESTAMPDIFF(MINUTE, per.request_date, NOW()) >= 5
```

### **Change Scheduler Frequency**

Line ~10:

```javascript
// Current: every 5 minutes
cron.schedule('*/5 * * * *', async () => {

// Change to: every 1 minute
cron.schedule('* * * * *', async () => {
```

### **Change Max Requests to Process**

Line ~27:

```javascript
// Current: limits to 10 requests per run
LIMIT 10

// Change to: process 20 per run
LIMIT 20
```

---

## 🚨 Troubleshooting

### **Scheduler Not Starting**

1. Check `.env` has `GROQ_API_KEY`
2. Check `node-cron` is installed: `npm list node-cron`
3. Check server.js output for errors
4. Verify database connection works

### **AI Not Responding**

1. Check Groq API key is valid
2. Check `GROQ_API_KEY` is in `.env`
3. Try manually calling Groq API:
```bash
curl -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"mixtral-8x7b-32768","messages":[{"role":"user","content":"test"}]}'
```

### **Requests Not Being Processed**

1. Verify `pharmacy_emergency_requests.status` is exactly `'pending_approval_from_cmo'`
2. Check request_date is not in future
3. Manually trigger check:
```sql
SELECT request_id, status, request_date, TIMESTAMPDIFF(MINUTE, request_date, NOW()) as minutes_elapsed
FROM pharmacy_emergency_requests
WHERE status = 'pending_approval_from_cmo'
ORDER BY request_date DESC;
```

---

## 📦 Next Steps

1. ✅ Run `node server.js` to start scheduler
2. ✅ Create test emergency request
3. ✅ Wait 10 minutes (or update database time)
4. ✅ Check if order was sent automatically
5. ✅ Monitor console output for any errors

---

## 🎯 Summary

| Component | Status |
|-----------|--------|
| Scheduler file | ✅ Created (`lib/emergencyRequestScheduler.js`) |
| Server initialization | ✅ Created (`server.js`) |
| API init endpoint | ✅ Created (`pages/api/scheduler/init.js`) |
| Eligible pharmacies logic | ✅ Integrated |
| Distance ranking | ✅ Implemented |
| Groq AI integration | ✅ Ready |
| Database migration | ⏳ Pending (run SQL statement) |
| Auto-approval execution | ✅ Implemented |

**To start using immediately:**
```bash
node server.js
```

Then create a test emergency request and wait 10+ minutes. The scheduler will auto-approve it! 🚀
