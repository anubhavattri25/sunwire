const { safeConnectRedis } = require('../config/redis');
const { logEvent } = require('./logger');

const CACHE_PREFIX = 'sunwire';
const MEMORY_CACHE = globalThis.__SUNWIRE_MEMORY_CACHE__ || new Map();

globalThis.__SUNWIRE_MEMORY_CACHE__ = MEMORY_CACHE;

function buildCacheKey(...parts) {
  return [CACHE_PREFIX, ...parts].join(':');
}

function getMemoryEntry(key = '') {
  const entry = MEMORY_CACHE.get(key);
  if (!entry) return null;
  if (Number(entry.expiresAt || 0) <= Date.now()) {
    MEMORY_CACHE.delete(key);
    return null;
  }
  return entry;
}

function setMemoryEntry(key = '', payload = null, ttlSeconds = 120) {
  if (!key) return;
  MEMORY_CACHE.set(key, {
    payload,
    expiresAt: Date.now() + (Math.max(1, Number(ttlSeconds) || 120) * 1000),
  });
}

async function getCachedJson(key) {
  const memoryEntry = getMemoryEntry(key);
  if (memoryEntry) return memoryEntry.payload;

  const redis = await safeConnectRedis();
  if (!redis) return null;
  try {
    const value = await redis.get(key);
    if (!value) return null;
    const parsed = JSON.parse(value);
    setMemoryEntry(key, parsed, 60);
    return parsed;
  } catch (error) {
    logEvent('cache.get.error', { key, message: error.message });
    return null;
  }
}

async function setCachedJson(key, payload, ttlSeconds = 120) {
  setMemoryEntry(key, payload, ttlSeconds);

  const redis = await safeConnectRedis();
  if (!redis) return true;
  try {
    await redis.set(key, JSON.stringify(payload), 'EX', ttlSeconds);
    logEvent('cache.set', { key, ttlSeconds });
    return true;
  } catch (error) {
    logEvent('cache.set.error', { key, message: error.message });
    return false;
  }
}

async function invalidateCache(pattern = `${CACHE_PREFIX}:*`) {
  const redis = await safeConnectRedis();
  let deleted = 0;

  [...MEMORY_CACHE.keys()].forEach((key) => {
    if (pattern === `${CACHE_PREFIX}:*` || key.startsWith(pattern.replace(/\*+$/g, ''))) {
      MEMORY_CACHE.delete(key);
      deleted += 1;
    }
  });

  if (!redis) return deleted;

  let cursor = '0';
  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length) {
        deleted += await redis.del(...keys);
      }
    } while (cursor !== '0');

    logEvent('cache.invalidate', { pattern, deleted });
    return deleted;
  } catch (error) {
    logEvent('cache.invalidate.error', { pattern, message: error.message });
    return deleted;
  }
}

module.exports = {
  buildCacheKey,
  getCachedJson,
  setCachedJson,
  invalidateCache,
};
