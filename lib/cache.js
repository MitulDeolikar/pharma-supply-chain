const Redis = require('ioredis');

// ─── Redis Connection ─────────────────────────────────────────────────────────
// Falls back gracefully if Redis is not running — app continues using MySQL directly.

let redis = null;

try {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: (times) => (times > 3 ? null : 500), // stop retrying after 3 attempts
  });

  redis.on('error', (err) => {
    // Suppress noisy connection errors after initial failure
    if (err.code !== 'ECONNREFUSED') {
      console.warn('[Cache] Redis error:', err.message);
    }
  });

  redis.on('connect', () => console.log('[Cache] Redis connected'));
} catch (err) {
  console.warn('[Cache] Redis init failed — caching disabled:', err.message);
  redis = null;
}

// ─── getOrSet ─────────────────────────────────────────────────────────────────
// Tries to read from Redis first. On miss, calls fetchFn(), stores result, returns it.
// If Redis is down, calls fetchFn() directly — zero impact on functionality.

async function getOrSet(key, ttlSeconds, fetchFn) {
  if (!redis) return fetchFn();

  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached);
    }
  } catch (e) {
    // Cache read failed — fall through to DB
  }

  const data = await fetchFn();

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (e) {
    // Cache write failed — data is still returned correctly
  }

  return data;
}

// ─── invalidate ───────────────────────────────────────────────────────────────
// Deletes one or more exact cache keys. Call after any write mutation.
// Fire-and-forget — never throws or blocks the caller.

async function invalidate(...keys) {
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys.filter(Boolean));
  } catch (e) {
    // Silently ignore — stale cache will expire on its own
  }
}

// ─── invalidatePattern ────────────────────────────────────────────────────────
// Deletes all keys matching a glob pattern (e.g. 'analytics:cmo:*').
// Uses SCAN to avoid blocking Redis with KEYS.

async function invalidatePattern(pattern) {
  if (!redis) return;
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } catch (e) {
    // Silently ignore
  }
}

// ─── publish ──────────────────────────────────────────────────────────────────
// Publishes an event to a Redis Pub/Sub channel.
// Fire-and-forget — never throws or blocks the caller.
// Used by API write endpoints to notify server.js subscriber → SSE clients.

async function publish(channel, event) {
  if (!redis) return;
  try {
    await redis.publish(channel, JSON.stringify(event));
  } catch (e) {
    // Silently ignore — real-time notification is best-effort
  }
}

module.exports = { getOrSet, invalidate, invalidatePattern, publish };
