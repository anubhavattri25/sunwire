const express = require('express');
const { articleSelect, toApiArticle } = require('../models/Article');
const { buildCacheKey, getCachedJson, setCachedJson } = require('../utils/cache');
const prisma = require('../config/database');
const { respondIfDatabaseUnavailable } = require('../utils/databaseAvailability');

const router = express.Router();

router.get('/trending', async (req, res, next) => {
  try {
    if (await respondIfDatabaseUnavailable(res)) return;

    const cacheKey = buildCacheKey('trending', 'top-10');
    const cached = await getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const records = await prisma.article.findMany({
      select: articleSelect,
      orderBy: [
        { trending_score: 'desc' },
        { published_at: 'desc' },
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
