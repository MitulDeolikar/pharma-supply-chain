// ─── SSE Client Registry ──────────────────────────────────────────────────────
// Singleton Map of connected Server-Sent Event clients.
// Attached to `global` so Next.js hot reloads in dev mode don't wipe it.
//
// Each entry: clientId → { res, role, entityId }
//   res      — the HTTP response object (kept open for SSE streaming)
//   role     — 'cmo' | 'pharmacy' | 'warehouse' | 'doctor' | 'patient'
//   entityId — string ID of the logged-in entity (pharmacy_id, cmo_id, etc.)

if (!global._sseClients) {
  global._sseClients = new Map();
}

module.exports = global._sseClients;
