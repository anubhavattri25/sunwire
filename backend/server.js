require('dotenv').config();

const zlib = require('node:zlib');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const prisma = require('./config/database');
const { getRedis } = require('./config/redis');
const newsRoutes = require('./routes/newsRoutes');
const trendingRoutes = require('./routes/trendingRoutes');
const breakingRoutes = require('./routes/breakingRoutes');
const { ingestNewsSources } = require('./services/newsIngestor');
const { processPendingArticles } = require('./services/articleProcessor');
const { updateTrendingScores } = require('./services/trendingCalculator');
const { startFetchNewsJob } = require('./jobs/fetchNewsJob');
const { startProcessArticlesJob } = require('./jobs/processArticlesJob');
const { startUpdateTrendingJob } = require('./jobs/updateTrendingJob');
const { logEvent } = require('./utils/logger');

const app = express();
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '127.0.0.1';
const frontendOrigin = process.env.FRONTEND_ORIGIN || '*';
const hasDatabase = Boolean(process.env.DATABASE_URL);

function canCompress(req, res) {
  if (req.method === 'HEAD') return false;
  if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return false;
  if (res.getHeader('Content-Encoding')) return false;

  const contentType = String(res.getHeader('Content-Type') || '');
  return /json|text\/|javascript|svg|xml/i.test(contentType);
}

function gzipMiddleware(req, res, next) {
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  let gzip;

  function ensureGzip() {
    if (gzip) return gzip;
    if (!canCompress(req, res)) return null;

    gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.removeHeader('Content-Length');

    gzip.on('data', (chunk) => originalWrite(chunk));
    gzip.on('end', () => originalEnd());

    return gzip;
  }

  res.write = (chunk, encoding, callback) => {
    const stream = ensureGzip();
    if (!stream) return originalWrite(chunk, encoding, callback);
    return stream.write(chunk, encoding, callback);
  };

  res.end = (chunk, encoding, callback) => {
    const stream = ensureGzip();
    if (!stream) return originalEnd(chunk, encoding, callback);
    if (chunk) {
      stream.end(chunk, encoding, callback);
      return true;
    }
    stream.end();
    return true;
  };

  next();
}

app.use(helmet());
app.use(cors({ origin: frontendOrigin === '*' ? true : frontendOrigin }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(gzipMiddleware);

app.get('/healthz', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    service: 'sunwire-backend',
    timestamp: new Date().toISOString(),
    databaseConfigured: hasDatabase,
  });
});

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  res.type('text/plain; charset=utf-8');
  res.send('Sunwire backend is running. Use /api/news');
});

app.use('/api', newsRoutes);
app.use('/api', trendingRoutes);
app.use('/api', breakingRoutes);

app.use((error, req, res, next) => {
  logEvent('http.error', {
    path: req.path,
    method: req.method,
    message: error.message,
  });
  res.status(500).json({ error: 'Internal server error.' });
});

async function warmStart() {
  if (!hasDatabase) {
    logEvent('startup.pipeline.skipped', { reason: 'DATABASE_URL missing' });
    return;
  }

  try {
    await ingestNewsSources();
    await processPendingArticles();
    await updateTrendingScores();
    logEvent('startup.pipeline.complete');
  } catch (error) {
    logEvent('startup.pipeline.error', { message: error.message });
  }
}

const jobs = hasDatabase
  ? [
      startFetchNewsJob(),
      startProcessArticlesJob(),
      startUpdateTrendingJob(),
    ]
  : [];

const server = app.listen(port, host, async () => {
  logEvent('server.started', { port, host, databaseConfigured: hasDatabase });
  await warmStart();
});

async function shutdown(signal) {
  logEvent('server.shutdown', { signal });
  jobs.forEach((job) => job?.stop?.());
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    const redis = getRedis();
    if (redis) {
      await redis.quit().catch(() => {});
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
