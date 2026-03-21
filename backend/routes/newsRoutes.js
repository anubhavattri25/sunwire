const express = require('express');
const prisma = require('../config/database');
const { articleSelect, toApiArticle } = require('../models/Article');
const { buildCacheKey, getCachedJson, setCachedJson, invalidateCache } = require('../utils/cache');
const { getStatusCounts, pipelineState } = require('../services/newsIngestor');
const { getLocalAiConfig, isLocalAiRewriteEnabled } = require('../services/localAiRewrite');
const { safeConnectRedis } = require('../config/redis');
const {
  ensureDatabaseConfigured,
  isDatabaseReachable,
  respondIfDatabaseUnavailable,
} = require('../utils/databaseAvailability');

const router = express.Router();
const PAGE_SIZE = 12;
const CATEGORY_MAP = {
  ai: 'AI',
  tech: 'Tech',
  sports: 'Sports',
  entertainment: 'Entertainment',
};

function normalizeCategory(input) {
  if (!input) return null;
  return CATEGORY_MAP[String(input).trim().toLowerCase()] || null;
}

router.get('/news', async (req, res, next) => {
  try {
    if (await respondIfDatabaseUnavailable(res)) return;

    const page = Math.max(Number.parseInt(req.query.page || '1', 10), 1);
    const requestedCategory = String(req.query.category || '').trim();
    const category = requestedCategory && requestedCategory.toLowerCase() !== 'all'
      ? normalizeCategory(requestedCategory)
      : null;
    const cacheKey = buildCacheKey('news', category || 'all', `page-${page}`);
    const cached = await getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const where = category ? { category } : {};
    const [total, records] = await Promise.all([
      prisma.article.count({ where }),
      prisma.article.findMany({
        where,
        select: articleSelect,
        orderBy: [
          { published_at: 'desc' },
          { created_at: 'desc' },
        ],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    const payload = {
      page,
      pageSize: PAGE_SIZE,
      total,
      hasMore: page * PAGE_SIZE < total,
      category,
      articles: records.map(toApiArticle),
    };

    await setCachedJson(cacheKey, payload, 120);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post('/view', async (req, res, next) => {
  try {
    if (await respondIfDatabaseUnavailable(res)) return;

    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Article id is required.' });

    const article = await prisma.article.update({
      where: { id },
      data: { views: { increment: 1 } },
      select: articleSelect,
    });

    await invalidateCache();
    return res.json({ ok: true, article: toApiArticle(article) });
  } catch (error) {
    return next(error);
  }
});

router.get('/system-status', async (req, res, next) => {
  try {
    const redis = await safeConnectRedis();
    const aiConfig = getLocalAiConfig();
    const databaseConfigured = Boolean(process.env.DATABASE_URL);
    const databaseReachable = databaseConfigured ? await isDatabaseReachable() : false;

    let counts = {
      articlesToday: 0,
      articlesLastHour: 0,
      articlesLast6Hours: 0,
      articlesLast24Hours: 0,
    };

    if (databaseReachable) {
      counts = await getStatusCounts();
    }

    return res.json({
      articles_today: counts.articlesToday,
      articles_last_hour: counts.articlesLastHour,
      articles_last_6_hours: counts.articlesLast6Hours,
      articles_last_24_hours: counts.articlesLast24Hours,
      sources_online: pipelineState.sourcesOnline,
      sources_failed: pipelineState.sourcesFailed,
      last_successful_fetch_at: pipelineState.lastFetchAt,
      last_successful_process_at: pipelineState.lastProcessAt,
      last_trending_update_at: pipelineState.lastTrendingUpdateAt,
      pending_raw_articles: pipelineState.pendingRawArticles.length,
      api_keys: {
        ollama: isLocalAiRewriteEnabled(),
        cloudinary: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
        unsplash: Boolean(process.env.UNSPLASH_ACCESS_KEY),
      },
      ai: {
        provider: aiConfig.provider,
        enabled: isLocalAiRewriteEnabled(),
        ollama_base_url: aiConfig.baseUrl,
        ollama_model: aiConfig.model,
      },
      cache: {
        connected: Boolean(redis),
        configured: Boolean(process.env.REDIS_URL),
      },
      databaseConfigured,
      databaseReachable,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
