const BACKEND_ARTICLE_PAGE_SIZE = 12;
const BACKEND_COMPAT_CACHE_TTL_MS = 5 * 60 * 1000;
let lastBackendCompatError = "";
const backendCompatCache = new Map();
const globalForPrisma = globalThis;
const { buildStoryTags, cleanText, isLowValueTrendText } = require("../article/shared");
const { buildStructuredArticle } = require("../article/contentBuilder");
const { slugify } = require("../seo");

function parseRawMetadata(value = "") {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

const FILTER_TO_BACKEND_CATEGORY = {
  ai: "AI",
  tech: "Tech",
  entertainment: "Entertainment",
  sports: "Sports",
  business: "Tech",
};

function normalizeFilter(filter = "all") {
  return String(filter || "all").trim().toLowerCase();
}

function normalizeComparableText(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHeadlineOnlyText(value = "", headline = "") {
  const text = normalizeComparableText(value);
  const title = normalizeComparableText(headline);
  if (!text || !title) return false;
  return text === title || text.startsWith(`${title} `) || title.startsWith(`${text} `);
}

function wordCount(value = "") {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function hasDisplayableStoryContent(story = {}) {
  const headline = cleanText(story.title || "");
  const summary = cleanText(story.summary || story.subheadline || "");
  const body = cleanText(story.body || story.content || "");
  const keyPoints = Array.isArray(story.keyPoints)
    ? story.keyPoints.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const deepDive = Array.isArray(story.deepDive)
    ? story.deepDive.map((item) => cleanText(item)).filter(Boolean)
    : [];

  const hasMeaningfulSummary = Boolean(
    summary
    && !isLowValueTrendText(summary)
    && !isHeadlineOnlyText(summary, headline)
    && wordCount(summary) >= 10
  );
  const hasMeaningfulBody = Boolean(
    body
    && !isLowValueTrendText(body)
    && !isHeadlineOnlyText(body, headline)
    && wordCount(body) >= 80
  );
  const richKeyPoints = keyPoints.filter((item) => !isLowValueTrendText(item) && !isHeadlineOnlyText(item, headline)).length;
  const richDeepDive = deepDive.filter((item) => !isLowValueTrendText(item) && !isHeadlineOnlyText(item, headline)).length;

  return hasMeaningfulSummary || hasMeaningfulBody || richKeyPoints >= 2 || richDeepDive >= 2;
}

function cacheKeyForOptions({ page = 1, pageSize = 100, filter = "all" } = {}) {
  return JSON.stringify({
    page: Math.max(1, Number(page) || 1),
    pageSize: Math.max(1, Number(pageSize) || 100),
    filter: normalizeFilter(filter),
  });
}

function getCachedPayload(cacheKey = "") {
  const cached = backendCompatCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    backendCompatCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
}

function setCachedPayload(cacheKey = "", payload = null) {
  if (!cacheKey || !payload) return payload;
  backendCompatCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + BACKEND_COMPAT_CACHE_TTL_MS,
  });
  return payload;
}

function getPrismaClient() {
  if (!globalForPrisma.__sunwirePrismaClient) {
    const { PrismaClient } = require("@prisma/client");
    globalForPrisma.__sunwirePrismaClient = new PrismaClient({
      log: ["warn", "error"],
    });
  }
  return globalForPrisma.__sunwirePrismaClient;
}

function resolveBackendCategory(filter = "all") {
  const normalized = normalizeFilter(filter);
  return FILTER_TO_BACKEND_CATEGORY[normalized] || null;
}

function shouldPreferLocalSnapshot(filter = "all", payload = null) {
  return false;
}

function toPublicStory(article = {}) {
  const category = String(article.category || "").trim().toLowerCase() || "tech";
  const publishedAt = article.published_at || article.created_at || "";
  const createdAt = article.created_at || article.published_at || "";
  const trendingScore = Number(article.trending_score || 0);
  const views = Number(article.views || 0);
  const shares = Number(article.shares || 0);
  const rawMetadata = parseRawMetadata(article.raw_content || "");
  const keywords = Array.isArray(article.keywords) && article.keywords.length
    ? article.keywords.slice(0, 8)
    : Array.isArray(article.tags) && article.tags.length
      ? article.tags.slice(0, 8)
      : Array.isArray(rawMetadata.tags) && rawMetadata.tags.length
        ? rawMetadata.tags.slice(0, 8)
        : buildStoryTags(article.title || "", article.summary || "", article.ai_summary || "", category);
  const keyPoints = Array.isArray(article.keyPoints) && article.keyPoints.length
    ? article.keyPoints.slice(0, 5)
    : Array.isArray(rawMetadata.keyPoints) ? rawMetadata.keyPoints.slice(0, 5) : [];
  const primarySourceUrl = article.primary_source_url || rawMetadata.primarySourceUrl || article.source_url || "";
  const subheadline = article.subheadline || rawMetadata.subheadline || article.ai_summary || "";
  const packets = [
    {
      kind: "primary",
      source: cleanText(article.source || "SunWire"),
      title: cleanText(article.title || ""),
      url: cleanText(primarySourceUrl),
      summary: cleanText(article.summary || subheadline || ""),
      body: cleanText(article.content || ""),
    },
    ...(Array.isArray(rawMetadata.coverage) ? rawMetadata.coverage : [])
      .map((item) => ({
        kind: "coverage",
        source: cleanText(item.platform || item.name || item.source || ""),
        title: cleanText(item.title || ""),
        url: cleanText(item.url || ""),
        summary: cleanText(item.summary || ""),
        body: "",
      }))
      .filter((packet) => packet.title || packet.summary),
  ];
  const editorial = buildStructuredArticle(
    packets,
    article.title || "Untitled",
    article.summary || subheadline || article.ai_summary || "",
    {
      related: Array.isArray(rawMetadata.coverage) ? rawMetadata.coverage : [],
      source: article.source || "SunWire",
      sourceUrl: primarySourceUrl,
      category,
      publishedAt,
      tags: keywords,
    }
  );
  const resolvedKeyPoints = keyPoints.length ? keyPoints : (editorial.keyPoints || []);
  const resolvedTags = Array.isArray(rawMetadata.tags) && rawMetadata.tags.length
    ? rawMetadata.tags.slice(0, 5)
    : editorial.tags || keywords.slice(0, 5);
  const resolvedPrimarySource = rawMetadata.primarySourceUrl || primarySourceUrl
    ? {
      name: rawMetadata.primarySourceName || article.source || editorial.primarySource?.name || "Original Source",
      url: rawMetadata.primarySourceUrl || primarySourceUrl || editorial.primarySource?.url || "",
    }
    : editorial.primarySource || {
      name: article.source || "Original Source",
      url: "",
    };

  return {
    id: article.id || "",
    title: article.title || "Untitled",
    summary: article.summary || editorial.summary || subheadline || "",
    subheadline,
    body: editorial.body || article.content || "",
    content: editorial.body || article.content || "",
    image: article.image_url || "",
    image_url: article.image_url || "",
    category,
    source: article.source || "SunWire",
    sourceUrl: primarySourceUrl,
    source_url: primarySourceUrl,
    url: primarySourceUrl,
    published_at: publishedAt,
    publishedAt,
    source_published_at: publishedAt,
    injected_at: createdAt,
    updated_at: article.updated_at || createdAt,
    views,
    shares,
    keywords,
    keyPoints: resolvedKeyPoints,
    tags: resolvedTags,
    deepDive: Array.isArray(rawMetadata.deepDive) && rawMetadata.deepDive.length ? rawMetadata.deepDive : editorial.deepDive || [],
    indiaPulse: rawMetadata.indiaPulse || editorial.indiaPulse || "",
    background: Array.isArray(rawMetadata.background) && rawMetadata.background.length ? rawMetadata.background : editorial.background || [],
    factSheet: Array.isArray(rawMetadata.factSheet) && rawMetadata.factSheet.length ? rawMetadata.factSheet : editorial.factSheet || [],
    primarySource: resolvedPrimarySource,
    estimatedReadingTime: Number(rawMetadata.estimatedReadingTime || editorial.estimatedReadingTime || 0),
    wordCount: Number(article.word_count || rawMetadata.wordCount || editorial.wordCount || 0),
    slug: article.slug || rawMetadata.slug || slugify(article.title || "story"),
    isDatabaseArticle: true,
    metaTitle: article.meta_title || rawMetadata.metaTitle || "",
    metaDescription: article.meta_description || rawMetadata.metaDescription || editorial.metaDescription || "",
    structuredData: article.structured_data || rawMetadata.structuredData || null,
    trustedSources: article.trusted_sources || rawMetadata.coverage || [],
    trendingScore,
    trending_score: trendingScore,
    engagementScore: Math.max(views, shares, views + shares),
    priority: Math.max(trendingScore, shares, views),
  };
}

const ARTICLE_SELECT = {
  id: true,
  title: true,
  slug: true,
  summary: true,
  content: true,
  ai_summary: true,
  raw_content: true,
  image_url: true,
  image_storage_url: true,
  category: true,
  source: true,
  source_url: true,
  published_at: true,
  created_at: true,
  updated_at: true,
  views: true,
  shares: true,
  word_count: true,
  trending_score: true,
};

function normalizeSlugCandidate(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function storySlugCandidates(story = {}) {
  return [...new Set([
    story.slug,
    story.title,
    story.summary,
    story.subheadline,
    story.metaTitle,
    story.metaDescription,
    `${story.id || ""} ${story.title || ""}`,
  ].map((value) => normalizeSlugCandidate(value)).filter(Boolean))];
}

function slugMatchesRequested(story = {}, requestedSlug = "") {
  const normalizedRequestedSlug = normalizeSlugCandidate(requestedSlug);
  if (!normalizedRequestedSlug) return false;

  return storySlugCandidates(story).some((candidate) => (
    candidate === normalizedRequestedSlug
    || candidate.startsWith(`${normalizedRequestedSlug}-`)
    || normalizedRequestedSlug.startsWith(`${candidate}-`)
  ));
}

function matchesStoryIdentity(story = {}, identity = {}) {
  const requestedId = String(identity.id || "").trim().toLowerCase();
  const requestedUrl = String(identity.url || "").trim().replace(/\/+$/g, "").toLowerCase();
  const requestedTitle = String(identity.title || "").trim().toLowerCase();
  const requestedSlug = normalizeFilter(identity.category || "") && String(identity.slug || "").trim().toLowerCase();
  const storyUrl = String(story.sourceUrl || story.url || "").trim().replace(/\/+$/g, "").toLowerCase();
  const storyTitle = String(story.title || "").trim().toLowerCase();
  if (requestedId && String(story.id || "").trim().toLowerCase() === requestedId) return true;
  if (requestedUrl && storyUrl && requestedUrl === storyUrl) return true;
  if (requestedTitle && storyTitle && requestedTitle === storyTitle) return true;
  if (requestedSlug && slugMatchesRequested(story, requestedSlug)) {
    const requestedCategory = normalizeFilter(identity.category || "all");
    const storyCategory = normalizeFilter(story.category || "all");
    return !requestedCategory || requestedCategory === "all" || requestedCategory === storyCategory;
  }

  return false;
}

async function tryFetchBackendUrl({ page = 1, pageSize = 100, filter = "all" } = {}) {
  const baseUrl = String(process.env.BACKEND_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) return null;

  const category = resolveBackendCategory(filter);
  const startIndex = Math.max(0, (page - 1) * pageSize);
  const endIndexExclusive = startIndex + pageSize;
  const startBackendPage = Math.floor(startIndex / BACKEND_ARTICLE_PAGE_SIZE) + 1;
  const endBackendPage = Math.floor(Math.max(0, endIndexExclusive - 1) / BACKEND_ARTICLE_PAGE_SIZE) + 1;
  const pageNumbers = [];

  for (let current = startBackendPage; current <= endBackendPage; current += 1) {
    pageNumbers.push(current);
  }

    const responses = await Promise.all(pageNumbers.map(async (backendPage) => {
    const search = new URLSearchParams({ page: String(backendPage) });
    if (category) search.set("category", category);

    const response = await fetch(`${baseUrl}/api/news?${search.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Backend API returned ${response.status}`);
    }

    return response.json();
  }));

  const totalStories = Number(responses[0]?.total || 0);
  const mergedArticles = responses.flatMap((payload) => payload.articles || []);
  const localOffset = startIndex % BACKEND_ARTICLE_PAGE_SIZE;
  const stories = mergedArticles
    .slice(localOffset, localOffset + pageSize)
    .map(toPublicStory)
    .filter(hasDisplayableStoryContent);

  const payload = {
    generatedAt: new Date().toISOString(),
    totalStories,
    totalPages: Math.max(1, Math.ceil(totalStories / pageSize)),
    page,
    pageSize,
    filter: normalizeFilter(filter),
    stories,
    sourceMode: "backend_url",
  };

  return shouldPreferLocalSnapshot(filter, payload) ? null : payload;
}

async function tryFetchDatabase({ page = 1, pageSize = 100, filter = "all" } = {}) {
  if (!String(process.env.DATABASE_URL || "").trim()) return null;
  const prisma = getPrismaClient();

  try {
    const category = resolveBackendCategory(filter);
    const where = category ? { category } : {};
    const skip = Math.max(0, (page - 1) * pageSize);
    const [totalStories, records] = await Promise.all([
      prisma.article.count({ where }),
      prisma.article.findMany({
        where,
        select: ARTICLE_SELECT,
        orderBy: [
          { published_at: "desc" },
          { created_at: "desc" },
        ],
        skip,
        take: pageSize,
      }),
    ]);

    const payload = {
      generatedAt: new Date().toISOString(),
      totalStories,
      totalPages: Math.max(1, Math.ceil(totalStories / pageSize)),
      page,
      pageSize,
      filter: normalizeFilter(filter),
      stories: records.map((record) => ({
        id: record.id,
        title: record.title,
        slug: record.slug,
        summary: record.summary || record.ai_summary || "",
        content: record.content || "",
        image_url: record.image_storage_url || record.image_url || "",
        category: record.category,
        source: record.source,
        source_url: record.source_url,
        published_at: record.published_at,
        created_at: record.created_at,
        updated_at: record.updated_at,
        views: record.views,
        shares: record.shares,
        trending_score: record.trending_score,
      })).map(toPublicStory).filter(hasDisplayableStoryContent),
      sourceMode: "database",
    };

    return shouldPreferLocalSnapshot(filter, payload) ? null : payload;
  } catch (_) {
    return null;
  }
}

async function findStoryInDatabase(identity = {}) {
  if (!String(process.env.DATABASE_URL || "").trim()) return null;
  const prisma = getPrismaClient();

  try {
    const requestedSlug = String(identity.slug || "").trim().toLowerCase();
    const category = resolveBackendCategory(identity.category || "all");
    if (requestedSlug) {
      const exact = await prisma.article.findFirst({
        where: {
          slug: requestedSlug,
          ...(category ? { category } : {}),
        },
        select: ARTICLE_SELECT,
      });
      if (exact) {
        const exactStory = toPublicStory(exact);
        if (hasDisplayableStoryContent(exactStory)) return exactStory;
      }
    }

    const records = await prisma.article.findMany({
      where: category ? { category } : {},
      select: ARTICLE_SELECT,
      orderBy: [
        { published_at: "desc" },
        { created_at: "desc" },
      ],
      take: requestedSlug ? 400 : 2000,
    });

    return records
      .map(toPublicStory)
      .filter(hasDisplayableStoryContent)
      .find((story) => matchesStoryIdentity(story, identity)) || null;
  } catch (_) {
    return null;
  }
}

async function findStoryBySlug({ slug = "", category = "all" } = {}) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  if (!normalizedSlug) return null;
  return findStoryInDatabase({ slug: normalizedSlug, category });
}

async function findStoryInBackendUrl(identity = {}) {
  const baseUrl = String(process.env.BACKEND_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) return null;

  try {
    const category = resolveBackendCategory(identity.category || "all");
    const pagesToCheck = 6;

    for (let backendPage = 1; backendPage <= pagesToCheck; backendPage += 1) {
      const search = new URLSearchParams({ page: String(backendPage) });
      if (category) search.set("category", category);

      const response = await fetch(`${baseUrl}/api/news?${search.toString()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) break;

      const payload = await response.json();
      const story = (payload.articles || [])
        .map(toPublicStory)
        .filter(hasDisplayableStoryContent)
        .find((entry) => matchesStoryIdentity(entry, identity));
      if (story) return story;

      if ((payload.articles || []).length < BACKEND_ARTICLE_PAGE_SIZE) break;
    }
  } catch (_) {
    return null;
  }

  return null;
}

async function findStoryByIdentity(identity = {}) {
  let story = null;

  try {
    story = await findStoryInBackendUrl(identity);
    if (story) return story;
  } catch (error) {
    lastBackendCompatError = error.message || String(error);
  }

  try {
    story = await findStoryInDatabase(identity);
    if (story) return story;
  } catch (error) {
    lastBackendCompatError = error.message || String(error);
  }

  return null;
}

async function getBackendCompatiblePayload(options = {}) {
  lastBackendCompatError = "";
  const cacheKey = cacheKeyForOptions(options);
  const cachedPayload = getCachedPayload(cacheKey);
  if (cachedPayload) return cachedPayload;

  try {
    const proxied = await tryFetchBackendUrl(options);
    if (proxied) return setCachedPayload(cacheKey, proxied);
  } catch (error) {
    lastBackendCompatError = error.message || String(error);
    // Fall through to direct database mode or legacy snapshot mode.
  }

  try {
    const databasePayload = await tryFetchDatabase(options);
    if (databasePayload) return setCachedPayload(cacheKey, databasePayload);
  } catch (error) {
    lastBackendCompatError = error.message || String(error);
    return null;
  }

  return null;
}

module.exports = {
  findStoryBySlug,
  findStoryByIdentity,
  getBackendCompatiblePayload,
  getLastBackendCompatError: () => lastBackendCompatError,
};
