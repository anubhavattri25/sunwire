const prisma = require("../backend/config/database");
const { articleSelect } = require("../backend/models/Article");
const { buildFeaturedOrderBy, expireFeaturedArticles } = require("../backend/utils/adminArticle");
const { queryStories, toCompatStory } = require("../lib/server/backendCompat");
const { enrichStoriesWithImages } = require("../lib/server/storyImages");
const { buildHomeView } = require("../lib/ssr");

const NEWS_CDN_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=120";
const memoryNewsCache = globalThis.__SUNWIRE_FRONTEND_NEWS_CACHE__ || new Map();
const TECH_SOURCE_FILTERS = [
  "LiveMint Tech",
  "Indian Express Tech",
  "TechPP",
  "India Today Technology",
  "The Hindu Technology",
];

function isLocalOfflineMode() {
  return process.env.SUNWIRE_LOCAL_OFFLINE === "1";
}

function cleanEnvValue(value = "") {
  return String(value || "").trim();
}

function getRemoteNewsApiBaseUrl() {
  const explicitApi = cleanEnvValue(process.env.SUNWIRE_REMOTE_NEWS_API);
  if (explicitApi) return explicitApi;
  return "https://sunwire.in/api/news";
}

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

  if (normalizedFilter === "tech") {
    return {
      AND: [
        {
          category: {
            equals: normalizedFilter,
            mode: "insensitive",
          },
        },
        {
          OR: TECH_SOURCE_FILTERS.map((source) => ({
            source: {
              contains: source,
              mode: "insensitive",
            },
          })),
        },
      ],
    };
  }

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
  const stories = Array.isArray(payload?.stories) ? payload.stories : [];
  if (!stories.length) return payload;

  const pageStories = stories.slice(0, 30);
  const view = buildHomeView({
    filter: "all",
    page: 1,
    totalPages: Math.max(1, Number(payload.totalPages) || 1),
    totalStories: Number(payload.totalStories) || Number(payload.total) || stories.length,
    pageStories,
    allStories: stories,
  });
  const visibleStories = collectVisibleStories(view);
  const candidateStories = collectHomepageCandidateStories({
    pageStories,
    allStories: stories,
    prioritizedStories: visibleStories,
  });

  if (!candidateStories.length) return payload;

  const enrichedStories = await enrichStoriesWithImages(candidateStories, {
    allowRemoteFetch: true,
    remoteFetchLimit: 8,
    concurrency: 3,
  });
  const replacementMap = new Map(
    enrichedStories
      .map((story) => [storyKey(story), story])
      .filter(([key]) => Boolean(key))
  );
  const nextStories = replaceStoriesWithMap(stories, replacementMap);

  return {
    ...payload,
    stories: nextStories,
    articles: nextStories,
    pageStories: replaceStoriesWithMap(Array.isArray(payload?.pageStories) ? payload.pageStories : pageStories, replacementMap),
  };
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
    allowRemoteFetch: true,
    remoteFetchLimit: 8,
    concurrency: 3,
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
    sourceMode: "light-fallback",
  };
}

function buildOfflineNewsPayload({ page = 1, pageSize = 30, filter = "all" } = {}) {
  const safePage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const safePageSize = Math.max(1, Number.parseInt(pageSize || "30", 10) || 30);
  const normalizedFilter = normalizeNewsFilter(filter);

  return {
    generatedAt: new Date().toISOString(),
    page: safePage,
    pageSize: safePageSize,
    total: 0,
    totalStories: 0,
    totalPages: 1,
    hasMore: false,
    filter: normalizedFilter,
    articles: [],
    stories: [],
    pageStories: [],
    sourceMode: "offline",
  };
}

async function fetchRemoteNewsPayload({ page = 1, pageSize = 30, filter = "all" } = {}) {
  const safePage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const safePageSize = Math.max(1, Number.parseInt(pageSize || "30", 10) || 30);
  const normalizedFilter = normalizeNewsFilter(filter);
  const params = new URLSearchParams({
    page: String(safePage),
    pageSize: String(safePageSize),
    filter: normalizedFilter,
  });

  const response = await fetch(`${getRemoteNewsApiBaseUrl()}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Remote news API returned ${response.status}`);
  }

  const payload = await response.json();
  return {
    ...payload,
    page: Number(payload.page) || safePage,
    pageSize: Number(payload.pageSize) || safePageSize,
    total: Number(payload.total) || Number(payload.totalStories) || 0,
    totalStories: Number(payload.totalStories) || Number(payload.total) || 0,
    totalPages: Math.max(1, Number(payload.totalPages) || 1),
    filter: normalizeNewsFilter(payload.filter || normalizedFilter),
    stories: Array.isArray(payload.stories) ? payload.stories : (Array.isArray(payload.articles) ? payload.articles : []),
    articles: Array.isArray(payload.articles) ? payload.articles : (Array.isArray(payload.stories) ? payload.stories : []),
    pageStories: Array.isArray(payload.pageStories)
      ? payload.pageStories
      : (Array.isArray(payload.stories) ? payload.stories : (Array.isArray(payload.articles) ? payload.articles : [])),
    sourceMode: payload.sourceMode || "remote-api",
  };
}

module.exports = async function handler(req, res) {
  const refresh = req.query.refresh === "1";
  const cacheKey = buildFrontendNewsCacheKey(req.query || {});
  const requestedPage = Math.max(1, Number.parseInt(req.query.page || "1", 10) || 1);
  const requestedFilter = req.query.filter || req.query.category || "all";
  const normalizedFilter = normalizeNewsFilter(requestedFilter);
  try {
    if (process.env.SUNWIRE_LOCAL_DATA_MODE === "production-api") {
      try {
        let payload = await fetchRemoteNewsPayload({
          page: req.query.page,
          pageSize: req.query.pageSize,
          filter: requestedFilter,
        });
        if (requestedPage === 1 && normalizedFilter === "all") {
          payload = await hydrateHomepagePoolPayload(payload);
        }
        setMemoryCachedPayload(cacheKey, payload);
        setNewsResponseHeaders(res, refresh);
        res.status(200).json(payload);
        return;
      } catch (error) {
        if (!isLocalOfflineMode()) throw error;
      }
    }

    try {
      const expired = await expireFeaturedArticles(prisma);
      if (Number(expired?.count || 0) > 0) {
        memoryNewsCache.clear();
      }
    } catch (_) {
      // Ignore background database maintenance failures
    }

    if (isLocalOfflineMode()) {
      const payload = buildOfflineNewsPayload({
        page: req.query.page,
        pageSize: req.query.pageSize,
        filter: requestedFilter,
      });
      setMemoryCachedPayload(cacheKey, payload);
      setNewsResponseHeaders(res, refresh);
      res.status(200).json(payload);
      return;
    }

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
      const { ingestNewsSources } = require("../backend/services/newsIngestor");
      const { processPendingArticles } = require("../backend/services/articleProcessor");
      const articles = await ingestNewsSources();

      if (Array.isArray(articles) && articles.length) {
        await processPendingArticles(articles);
      }
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

    if (requestedPage === 1 && normalizedFilter === "all") {
      payload = await hydrateHomepagePoolPayload(payload);
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
  } finally {
    if (process.env.VERCEL) {
      await prisma.$disconnect().catch(() => null);
    }
  }
};
