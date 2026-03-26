const prisma = require("../backend/config/database");
const {
  getDatabaseBusyMessage,
  isDatabaseCoolingDown,
  markDatabasePressure,
  normalizeDatabaseError,
} = require("../backend/utils/databaseAvailability");
const { buildFeaturedOrderBy, expireFeaturedArticles } = require("../backend/utils/adminArticle");
const { queryStories, toCompatStory } = require("../lib/server/backendCompat");
const { enrichStoriesWithImages } = require("../lib/server/storyImages");
const { buildHomeView } = require("../lib/ssr");

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
  const filter = normalizeNewsFilter(query.filter || query.category || "all");

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

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
  res.setHeader("CDN-Cache-Control", NEWS_CDN_CACHE_CONTROL);
  res.setHeader("Vercel-CDN-Cache-Control", NEWS_CDN_CACHE_CONTROL);
}

function normalizeNewsFilter(input = "all") {
  const normalized = normalizeCacheValue(input || "all", "all");
  return normalized === "latest" || normalized === "random" ? "all" : normalized;
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

function storyKey(story = {}) {
  return String(story.id || story.sourceUrl || story.url || story.title || "").trim();
}

function collectVisibleStories(view = {}) {
  const seen = new Set();
  const stories = [];

  [view.hero, ...(view.trending || [])]
    .filter(Boolean)
    .forEach((story) => {
      const key = storyKey(story);
      if (!key || seen.has(key)) return;
      seen.add(key);
      stories.push(story);
    });

  [...(view.topSections || []), ...(view.moreSections || [])].forEach((section) => {
    (section?.stories || []).forEach((story) => {
      const key = storyKey(story);
      if (!key || seen.has(key)) return;
      seen.add(key);
      stories.push(story);
    });
  });

  return stories;
}

function collectHomepageCandidateStories({
  pageStories = [],
  allStories = [],
  prioritizedStories = [],
} = {}) {
  const seen = new Set();
  const stories = [];
  const categoryCounts = new Map();
  const categoryLimit = 4;

  function addStory(story = null) {
    const key = storyKey(story || {});
    if (!key || seen.has(key)) return;
    seen.add(key);
    stories.push(story);
  }

  prioritizedStories.forEach(addStory);
  pageStories.slice(0, 30).forEach(addStory);

  (Array.isArray(allStories) ? allStories : []).forEach((story) => {
    const category = String(story?.category || "").trim().toLowerCase();
    if (!category || !["ai", "tech", "entertainment", "sports", "business"].includes(category)) return;
    const count = categoryCounts.get(category) || 0;
    if (count >= categoryLimit) return;
    addStory(story);
    categoryCounts.set(category, count + 1);
  });

  return stories;
}

function replaceStoriesWithMap(stories = [], replacements = new Map()) {
  return (Array.isArray(stories) ? stories : []).map((story) => {
    const key = storyKey(story);
    return replacements.get(key) || story;
  });
}

async function hydrateHomepagePoolPayload(payload = {}) {
  return payload;
}

async function queryStoriesWithoutCount({ page = 1, pageSize = 30, filter = "all" } = {}) {
  const safePage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const safePageSize = Math.max(1, Number.parseInt(pageSize || "30", 10) || 30);
  const normalizedFilter = normalizeNewsFilter(filter);
  await expireFeaturedArticles(prisma);
  const records = await prisma.article.findMany({
    where: buildNewsWhere(normalizedFilter),
    select: articleSelect,
    orderBy: buildFeaturedOrderBy(),
  });

  const eligibleStories = records
    .map(toCompatStory)
    .filter((story) => story?.publisherReview?.showInPublicListings !== false);
  const pagedStories = eligibleStories.slice((safePage - 1) * safePageSize, safePage * safePageSize);
  const stories = await enrichStoriesWithImages(pagedStories, {
    allowRemoteFetch: false,
    remoteFetchLimit: 0,
    concurrency: 1,
  });
  const approximateTotal = eligibleStories.length;
  const hasMore = safePage * safePageSize < approximateTotal;

  return {
    generatedAt: new Date().toISOString(),
    page: safePage,
    pageSize: safePageSize,
    total: approximateTotal,
    totalStories: approximateTotal,
    totalPages: Math.max(1, Math.ceil(Math.max(1, approximateTotal) / safePageSize)),
    hasMore,
    filter: normalizedFilter,
    articles: stories,
    stories,
    pageStories: stories,
    sourceMode: "manual-desk-fallback",
  };
}

module.exports = async function handler(req, res) {
  const cacheKey = buildFrontendNewsCacheKey(req.query || {});
  const requestedPage = Math.max(1, Number.parseInt(req.query.page || "1", 10) || 1);
  const requestedFilter = req.query.filter || req.query.category || "all";
  const normalizedFilter = normalizeNewsFilter(requestedFilter);
  try {
    const warmCachedPayload = getMemoryCachedPayload(cacheKey);
    if (isDatabaseCoolingDown() && warmCachedPayload) {
      setNewsResponseHeaders(res, false);
      res.status(200).json({
        ...warmCachedPayload,
        sourceMode: warmCachedPayload.sourceMode || "stale-cache",
      });
      return;
    }

    try {
      const expired = await expireFeaturedArticles(prisma);
      if (Number(expired?.count || 0) > 0) {
        memoryNewsCache.clear();
      }
    } catch (_) {
      // Ignore background database maintenance failures
    }

    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "DATABASE_URL is not configured." });
      return;
    }

    const cachedPayload = getMemoryCachedPayload(cacheKey);
    if (cachedPayload) {
      setMemoryCachedPayload(cacheKey, cachedPayload);
      setNewsResponseHeaders(res, false);
      res.status(200).json(cachedPayload);
      return;
    }

    let payload;
    try {
      payload = await queryStories({
        page: req.query.page,
        pageSize: req.query.pageSize,
        filter: requestedFilter,
      });
    } catch (_) {
      payload = await queryStoriesWithoutCount({
        page: req.query.page,
        pageSize: req.query.pageSize,
        filter: requestedFilter,
      });
    }

    setMemoryCachedPayload(cacheKey, payload);
    setNewsResponseHeaders(res, false);

    res.status(200).json(payload);

  } catch (err) {
    markDatabasePressure(err);
    const stalePayload = getMemoryCachedPayload(cacheKey);
    if (stalePayload) {
      setNewsResponseHeaders(res, false);
      res.status(200).json({
        ...stalePayload,
        sourceMode: stalePayload.sourceMode || "stale-cache",
      });
      return;
    }

    const normalizedError = normalizeDatabaseError(err, "Manual news fetch failed");
    res.status(Number(normalizedError.statusCode || 500)).json({
      error: "Manual news fetch failed",
      message: normalizedError.message || getDatabaseBusyMessage(),
    });
  } finally {
    // Keep the shared Prisma client warm so repeated homepage requests do not
    // churn connections and reconnect on every invocation.
  }
};
