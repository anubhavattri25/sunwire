const prisma = require("../backend/config/database");
const { articleSelect, toApiArticle } = require("../backend/models/Article");
const { ingestNewsSources } = require("../backend/services/newsIngestor");
const { queryStories } = require("../lib/server/backendCompat");

const NEWS_CDN_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=120";
const memoryNewsCache = globalThis.__SUNWIRE_FRONTEND_NEWS_CACHE__ || new Map();

globalThis.__SUNWIRE_FRONTEND_NEWS_CACHE__ = memoryNewsCache;

function normalizeCacheValue(value = "", fallback = "") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized || fallback;
}

function buildFrontendNewsCacheKey(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page || "1", 10) || 1);
  const pageSize = Math.max(1, Number.parseInt(query.pageSize || "30", 10) || 30);
  const filter = normalizeCacheValue(query.filter || "all", "all");

  return ["sunwire-frontend-news", filter, `page-${page}`, `size-${pageSize}`].join(":");
}

function getMemoryCachedPayload(cacheKey = "") {
  return memoryNewsCache.get(cacheKey) || null;
}

function setMemoryCachedPayload(cacheKey = "", payload = null) {
  if (!cacheKey || !payload) return;
  memoryNewsCache.set(cacheKey, payload);
}

function setNewsResponseHeaders(res, refresh = false) {
  if (refresh) {
    res.setHeader("Cache-Control", "no-store");
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("CDN-Cache-Control", NEWS_CDN_CACHE_CONTROL);
  res.setHeader("Vercel-CDN-Cache-Control", NEWS_CDN_CACHE_CONTROL);
}

function normalizeNewsFilter(input = "all") {
  const normalized = normalizeCacheValue(input || "all", "all");
  return normalized === "latest" ? "all" : normalized;
}

function buildNewsWhere(filter = "all") {
  const normalizedFilter = normalizeNewsFilter(filter);
  if (normalizedFilter === "all") return {};

  return {
    category: {
      equals: normalizedFilter,
      mode: "insensitive",
    },
  };
}

async function queryStoriesWithoutCount({ page = 1, pageSize = 30, filter = "all" } = {}) {
  const safePage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const safePageSize = Math.max(1, Number.parseInt(pageSize || "30", 10) || 30);
  const normalizedFilter = normalizeNewsFilter(filter);
  const records = await prisma.article.findMany({
    where: buildNewsWhere(normalizedFilter),
    select: articleSelect,
    orderBy: [
      { published_at: "desc" },
      { created_at: "desc" },
    ],
    skip: (safePage - 1) * safePageSize,
    take: safePageSize,
  });

  const articles = records.map(toApiArticle);
  const hasMore = articles.length === safePageSize;
  const approximateTotal = hasMore
    ? (safePage * safePageSize) + 1
    : ((safePage - 1) * safePageSize) + articles.length;

  return {
    generatedAt: new Date().toISOString(),
    page: safePage,
    pageSize: safePageSize,
    total: approximateTotal,
    totalStories: approximateTotal,
    totalPages: Math.max(1, Math.ceil(Math.max(1, approximateTotal) / safePageSize)),
    hasMore,
    filter: normalizedFilter,
    articles,
    stories: articles,
    pageStories: articles,
    sourceMode: "light-fallback",
  };
}

module.exports = async function handler(req, res) {
  const refresh = req.query.refresh === "1";
  const cacheKey = buildFrontendNewsCacheKey(req.query || {});

  try {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "DATABASE_URL is not configured." });
      return;
    }

    if (!refresh) {
      const cachedPayload = getMemoryCachedPayload(cacheKey);
      if (cachedPayload) {
        setMemoryCachedPayload(cacheKey, cachedPayload);
        setNewsResponseHeaders(res, false);
        res.status(200).json(cachedPayload);
        return;
      }
    }

    // Run ingestion when refresh=1
    if (refresh) {
      const articles = await ingestNewsSources();

      if (Array.isArray(articles) && articles.length) {
        await Promise.all(
          articles.map((article) =>
            prisma.article
              .create({ data: article })
              .catch(() => null)
          )
        );

      }
    }

    let payload;
    try {
      payload = await queryStories({
        page: req.query.page,
        pageSize: req.query.pageSize,
        filter: req.query.filter || "all",
      });
    } catch (_) {
      payload = await queryStoriesWithoutCount({
        page: req.query.page,
        pageSize: req.query.pageSize,
        filter: req.query.filter || "all",
      });
    }

    setMemoryCachedPayload(cacheKey, payload);
    setNewsResponseHeaders(res, refresh);

    res.status(200).json(payload);

  } catch (err) {
    if (!refresh) {
      const stalePayload = getMemoryCachedPayload(cacheKey);
      if (stalePayload) {
        setNewsResponseHeaders(res, false);
        res.status(200).json({
          ...stalePayload,
          sourceMode: stalePayload.sourceMode || "stale-cache",
        });
        return;
      }
    }

    res.status(500).json({
      error: "Pipeline failed",
      message: err.message,
    });
  }
};
