/**
 * T58: Redis Cache Layer
 *
 * Singleton Redis client with:
 *   - Connection management (lazy connect, retry, fallback)
 *   - Generic get/set/delete helpers with TTL
 *   - Cache-aside pattern helpers
 *
 * Gracefully degrades when Redis is unavailable.
 */

const Redis = require('ioredis');
const crypto = require('crypto');

/** @type {import('ioredis')|null} */
let client = null;
let enabled = false;

const DEFAULT_TTL_SECONDS = 300; // 5 min

/**
 * Create and connect the Redis client from env config.
 * Returns the client or null if not configured.
 */
function createClient(redisUrl) {
  if (!redisUrl) {
    enabled = false;
    return null;
  }

  try {
    const c = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null; // give up
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
      enableOfflineQueue: false,
      showFriendlyErrorStack: false
    });

    c.on('error', (err) => {
      // Log but don't crash — cache degrades gracefully
      process.nextTick(() => {
        const { logger } = require('../utils/logger');
        if (logger) logger.warn(`[cache] Redis error: ${err.message}`);
      });
    });

    c.on('connect', () => {
      const { logger } = require('../utils/logger');
      if (logger) logger.info('[cache] Redis connected');
    });

    return c;
  } catch (err) {
    const { logger } = require('../utils/logger');
    if (logger) logger.warn(`[cache] Failed to create Redis client: ${err.message}`);
    return null;
  }
}

/**
 * Initialize the cache layer.
 * Called once at startup. Safe to call multiple times.
 */
async function init(redisUrl) {
  if (client) return;
  client = createClient(redisUrl);
  if (client) {
    try {
      await client.connect();
      enabled = true;
    } catch {
      enabled = false;
      client = null;
    }
  }
}

/**
 * Close the Redis connection.
 */
async function close() {
  if (client) {
    try { await client.quit(); } catch { /* ok */ }
    client = null;
    enabled = false;
  }
}

/**
 * Check if the cache is active.
 */
function isEnabled() {
  return enabled && client !== null && client.status === 'ready';
}

/**
 * Get the default TTL from config, falling back to the hardcoded default.
 */
function getDefaultTTL() {
  try {
    const { getConfig } = require('../config/index.js');
    const ttl = getConfig().ORCA_REDIS_TTL;
    return ttl ? parseInt(ttl, 10) || DEFAULT_TTL_SECONDS : DEFAULT_TTL_SECONDS;
  } catch {
    return DEFAULT_TTL_SECONDS;
  }
}

// ---- Key helpers ----

function buildKey(namespace, id) {
  return `orca:${namespace}:${id}`;
}

function hashKey(namespace, parts) {
  const h = crypto.createHash('md5').update(JSON.stringify(parts)).digest('hex');
  return `orca:${namespace}:${h}`;
}

// ---- Core operations ----

/**
 * Get a cached value.
 * @param {string} key - Full cache key
 * @returns {Promise<*>} Parsed value or null
 */
async function get(key) {
  if (!isEnabled()) return null;
  try {
    const raw = await client.get(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Set a cached value with TTL.
 * @param {string} key - Full cache key
 * @param {*} value - Any JSON-serializable value
 * @param {number} [ttlSeconds] - Time to live in seconds (defaults to env ORCA_REDIS_TTL or 300)
 */
async function set(key, value, ttlSeconds) {
  if (!isEnabled()) return;
  const ttl = ttlSeconds != null ? ttlSeconds : getDefaultTTL();
  try {
    const raw = JSON.stringify(value);
    if (ttlSeconds > 0) {
      await client.setex(key, ttlSeconds, raw);
    } else {
      await client.set(key, raw);
    }
  } catch { /* fail silently */ }
}

/**
 * Delete a cached key.
 * @param {string} key
 */
async function del(key) {
  if (!isEnabled()) return;
  try { await client.del(key); } catch { /* ok */ }
}

/**
 * Delete keys matching a pattern.
 * @param {string} pattern - e.g. "orca:session:*"
 */
async function delPattern(pattern) {
  if (!isEnabled()) return;
  try {
    const stream = client.scanStream({ match: pattern, count: 100 });
    for await (const keys of stream) {
      if (keys.length > 0) await client.del(...keys);
    }
  } catch { /* ok */ }
}

// ---- Cache-aside pattern ----

/**
 * Cache-aside: try cache then fallback, write-through.
 * @param {string} namespace
 * @param {string} id
 * @param {Function} fallback - Async function to load data on miss
 * @param {number} [ttlSeconds] - Override TTL; defaults to ORCA_REDIS_TTL or 300
 * @returns {Promise<*>}
 */
async function remember(namespace, id, fallback, ttlSeconds) {
  const key = buildKey(namespace, id);
  const cached = await get(key);
  if (cached !== null) return cached;

  const value = await fallback();
  if (value !== null && value !== undefined) {
    await set(key, value, ttlSeconds);
  }
  return value;
}

/**
 * Cache-aside with hashed composite key (for query-based caches).
 * @param {string} namespace
 * @param {Array} keyParts
 * @param {Function} fallback
 * @param {number} [ttlSeconds]
 * @returns {Promise<*>}
 */
async function rememberQuery(namespace, keyParts, fallback, ttlSeconds) {
  const key = hashKey(namespace, keyParts);
  const cached = await get(key);
  if (cached !== null) return cached;

  const value = await fallback();
  if (value !== null && value !== undefined) {
    await set(key, value, ttlSeconds);
  }
  return value;
}

module.exports = {
  init,
  close,
  isEnabled,
  get,
  set,
  del,
  delPattern,
  remember,
  rememberQuery,
  buildKey,
  hashKey,
  getDefaultTTL,
  DEFAULT_TTL_SECONDS
};
