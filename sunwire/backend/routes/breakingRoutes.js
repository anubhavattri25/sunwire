const express = require('express');
const { articleSelect, toApiArticle } = require('../models/Article');
const { buildCacheKey, getCachedJson, setCachedJson } = require('../utils/cache');
const prisma = require('../config/database');
const { respondIfDatabaseUnavailable } = require('../utils/databaseAvailability');

const router = express.Router();

router.get('/breaking-news', async (req, res, next) => {
  try {
    if (await respondIfDatabaseUnavailable(res)) return;

    const cacheKey = buildCacheKey('breaking-news', 'last-2-hours');
    const cached = await getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const records = await prisma.article.findMany({
      where: { published_at: { gte: cutoff } },
      select: articleSelect,
      orderBy: [
        { published_at: 'desc' },
        { created_at: 'desc' },
      ],
      take: 10,
    });

    const payload = {
      articles: records.map(toApiArticle),
    };

    await setCachedJson(cacheKey, payload, 120);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
