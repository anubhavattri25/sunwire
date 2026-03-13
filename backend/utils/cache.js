const { safeConnectRedis } = require('../config/redis');
const { logEvent } = require('./logger');

const CACHE_PREFIX = 'sunwire';

function buildCacheKey(...parts) {
  return [CACHE_PREFIX, ...parts].join(':');
}

async function getCachedJson(key) {
  const redis = await safeConnectRedis();
  if (!redis) return null;
  try {
    const value = await redis.get(key);
    if (!value) return null;
    return JSON.parse(value);
  } catch (error) {
    logEvent('cache.get.error', { key, message: error.message });
    return null;
  }
}

async function setCachedJson(key, payload, ttlSeconds = 120) {
  const redis = await safeConnectRedis();
  if (!redis) return false;
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
  if (!redis) return 0;

  let cursor = '0';
  let deleted = 0;
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
