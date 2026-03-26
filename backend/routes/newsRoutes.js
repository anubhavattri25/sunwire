const express = require('express');
const prisma = require('../config/database');
const { articleSelect, toApiArticle } = require('../models/Article');
const { buildPublisherReview } = require('../../lib/article/publisherReview');
const { buildCacheKey, getCachedJson, setCachedJson, invalidateCache } = require('../utils/cache');
const { buildFeaturedOrderBy, expireFeaturedArticles } = require('../utils/adminArticle');
const { safeConnectRedis } = require('../config/redis');
const {
  isDatabaseReachable,
  respondIfDatabaseUnavailable,
} = require('../utils/databaseAvailability');
const newsService = require('../services/news');

const router = express.Router();
const PAGE_SIZE = 12;
const PUBLIC_API_CACHE_HEADER = 'public, max-age=60, stale-while-revalidate=120';
const CATEGORY_MAP = {
  all: null,
  latest: null,
  random: null,
  general: 'general',
  ai: 'ai',
  tech: 'tech',
  sports: 'sports',
  entertainment: 'entertainment',
  business: 'business',
  politics: 'politics',
  jobs: 'jobs',
  food: 'food',
  headline: 'headline',
  trending: 'trending',
};

function normalizeCategory(input) {
  if (!input) return null;
  const normalized = String(input).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, normalized)
    ? CATEGORY_MAP[normalized]
    : null;
}

function setPublicApiCacheHeaders(res, disableCache = false) {
  res.setHeader('Cache-Control', disableCache ? 'no-store' : PUBLIC_API_CACHE_HEADER);
}

router.get('/news', async (req, res, next) => {
  try {
    if (await respondIfDatabaseUnavailable(res)) return;
    const expired = await expireFeaturedArticles(prisma);
    if (Number(expired?.count || 0) > 0) {
      await invalidateCache();
    }

    const page = Math.max(Number.parseInt(req.query.page || '1', 10), 1);
    const requestedCategory = String(req.query.category || '').trim();
    const requestedMode = requestedCategory.toLowerCase();
    const category = requestedCategory && requestedCategory.toLowerCase() !== 'all'
      ? normalizeCategory(requestedCategory)
      : null;
    const cacheKey = buildCacheKey('news', category || 'all', `page-${page}`);
    const cached = await getCachedJson(cacheKey);
    if (cached) {
      setPublicApiCacheHeaders(res, false);
      return res.json(cached);
    }

    const where = category ? { category } : {};
    const records = await prisma.article.findMany({
      where,
      select: articleSelect,
      orderBy: buildFeaturedOrderBy(),
    });
    const eligibleArticles = records
      .map((record) => ({
        record,
        article: toApiArticle(record),
      }))
      .filter(({ record, article }) => buildPublisherReview({
        title: article?.title || record.title || '',
        summary: article?.summary || '',
        content: article?.content || record.content || '',
        raw_content: record.raw_content || '',
        source: article?.source || record.source || '',
        source_url: article?.source_url || record.source_url || '',
        word_count: article?.word_count || record.word_count || 0,
        ai_rewritten: Boolean(article?.ai_rewritten || record.ai_rewritten),
        manual_upload: Boolean(article?.manual_upload || record.manual_upload),
      }).showInPublicListings !== false);
    const total = eligibleArticles.length;
    const pageArticles = eligibleArticles
      .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      .map(({ article }) => article);

    const payload = {
      page,
      pageSize: PAGE_SIZE,
      total,
      hasMore: page * PAGE_SIZE < total,
      category: requestedMode === 'random' ? 'random' : category,
      articles: pageArticles,
    };

    await setCachedJson(cacheKey, payload, 120);
    setPublicApiCacheHeaders(res, false);
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
    res.setHeader('Cache-Control', 'no-store');

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
    res.setHeader('Cache-Control', 'no-store');
    const redis = await safeConnectRedis();
    const databaseConfigured = Boolean(process.env.DATABASE_URL);
    const databaseReachable = databaseConfigured ? await isDatabaseReachable() : false;
    const newsroom = await newsService.getNewsroomStats({ prisma, databaseReachable });
    const state = newsService.getPublicPipelineState();

    return res.json({
      mode: state.mode,
      manual_only: true,
      admin_email: state.adminEmail,
      articles_total: newsroom.articlesTotal,
      manual_articles_total: newsroom.manualArticlesTotal,
      featured_articles_live: newsroom.featuredArticlesLive,
      latest_article_at: newsroom.latestArticleAt,
      last_manual_publish_at: newsroom.lastManualPublishAt,
      pending_raw_articles: 0,
      sources_online: [],
      sources_failed: [],
      last_successful_fetch_at: null,
      last_successful_process_at: null,
      last_trending_update_at: null,
      pipeline: state,
      cache: {
        connected: Boolean(redis),
        configured: Boolean(process.env.REDIS_URL),
      },
      services: {
        cloudinary: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
        googleAuth: Boolean(
          process.env.GOOGLE_CLIENT_ID
          || process.env.GOOGLE_AUTH_CLIENT_ID
          || process.env.GOOGLE_OAUTH_CLIENT_ID
          || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
        ),
      },
      databaseConfigured,
      databaseReachable,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
