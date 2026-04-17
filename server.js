// This is a custom Next.js server that starts the emergency request scheduler
// and the Redis Pub/Sub → SSE bridge for real-time event delivery.
// Run with: node server.js (instead of npm run dev)

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const PORT = process.env.PORT || 3002;

// ─── Redis Subscriber for SSE Push ──────────────────────────────────────────
// A SEPARATE ioredis connection is required because once subscribe() is called
// the connection enters subscriber mode and can no longer run GET/SET/PUBLISH.
// The cache.js module keeps its own connection for caching + publishing.

let redisSub = null;

function initRedisSubscriber() {
  try {
    const Redis = require('ioredis');
    redisSub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: null, // subscriber needs unlimited retries
      connectTimeout: 3000,
      retryStrategy: (times) => (times > 5 ? 5000 : Math.min(times * 500, 3000)),
    });

    redisSub.on('error', (err) => {
      if (err.code !== 'ECONNREFUSED') {
        console.warn('[SSE] Redis subscriber error:', err.message);
      }
    });

    redisSub.on('connect', () => {
      console.log('[SSE] Redis subscriber connected');
    });

    // Subscribe to the pharma events channel
    redisSub.subscribe('pharma:events', (err) => {
      if (err) {
        console.warn('[SSE] Failed to subscribe to pharma:events:', err.message);
      } else {
        console.log('[SSE] Subscribed to pharma:events channel');
      }
    });

    // On every published message, route it to matching SSE clients
    redisSub.on('message', (channel, message) => {
      if (channel !== 'pharma:events') return;

      let event;
      try {
        event = JSON.parse(message);
      } catch {
        return; // malformed — skip
      }

      const sseClients = require('./lib/sseRegistry');

      for (const [clientId, client] of sseClients) {
        if (shouldSendToClient(event, client)) {
          try {
            client.res.write(`data: ${JSON.stringify(event)}\n\n`);
          } catch {
            // Client disconnected — clean up
            sseClients.delete(clientId);
          }
        }
      }

      // Bonus: trigger immediate scheduler check on new emergency request
      if (event.type === 'emergency:created') {
        triggerImmediateSchedulerCheck();
      }
    });
  } catch (err) {
    console.warn('[SSE] Redis subscriber init failed — real-time events disabled:', err.message);
  }
}

// ─── Event Routing Rules ─────────────────────────────────────────────────────
// Determines which SSE clients should receive a given event based on role
// and entity ID matching.

function shouldSendToClient(event, client) {
  const { role, entityId } = client;
  const t = event.type;

  // CMO receives ALL events — they oversee the entire network
  if (role === 'cmo') return true;

  // Pharmacy events
  if (role === 'pharmacy') {
    // Stock changes for THIS pharmacy
    if ((t === 'stock:added' || t === 'stock:updated' || t === 'stock:removed') &&
        String(event.pharmacy_id) === entityId) return true;

    // Emergency request created by THIS pharmacy
    if (t === 'emergency:created' && String(event.pharmacy_id) === entityId) return true;

    // Emergency request status changes involving THIS pharmacy (requester or acceptor)
    if ((t === 'emergency:approved' || t === 'emergency:rejected' ||
         t === 'emergency:allocated' || t === 'emergency:received') &&
        (String(event.pharmacy_id) === entityId ||
         String(event.accepting_pharmacy_id) === entityId)) return true;

    // Demand request events for THIS pharmacy
    if ((t === 'demand:created' || t === 'demand:responded' ||
         t === 'demand:received') &&
        String(event.pharmacy_id) === entityId) return true;

    // Prescription served by THIS pharmacy
    if (t === 'prescription:served' && String(event.pharmacy_id) === entityId) return true;

    return false;
  }

  // Warehouse events
  if (role === 'warehouse') {
    // Warehouse stock changes
    if ((t === 'stock:added' || t === 'stock:updated' || t === 'stock:removed') &&
        String(event.warehouse_id) === entityId) return true;

    // Orders dispatched from THIS warehouse
    if (t === 'warehouse:dispatched' && String(event.warehouse_id) === entityId) return true;

    // Emergency/demand requests assigned to THIS warehouse
    if ((t === 'emergency:approved' || t === 'demand:responded') &&
        String(event.accepting_warehouse_id) === entityId) return true;

    // Demand receipt confirmations for orders from THIS warehouse
    if ((t === 'demand:received' || t === 'emergency:received') &&
        String(event.accepting_warehouse_id) === entityId) return true;

    return false;
  }

  // Doctor events
  if (role === 'doctor') {
    // Prescription served (doctor sees their prescriptions being fulfilled)
    if (t === 'prescription:served' && String(event.doctor_id) === entityId) return true;
    return false;
  }

  // Patient events
  if (role === 'patient') {
    // Prescription served (patient sees their prescription status)
    if (t === 'prescription:served' && String(event.opd_number) === entityId) return true;
    return false;
  }

  return false;
}

// ─── Bonus: Immediate Scheduler Check ────────────────────────────────────────
// When a new emergency request is created, trigger the scheduler to run
// an immediate check (after a short delay) instead of waiting for the
// next 5-minute cron tick.

let immediateCheckTimeout = null;

function triggerImmediateSchedulerCheck() {
  // Debounce: if multiple requests arrive quickly, only trigger once
  if (immediateCheckTimeout) return;

  immediateCheckTimeout = setTimeout(async () => {
    immediateCheckTimeout = null;
    try {
      // Hit the scheduler init endpoint which will check for pending requests
      const resp = await fetch(`http://localhost:${PORT}/api/scheduler/init`);
      if (resp.ok) {
        console.log('[SSE] Triggered immediate scheduler check after new emergency request');
      }
    } catch (err) {
      // Best-effort — scheduler will pick it up on next cron tick anyway
      console.warn('[SSE] Could not trigger immediate scheduler check:', err.message);
    }
  }, 15000); // 15-second delay — gives CMO time to manually approve first
}

// ─── Start Server ────────────────────────────────────────────────────────────

app.prepare().then(() => {
  console.log('Starting server...');
  console.log('Initialize scheduler via: GET http://localhost:3002/api/scheduler/init');

  // Initialize Redis subscriber for SSE (best-effort — app works without it)
  initRedisSubscriber();

  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(PORT, (err) => {
    if (err) throw err;
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
