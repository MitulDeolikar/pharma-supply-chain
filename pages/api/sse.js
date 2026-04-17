// ─── Server-Sent Events Endpoint ──────────────────────────────────────────────
// GET /api/sse?role=pharmacy&id=5
//
// Keeps the HTTP connection open and streams events to the browser.
// The Redis subscriber in server.js pushes events into this registry.

const sseClients = require('../../lib/sseRegistry');

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { role, id } = req.query;
  if (!role) {
    return res.status(400).json({ success: false, message: 'role query param is required' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable buffering behind nginx
  res.flushHeaders();

  // Register this client
  const clientId = `${role}_${id || 'unknown'}_${Date.now()}`;
  sseClients.set(clientId, {
    res,
    role: role,
    entityId: id ? String(id) : null,
  });

  // Send initial connection confirmation
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

  // Heartbeat every 30s to keep the connection alive through proxies/load balancers
  const heartbeat = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
    } catch (e) {
      clearInterval(heartbeat);
      sseClients.delete(clientId);
    }
  }, 30000);

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientId);
  });
}

// Disable body parsing — this is a streaming endpoint
export const config = {
  api: { bodyParser: false },
};
