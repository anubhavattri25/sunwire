const Redis = require('ioredis');
const { logEvent } = require('../utils/logger');

let redis;

function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    return null;
  }

  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    redis.on('error', (error) => {
      logEvent('redis.error', { message: error.message });
    });
    return redis;
  } catch (error) {
    logEvent('redis.config.error', { message: error.message });
    return null;
  }
}

async function safeConnectRedis() {
  const client = getRedis();
  if (!client) return null;
  if (client.status === 'ready' || client.status === 'connecting') return client;
  try {
    await client.connect();
  } catch (error) {
    logEvent('redis.connect.error', { message: error.message });
    return null;
  }
  return client;
}

module.exports = {
  getRedis,
  safeConnectRedis,
};
