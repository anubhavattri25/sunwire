const { PrismaClient } = require('@prisma/client');

function getDatabaseUrl() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return undefined;

  try {
    const parsedUrl = new URL(rawUrl);

    if (parsedUrl.hostname.includes('pooler.supabase.com') && !parsedUrl.searchParams.has('connection_limit')) {
      parsedUrl.searchParams.set('connection_limit', '1');
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
