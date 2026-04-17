# Event-Driven Architecture (EDA) Implementation

## Overview

This document describes the real-time event delivery system implemented using **Redis Pub/Sub** and **Server-Sent Events (SSE)**. When any write operation occurs (new request, stock change, prescription served, etc.), the API endpoint publishes an event to Redis. The custom Node.js server (`server.js`) subscribes to that Redis channel and pushes the event to all connected browser clients via SSE, where each dashboard automatically refetches relevant data.

---

## Architecture Diagram

```
Browser (Dashboard)          Next.js API Route           Redis           server.js
─────────────────           ──────────────────          ─────           ──────────
                                                                        
useSSE hook ◄──── SSE ◄─────────────────────────────────────────── subscriber
(EventSource)     stream                                               │
     │                       POST /api/createEmergencyRequest          │
     │                            │                                    │
     │                            ├── DB write (MySQL)                 │
     │                            ├── invalidate() (cache)             │
     │                            └── publish('pharma:events', {...})──┘
     │                                      │
     │                                      └── Redis PUBLISH
     │
     └── onEvent callback
           └── refetch data / show toast
```

---

## Files Created

| File | Purpose |
|---|---|
| `lib/sseRegistry.js` | Singleton `Map` of connected SSE clients, attached to `global` to survive Next.js hot reloads |
| `pages/api/sse.js` | SSE endpoint — keeps HTTP connections open, sends heartbeats every 30s, registers/unregisters clients |
| `hooks/useSSE.js` | React hook — connects to `/api/sse`, parses events, calls `onEvent` callback. Safe under React 18 Strict Mode |

## Files Modified

### Infrastructure

| File | Change |
|---|---|
| `lib/cache.js` | Added `publish(channel, event)` function — fire-and-forget Redis PUBLISH on the same ioredis connection used for caching |
| `server.js` | Added Redis subscriber (separate ioredis connection), SSE routing logic (`shouldSendToClient`), and bonus immediate scheduler trigger on `emergency:created` |

### API Endpoints — 16 Write Endpoints (publish calls added)

Each endpoint now calls `publish('pharma:events', { type, ...payload })` after its existing `invalidate()` call. The publish is fire-and-forget — if Redis is down, the API response is unaffected.

| File | Event Type | Payload Fields |
|---|---|---|
| `pages/api/createEmergencyRequest.js` | `emergency:created` | `request_id, pharmacy_id, pharmacy_name` |
| `pages/api/sendOrderToPharmacy.js` | `emergency:approved` | `request_id, pharmacy_id, accepting_pharmacy_id, accepting_warehouse_id` |
| `pages/api/rejectEmergencyRequest.js` | `emergency:rejected` | `request_id, pharmacy_id, action` |
| `pages/api/allocateEmergencyOrderStocks.js` | `emergency:allocated` | `request_id, pharmacy_id (requester), accepting_pharmacy_id, accepting_warehouse_id` |
| `pages/api/confirmOrderReceipt.js` | `emergency:received` | `request_id, pharmacy_id, accepting_pharmacy_id, accepting_warehouse_id` |
| `pages/api/createDemandRequest.js` | `demand:created` | `request_id, pharmacy_id` |
| `pages/api/respondToDemandRequest.js` | `demand:responded` | `request_id, pharmacy_id, action` |
| `pages/api/confirmDemandOrderReceipt.js` | `demand:received` | `request_id, pharmacy_id, accepting_warehouse_id` |
| `pages/api/allocateAndDispatchWarehouseOrders.js` | `warehouse:dispatched` | `warehouse_id, dispatched_count` |
| `pages/api/allocatePrescriptionStocks.js` | `prescription:served` | `prescription_id, pharmacy_id, doctor_id, opd_number` |
| `pages/api/addStock.js` | `stock:added` | `pharmacy_id` or `warehouse_id`, `medicine_id` |
| `pages/api/editStock.js` | `stock:updated` | `pharmacy_id, stock_id` |
| `pages/api/removeStock.js` | `stock:removed` | `pharmacy_id, stock_id` |
| `pages/api/toggleCMOAutoApproval.js` | `cmo:auto_approval_toggled` | `cmo_id, auto_approval_enabled` |
| `pages/api/updateAutoOrderSetting.js` | `pharmacy:auto_order_toggled` | `pharmacy_id, auto_order_enabled` |
| `pages/api/user_registration.js` | `pharmacy:registered` | `pharmacy_name` |

### Dashboard Pages — 5 Pages (useSSE hook added)

| File | Role | ID Source | Events Handled |
|---|---|---|---|
| `pages/admin.js` | `cmo` | `router.query.cmo_id` | ALL events (CMO oversees entire network) — refetches emergency + demand requests |
| `pages/user.js` | `pharmacy` | `router.query.pharmacy_id` | `stock:*`, `emergency:*`, `demand:*`, `prescription:served` — triggers stock refetch via `stockRefreshTrigger` counter |
| `pages/warehouse.js` | `warehouse` | `router.query.warehouse_id` | `stock:*`, `warehouse:dispatched`, `emergency:*`, `demand:*` — refetches warehouse stock + request lists |
| `pages/doctor.js` | `doctor` | `router.query.doctor_id` | `prescription:served` — refetches prescription list |
| `pages/patient.js` | `patient` | `router.query.opd_number` | `prescription:served` — refetches patient prescriptions via `refreshTrigger` counter |

---

## Event Routing Rules (server.js → `shouldSendToClient`)

The server routes events to SSE clients based on their role and entity ID:

| Role | Receives Events When... |
|---|---|
| **CMO** | Always — receives ALL events |
| **Pharmacy** | Event involves their `pharmacy_id` (as requester, acceptor, or stock owner) |
| **Warehouse** | Event involves their `warehouse_id` (stock changes, dispatches, assigned requests) |
| **Doctor** | `prescription:served` where `doctor_id` matches |
| **Patient** | `prescription:served` where `opd_number` matches |

---

## Bonus: Immediate Scheduler Trigger

When a new emergency request is created (`emergency:created` event), `server.js` triggers an immediate auto-approval scheduler check after a 15-second delay (debounced). This means:

- Instead of waiting up to 5 minutes for the next cron tick, the scheduler runs almost immediately
- The 15-second delay gives the CMO time to manually approve first
- Multiple rapid requests are debounced into a single check
- Falls back gracefully — if the trigger fails, the normal 5-minute cron still runs

---

## Graceful Degradation

The entire EDA system is **non-blocking and optional**:

| Component | If Redis is down... |
|---|---|
| `publish()` in API routes | Silently no-ops, API response unaffected |
| Redis subscriber in `server.js` | Logs warning, retries with backoff, SSE clients stay connected but receive no events |
| SSE endpoint (`/api/sse`) | Works independently of Redis — heartbeats continue |
| `useSSE` hook | EventSource auto-reconnects on transient errors |
| Dashboard pages | Work exactly as before — data loaded via normal fetch on page load |

---

## How to Test

1. **Start Redis**: `redis-server` (or use Docker: `docker run -p 6379:6379 redis`)
2. **Start the app with custom server**: `node server.js` (NOT `npm run dev` — dev mode won't run the subscriber)
3. **Open two browser tabs**: e.g., CMO dashboard and Pharmacy dashboard
4. **Perform a write action**: Create an emergency request from the pharmacy
5. **Observe**: The CMO dashboard should show a toast notification and automatically refetch the request list

---

## Event Flow Example

1. Pharmacy creates emergency request → `POST /api/createEmergencyRequest`
2. API route: inserts into MySQL, calls `invalidate('emergency_requests:all')`, calls `publish('pharma:events', { type: 'emergency:created', ... })`
3. `lib/cache.js` → `redis.publish('pharma:events', JSON.stringify(event))`
4. `server.js` Redis subscriber receives the message on `pharma:events` channel
5. `server.js` iterates `sseClients` Map, calls `shouldSendToClient()` for each
6. CMO client matches (CMO receives ALL events) → `res.write(data: {...})`
7. Requesting pharmacy client matches (pharmacy_id matches) → `res.write(data: {...})`
8. Browser `EventSource.onmessage` fires → `useSSE` hook parses JSON → calls `onEvent` callback
9. Dashboard `handleSSEEvent` → refetches data + shows toast notification
10. **Bonus**: `server.js` sees `emergency:created` → triggers immediate scheduler check after 15s
