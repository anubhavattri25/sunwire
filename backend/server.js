require('dotenv').config();

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
const frontendOrigin = process.env.FRONTEND_ORIGIN || '*';
const hasDatabase = Boolean(process.env.DATABASE_URL);

app.use(helmet());
app.use(cors({ origin: frontendOrigin === '*' ? true : frontendOrigin }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    service: 'sunwire-backend',
    timestamp: new Date().toISOString(),
    databaseConfigured: hasDatabase,
  });
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

const server = app.listen(port, async () => {
  logEvent('server.started', { port, databaseConfigured: hasDatabase });
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

app.get("/", (req, res) => {
  res.send("🚀 Sunwire backend is running. Use /api/news");
});

const PORT = process.env.PORT || 4000;
const HOST = "127.0.0.1";


app.listen(PORT, HOST, () => {
  console.log(`🚀 Sunwire backend running at http://${HOST}:${PORT}`);
});
