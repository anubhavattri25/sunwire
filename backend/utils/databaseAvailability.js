const prisma = require('../config/database');
const { logEvent } = require('./logger');

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
  isDatabaseReachable,
  respondIfDatabaseUnavailable,
};
