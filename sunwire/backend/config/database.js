const { PrismaClient } = require('@prisma/client');

const globalForPrisma = global;

const prisma = globalForPrisma.__sunwirePrisma || new PrismaClient({
  log: ['warn', 'error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__sunwirePrisma = prisma;
}

module.exports = prisma;
