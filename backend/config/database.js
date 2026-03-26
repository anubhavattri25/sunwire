const path = require('node:path');

function loadPrismaClient() {
  const rootClientPath = path.join(__dirname, '..', '..', 'node_modules', '@prisma', 'client');

  try {
    return require(rootClientPath);
  } catch (_) {
    return require('@prisma/client');
  }
}

const { PrismaClient } = loadPrismaClient();

function getDatabaseUrl() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return undefined;

  try {
    const parsedUrl = new URL(rawUrl);

    if (parsedUrl.hostname.includes('pooler.supabase.com')) {
      // Supabase session-mode pooler on 5432 exhausts quickly on serverless.
      // Force the transaction-mode pooler port for Prisma runtime traffic.
      if (!parsedUrl.port || parsedUrl.port === '5432') {
        parsedUrl.port = '6543';
      }
      if (!parsedUrl.searchParams.has('connection_limit')) {
        parsedUrl.searchParams.set('connection_limit', '1');
      }
      if (!parsedUrl.searchParams.has('pgbouncer')) {
        parsedUrl.searchParams.set('pgbouncer', 'true');
      }
      if (!parsedUrl.searchParams.has('pool_timeout')) {
        parsedUrl.searchParams.set('pool_timeout', '10');
      }
    }

    return parsedUrl.toString();
  } catch (_) {
    return rawUrl;
  }
}

const globalForPrisma = globalThis;
const databaseUrl = getDatabaseUrl();

const prisma = globalForPrisma.__sunwirePrisma || new PrismaClient({
  log: ['warn', 'error'],
  ...(databaseUrl ? {
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  } : {}),
});

globalForPrisma.__sunwirePrisma = prisma;

module.exports = prisma;
