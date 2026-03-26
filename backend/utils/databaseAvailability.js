const prisma = require('../config/database');
const { logEvent } = require('./logger');
const databasePressureState = globalThis.__SUNWIRE_DATABASE_PRESSURE__ || {
  blockedUntil: 0,
  lastMessage: '',
};

globalThis.__SUNWIRE_DATABASE_PRESSURE__ = databasePressureState;

function cleanText(value = '') {
  return String(value || '').trim();
}

function isDatabasePoolLimitError(error) {
  const message = cleanText(error?.message || '').toLowerCase();
  return message.includes('maxclientsinsessionmode')
    || message.includes('max clients reached')
    || message.includes('pool_size')
    || message.includes('too many clients')
    || message.includes('remaining connection slots are reserved');
}

function markDatabasePressure(error, cooldownMs = 15000) {
  if (!isDatabasePoolLimitError(error)) return false;
  databasePressureState.blockedUntil = Date.now() + cooldownMs;
  databasePressureState.lastMessage = cleanText(error?.message || '');
  logEvent('database.pool_pressure', {
    message: databasePressureState.lastMessage,
    blockedUntil: databasePressureState.blockedUntil,
  });
  return true;
}

function isDatabaseCoolingDown() {
  return Number(databasePressureState.blockedUntil || 0) > Date.now();
}

function getDatabaseBusyMessage() {
  return 'Database is busy right now. Showing cached data where available. Please retry in a few seconds.';
}

function normalizeDatabaseError(error, fallbackMessage = 'Database request failed.') {
  if (markDatabasePressure(error)) {
    const friendlyError = new Error(getDatabaseBusyMessage());
    friendlyError.statusCode = 503;
    friendlyError.code = 'DATABASE_BUSY';
    friendlyError.cause = error;
    return friendlyError;
  }

  const nextError = error instanceof Error ? error : new Error(fallbackMessage);
  if (!nextError.message) nextError.message = fallbackMessage;
  return nextError;
}

function ensureDatabaseConfigured(res) {
  if (process.env.DATABASE_URL) return true;
  res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  return false;
}

async function isDatabaseReachable() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logEvent('database.reachability.error', { message: error.message });
    return false;
  }
}

async function respondIfDatabaseUnavailable(res) {
  if (!ensureDatabaseConfigured(res)) return true;
  if (await isDatabaseReachable()) return false;
  res.status(503).json({ error: 'Database is not reachable.' });
  return true;
}

module.exports = {
  ensureDatabaseConfigured,
  getDatabaseBusyMessage,
  isDatabaseReachable,
  isDatabaseCoolingDown,
  isDatabasePoolLimitError,
  markDatabasePressure,
  normalizeDatabaseError,
  respondIfDatabaseUnavailable,
};
