# CLAUDE.md — Project Context for AI Assistants

## What This Project Is

Despite being named "Event Management" in the directory, this is a **Pharmaceutical Supply Chain & Emergency Medicine Management System** (a DBMS project). It manages medicine requests, inventory, prescriptions, and waste disposal across a network of pharmacies supervised by a Chief Medical Officer (CMO).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2.35 (React 18.3.1) |
| Language | JavaScript (Node.js) |
| Database | MySQL 8.0 on Aiven Cloud |
| DB Driver | mysql2 3.9.2 (promise API, no ORM) |
| Styling | Tailwind CSS 3.3.0 |
| Auth | JWT + bcryptjs |
| Blockchain | Ganache (local Ethereum) + Solidity 0.8.19 + ethers.js 6 |
| AI | Groq API (Mixtral LLM) for auto-approval |
| SMS | Twilio |
| Scheduling | node-cron (via custom server.js) |
| Maps | Leaflet 1.9.4 |
| PDF | jsPDF |

---

## User Roles

1. **Pharmacy** — Create emergency/demand requests, manage stock, fulfill prescriptions
2. **CMO (Chief Medical Officer / Admin)** — Approve requests, oversee the network
3. **Doctor** — Create prescriptions for OPD patients
4. **Patient (OPD)** — View prescriptions
5. **Warehouse** — Manage disposal of expired medicines

---

## Core Modules

### 1. Emergency Pharmacy Requests
Pharmacies request medicines urgently from other pharmacies.

**Flow:** Pharmacy creates request → Blockchain records it → CMO approves (manually or via AI auto-approval after 10 min) → Accepting pharmacy confirms receipt → Stock deducted

**Key files:**
- `pages/api/createEmergencyRequest.js`
- `pages/api/eligiblePharmacies.js`
- `pages/api/sendOrderToPharmacy.js`
- `pages/api/confirmOrderReceipt.js`
- `pages/api/allocateEmergencyOrderStocks.js`

### 2. Demand Requests
Planned medicine procurement requests (similar to emergency but non-urgent).

### 3. Prescription Management
Doctors create prescriptions → Pharmacies serve them → Blockchain records versions.

**Key files:**
- `pages/api/createPrescription.js`
- `pages/api/servePrescription.js`
- `pages/api/allocatePrescriptionStocks.js`

### 4. Medicine Inventory
Stock management per pharmacy: add/edit/remove stock with batch numbers, quantities, expiry dates.

**Key files:**
- `pages/api/addStock.js`, `editStock.js`, `fetchPharmacyStock.js`

### 5. Blockchain Immutable Ledger
Every request state change is hashed (Keccak256) and recorded on Ganache smart contracts for tamper-proof audit.

**Contracts:**
- `blockchain/contracts/EmergencyRequestLedger.sol`
- `blockchain/contracts/PrescriptionLedger.sol`

**Utilities:**
- `blockchain/utils/hashUtils.js` — Snapshot + hash generation
- `blockchain/utils/blockchainService.js` — ethers.js interaction
- `pages/api/blockchainHelper.js` — Recording to chain
- `pages/api/getBlockchainHistory.js` — Audit retrieval

### 6. CMO Auto-Approval Scheduler
CMO can toggle AI auto-approval. Scheduler runs every 5 min via node-cron; uses Groq AI to select best pharmacy for requests older than 10 min.

**Key files:**
- `lib/emergencyRequestScheduler.js`
- `server.js` (initializes scheduler)
- `pages/api/toggleCMOAutoApproval.js`

### 7. Medicine Disposal & Waste Management
Expired medicines → disposal request → CMO creates disposal batch → route optimized → warehouse completes.

### 8. Alternative Medicines
When exact medicine unavailable, suggest generics. **IMPORTANT:** Original request items in `pharmacy_emergency_request_items` are NEVER modified — alternatives are UI-only and tracked in `pharmacy_sales_history`.

---

## Database Schema (Live — 18 tables)

### User / Account Tables

**`cmo`**
| Column | Type | Notes |
|---|---|---|
| cmo_id | int PK AI | |
| name | varchar(100) | |
| email | varchar(100) UNIQUE | |
| e_mail | varchar(255) | duplicate email field (legacy) |
| password | varchar(255) | bcrypt |
| contact_number | varchar(15) | |
| district, block | varchar(50) | |
| address | text | |
| auto_approval_enabled | tinyint(1) | default 0 — AI scheduler toggle |
| created_at | timestamp | |

**`pharmacy`**
| Column | Type | Notes |
|---|---|---|
| pharmacy_id | int PK AI | |
| pharmacy_name | varchar(100) | |
| username | varchar(50) UNIQUE | |
| Email | varchar(255) | |
| password | varchar(255) | bcrypt |
| contact_number | varchar(15) | |
| district, block | varchar(50) | |
| address | text | |
| auto_order_enabled | tinyint(1) | default 0 |
| created_at | timestamp | |

**`doctor`**
| Column | Type | Notes |
|---|---|---|
| doctor_id | int PK AI | |
| username | varchar(100) UNIQUE | |
| password | varchar(100) | bcrypt |
| contact_number | varchar(15) | |
| district, block | varchar(100) | |
| address | varchar(255) | |
| pharmacy_id | int FK | linked to a pharmacy |

**`warehouse`**
| Column | Type | Notes |
|---|---|---|
| warehouse_id | int PK AI | |
| name | varchar(255) | |
| email / e_mail | varchar(255) | two email columns (legacy) |
| password | varchar(255) | bcrypt |
| contact_number | varchar(20) | |
| district, block | varchar(100) | |
| address | text | |
| created_at | datetime | |

**`opd_patients`**
| Column | Type | Notes |
|---|---|---|
| opd_id | int PK AI | |
| opd_number | varchar(20) UNIQUE | used as login identifier |
| patient_name | varchar(100) | |
| age | int | |
| gender | varchar(10) | |
| password | varchar(255) | bcrypt |
| created_at | timestamp | |

---

### Medicine Catalog

**`generic_medicines`**
| Column | Type | Notes |
|---|---|---|
| generic_id | int PK AI | |
| generic_name | varchar(100) | e.g. "Paracetamol" |
| category | varchar(100) | e.g. "Analgesic" |

**`medicines`**
| Column | Type | Notes |
|---|---|---|
| medicine_id | int PK AI | |
| name | varchar(100) | brand/specific name |
| dosage | varchar(50) | |
| unit | varchar(50) | e.g. "mg", "ml" |
| manufacturer | varchar(100) | |
| description | text | |
| generic_id | int FK → generic_medicines | nullable |

---

### Inventory

**`stock`**
| Column | Type | Notes |
|---|---|---|
| stock_id | int PK AI | |
| pharmacy_id | int FK → pharmacy | nullable (warehouse stock if null?) |
| warehouse_id | int | nullable |
| medicine_id | int FK → medicines | |
| batch_number | varchar(50) | |
| quantity | decimal(10,2) | |
| price_per_unit | decimal(10,2) | |
| expiry_date | date | |

---

### Emergency Requests

**`pharmacy_emergency_requests`**
| Column | Type | Notes |
|---|---|---|
| request_id | int PK AI | |
| pharmacy_id | int FK → pharmacy | requesting pharmacy |
| accepting_pharmacy_id | int | set after CMO approval |
| accepting_warehouse_id | int | |
| status | enum | `pending_approval_from_cmo`, `order_sent`, `order_successful`, `order_recieved`, `rejected` |
| remarks | text | |
| decision_reason | varchar(500) | CMO reasoning |
| request_date | timestamp | |
| blockchain_timestamp | int | |
| blockchain_txhash | varchar(66) | |
| last_verified_timestamp | int | |

**`pharmacy_emergency_request_items`** ← **IMMUTABLE after creation**
| Column | Type | Notes |
|---|---|---|
| request_item_id | int PK AI | |
| request_id | int FK | |
| medicine_id | int FK → medicines | nullable (if generic used) |
| generic_id | int FK → generic_medicines | nullable |
| quantity_requested | int | |

---

### Demand Requests

**`pharmacy_demand_request`**
| Column | Type | Notes |
|---|---|---|
| request_id | int PK AI | |
| pharmacy_id | int FK → pharmacy | |
| accepting_warehouse_id | int | |
| status | enum | `pending`, `approved`, `order_successful`, `order_recieved`, `rejected` |
| remarks | varchar(255) | |
| decision_reason | varchar(500) | |
| comments_from_approver | varchar(255) | |
| request_date | datetime | |

**`pharmacy_demand_request_items`**
| Column | Type | Notes |
|---|---|---|
| request_item_id | int PK AI | |
| request_id | int FK | |
| medicine_id | int FK → medicines | |
| generic_id | int FK | nullable |
| quantity_requested | decimal(10,2) | |

---

### Prescriptions

**`opd_prescriptions`**
| Column | Type | Notes |
|---|---|---|
| prescription_id | int PK AI | |
| opd_number | varchar(20) FK → opd_patients | |
| doctor_id | int FK → doctor | |
| pharmacy_id | int FK → pharmacy | null until served |
| diagnosis | varchar(255) | |
| NAC | tinyint(1) | 1 = Not Available Certificate issued |
| created_at | timestamp | |
| blockchain_timestamp | bigint | |
| blockchain_txhash | varchar(255) | |
| blockchain_action | varchar(50) | |

**`opd_prescription_medicines`**
| Column | Type | Notes |
|---|---|---|
| id | int PK AI | |
| prescription_id | int FK | |
| medicine_id | int FK → medicines | |
| frequency | varchar(100) | e.g. "morning, night" |
| times_per_day | int | |
| duration_days | int | |
| quantity | int | |
| instructions | text | |

---

### Sales History

**`pharmacy_sales_history`**
| Column | Type | Notes |
|---|---|---|
| id | int PK AI | |
| pharmacy_id | int FK → pharmacy | |
| medicine_id | int FK → medicines | |
| quantity_sold | decimal(10,2) | |
| transaction_date | date | |
| sale_type | enum | `customer`, `emergency` |
| created_at | timestamp | |

---

### Disposal / Waste Management

**`pharmacy_disposal_request`**
| Column | Type | Notes |
|---|---|---|
| request_id | int PK AI | |
| pharmacy_id | int | |
| batch_id | int FK → disposal_batch | nullable |
| status | varchar(50) | default `pending` |
| disposal_token | varchar(10) | |
| evidence_img | varchar(255) | |
| remarks | varchar(255) | |
| request_date | datetime | |

**`disposal_batch`**
| Column | Type | Notes |
|---|---|---|
| batch_id | int PK AI | |
| warehouse_id | int | default 1 |
| status | varchar(50) | indexed, default `pending` |
| optimized_route | json | Leaflet map route data |
| created_date | datetime | |

**`disposal_stock_items`**
| Column | Type | Notes |
|---|---|---|
| item_id | int PK AI | |
| stock_id | int FK → stock | |
| request_id | int FK → pharmacy_disposal_request | |

---

Full schema also in `major.sql`.

---

## Directory Structure

```
pages/
  api/              # ~83 API endpoints (direct SQL, no ORM)
  index.js          # Landing page, role-based login/signup
  admin.js          # CMO dashboard
  user.js           # Pharmacy dashboard
  doctor.js         # Doctor interface
  patient.js        # Patient view
  warehouse.js      # Warehouse dashboard
  [other pages]

middleware/
  dbConfig.js       # MySQL connection (Aiven Cloud)
  demandForecast.py # Python ML demand forecasting

blockchain/
  contracts/        # Solidity smart contracts
  utils/            # ethers.js helpers
  scripts/          # Deployment scripts
  deployment-info.json

lib/
  emergencyRequestScheduler.js  # AI auto-approval logic

server.js           # Custom Node.js server (starts scheduler)
major.sql           # Full database schema
hardhat.config.js   # Hardhat config
```

---

## Running the App

```bash
# Development (no scheduler)
npm run dev         # http://localhost:3002

# Development (with AI scheduler)
npm run dev:with-scheduler

# Production
npm run build && npm start
```

### Blockchain Setup (Local)
```bash
ganache --wallet.totalAccounts 10 --wallet.defaultBalance 1000
node blockchain/scripts/deploy-ganache.js
# Update .env with deployed contract addresses
```

---

## Environment Variables (.env)

```
# Aiven Cloud MySQL
DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT, DB_SSL_REJECT_UNAUTHORIZED

# Twilio SMS
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

# Ganache Blockchain
REQUEST_CONTRACT_ADDRESS
PRESCRIPTION_CONTRACT_ADDRESS
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
BLOCKCHAIN_PRIVATE_KEY

# Groq AI (for scheduler)
GROQ_API_KEY
```

---

## Important Design Decisions & Rules

1. **No ORM** — All DB queries are raw SQL via mysql2 promise API
2. **No server-side auth middleware** — JWT is checked client-side per page
3. **Blockchain is non-blocking** — App works even if Ganache is down
4. **Request items are immutable** — `pharmacy_emergency_request_items` rows never change after creation
5. **Alternatives only in UI** — Actual substitutions tracked in `pharmacy_sales_history`
6. **DB patterns** — `dbConfig.js` exports a pool; use `pool.execute(sql, params)` for queries

---

## Known Issues / Notes

- `auto_approval_enabled` column in `cmo` table may not be in base `major.sql` — add it manually
- No CORS config; no server-side route protection
- JWT stored in localStorage (XSS risk)
- Blockchain ready for Sepolia testnet migration (currently Ganache only)
- Some schema inconsistencies around `generic_id` in medicines table

---

## Documentation Files in Repo

- `BLOCKCHAIN_INTEGRATION_STATUS.md`
- `BLOCKCHAIN_VERIFICATION_QUICKSTART.md`
- `BLOCKCHAIN_VERIFICATION_SYSTEM.md`
- `CMO_PREFERENCE_INTEGRATION.md`
- `ALTERNATIVE_MEDICINES_DB_CHANGES.md`
- `EXECUTION_GUIDE.md`
- `SCHEDULER_SETUP.md`
- `TAMPERING_DETECTION_REVIEW.md`
- `PRESCRIPTION_BLOCKCHAIN_STATUS.md`
