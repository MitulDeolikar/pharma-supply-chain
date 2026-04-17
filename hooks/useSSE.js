import { useEffect, useRef } from 'react';

/**
 * useSSE — React hook that connects to the /api/sse endpoint and
 * invokes `onEvent` whenever a relevant server event arrives.
 *
 * @param {Object}   opts
 * @param {string}   opts.role     - 'cmo' | 'pharmacy' | 'warehouse' | 'doctor' | 'patient'
 * @param {string}   opts.id       - entity ID (pharmacy_id, cmo_id, etc.)
 * @param {Function} opts.onEvent  - callback receiving the parsed event object
 *
 * The hook is safe under React 18 Strict Mode (double-mount):
 *   mount → cleanup (close) → remount → new EventSource
 * Only reconnects when role or id actually change.
 */
export default function useSSE({ role, id, onEvent }) {
  // Store onEvent in a ref so the EventSource listener always calls
  // the latest version without re-opening the connection on every render.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    // Don't connect until we have both role and id
    if (!role || !id) return;

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
    const url = `${API_BASE}/api/sse?role=${encodeURIComponent(role)}&id=${encodeURIComponent(id)}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        // Ignore internal control messages
        if (event.type === 'heartbeat' || event.type === 'connected') return;
        onEventRef.current(event);
      } catch {
        // Malformed message — ignore
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects on transient errors.
      // Nothing to do here — the browser handles retry.
    };

    // Cleanup: close connection when role/id change or component unmounts
    return () => {
      es.close();
    };
  }, [role, id]);
}
