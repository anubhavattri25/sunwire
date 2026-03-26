const prisma = require("../../backend/config/database");
const { articleSelect, toApiArticle } = require("../../backend/models/Article");
const { buildFeaturedOrderBy, expireFeaturedArticles } = require("../../backend/utils/adminArticle");
const { buildPublisherReview } = require("../article/publisherReview");
const { normalizeFilter, slugify } = require("../seo");
const { enrichStoriesWithImages, resolveStoryImage, withResolvedStoryImage } = require("./storyImages");

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 250;
const FIND_CANDIDATE_LIMIT = 250;
const TECH_SOURCE_FILTERS = [
  "LiveMint Tech",
  "Indian Express Tech",
  "TechPP",
  "India Today Technology",
  "The Hindu Technology",
];
const DIRECT_CATEGORY_FILTERS = new Set([
  "general",
  "ai",
  "tech",
  "entertainment",
  "sports",
  "business",
  "politics",
  "jobs",
  "food",
  "headline",
  "trending",
]);
const COMPAT_SELECT = {
  ...articleSelect,
  slug: true,
};

function isLocalOfflineMode() {
  return process.env.SUNWIRE_LOCAL_OFFLINE === "1";
}

function buildEmptyStoryPayload({ page = 1, pageSize = DEFAULT_PAGE_SIZE, filter = "all" } = {}) {
  const safePage = parsePageNumber(page);
  const safePageSize = parsePageSize(pageSize);
  const normalizedFilter = normalizeListFilter(filter);

  return {
    generatedAt: new Date().toISOString(),
    page: safePage,
    pageSize: safePageSize,
    total: 0,
    totalStories: 0,
    totalPages: 1,
    hasMore: false,
    filter: normalizedFilter,
    stories: [],
    articles: [],
    pageStories: [],
    sourceMode: "offline",
  };
}

async function releasePrisma() {
  if (!process.env.VERCEL) return null;
  return prisma.$disconnect().catch(() => null);
}

function parsePageNumber(value = 1) {
  return Math.max(1, Number.parseInt(value || "1", 10) || 1);
}

function parsePageSize(value = DEFAULT_PAGE_SIZE) {
  return Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(value || DEFAULT_PAGE_SIZE, 10) || DEFAULT_PAGE_SIZE)
  );
}

function normalizeUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function parseRawContentMetadata(value = "") {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function pickLongerText(...values) {
  return values
    .map((value) => String(value || "").trim())
    .sort((left, right) => right.length - left.length)[0] || "";
}

function normalizeListFilter(input = "all") {
  const raw = String(input || "all").trim().toLowerCase();
  if (raw === "latest" || raw === "random") return "all";
  if (DIRECT_CATEGORY_FILTERS.has(raw)) return raw;
  const normalized = normalizeFilter(raw);
  return normalized === "latest" ? "all" : normalized;
}

function normalizeStoryCategory(input = "") {
  const raw = String(input || "all").trim().toLowerCase();
  if (DIRECT_CATEGORY_FILTERS.has(raw)) return raw;
  const normalized = normalizeFilter(raw);
  return normalized === "all" ? "latest" : normalized;
}

function buildCategoryWhere(input = "all") {
  const normalized = normalizeListFilter(input);
  if (normalized === "all") return {};

  if (normalized === "tech") {
    return {
      AND: [
        {
          category: {
            equals: normalized,
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
      equals: normalized,
      mode: "insensitive",
    },
  };
}

function articleSlugCandidates(story = {}) {
  return [
    story.slug,
    story.title,
    story.summary,
    story.subheadline,
    `${story.id || ""} ${story.title || ""}`,
  ]
    .map((value) => slugify(value || ""))
    .filter(Boolean);
}

function toCompatStory(record = {}) {
  const article = toApiArticle(record) || {};
  const metadata = parseRawContentMetadata(record.raw_content);
  const sourceUrl = String(article.source_url || record.source_url || "").trim();
  const publishedAt = article.published_at || record.published_at || record.created_at || "";
  const normalizedCategory = normalizeStoryCategory(article.category || record.category || "all");
  const fallbackSlug = slugify(record.slug || record.title || record.id || "story");

  return {
    ...article,
    slug: article.slug || record.slug || fallbackSlug,
    category: normalizedCategory,
    sourceUrl,
    url: sourceUrl,
    image: article.image_url || record.image_storage_url || record.image_url || "",
    body: pickLongerText(metadata.body, article.content, record.content),
    content: pickLongerText(article.content, metadata.body, record.content),
    deepDive: Array.isArray(metadata.deepDive) ? metadata.deepDive.filter(Boolean) : [],
    indiaPulse: String(metadata.indiaPulse || "").trim(),
    background: Array.isArray(metadata.background) ? metadata.background.filter(Boolean) : [],
    factSheet: Array.isArray(metadata.factSheet) ? metadata.factSheet.filter(Boolean) : [],
    practicalTakeaways: Array.isArray(metadata.practicalTakeaways)
      ? metadata.practicalTakeaways.filter(Boolean)
      : [],
    source_published_at: publishedAt,
    metaTitle: article.meta_title || "",
    metaDescription: article.meta_description || "",
    structuredData: article.structured_data || null,
    authorName: article.author_name || metadata.authorName || "Sunwire News Desk",
    trustedSources: Array.isArray(article.trusted_sources) ? article.trusted_sources : [],
    primarySourceUrl: article.primary_source_url || sourceUrl,
    primarySourceName: article.primary_source_name || article.source || record.source || "",
    wordCount: Number(article.word_count || 0),
    estimatedReadingTime: Number(metadata.estimatedReadingTime || 0),
    updatedAt: record.updated_at || record.published_at || "",
    trendingScore: Number(article.trending_score || 0),
    ai_rewritten: Boolean(article.ai_rewritten || metadata.ai_rewritten),
    rewriteStatus: String(metadata.rewriteStatus || "").trim(),
    raw_content: record.raw_content || "",
    is_featured: Boolean(article.is_featured),
    featured_until: article.featured_until || null,
    manual_upload: Boolean(article.manual_upload),
    publisherReview: buildPublisherReview({
      title: article.title || record.title || "",
      summary: article.summary || "",
      content: pickLongerText(metadata.body, article.content, record.content),
      raw_content: record.raw_content || "",
      source: article.source || record.source || "",
      source_url: sourceUrl,
      word_count: Number(article.word_count || 0),
      ai_rewritten: Boolean(article.ai_rewritten),
      manual_upload: Boolean(article.manual_upload),
    }, { metadata }),
    primarySource: {
      name: article.primary_source_name || article.source || record.source || "Original Source",
      url: article.primary_source_url || sourceUrl || "",
    },
  };
}

async function enrichStoryForOutput(story = null) {
  if (!story) return null;
  const image = await resolveStoryImage(story, {
    allowRemoteFetch: true,
    timeoutMs: 4000,
  });
  return withResolvedStoryImage(story, image);
}

async function queryStories({ page = 1, pageSize = DEFAULT_PAGE_SIZE, filter = "all" } = {}) {
  if (isLocalOfflineMode()) {
    return buildEmptyStoryPayload({ page, pageSize, filter });
  }

  try {
    const safePage = parsePageNumber(page);
    const safePageSize = parsePageSize(pageSize);
    const normalizedFilter = normalizeListFilter(filter);
    const where = buildCategoryWhere(normalizedFilter);
    await expireFeaturedArticles(prisma);

    const records = await prisma.article.findMany({
      where,
      select: COMPAT_SELECT,
      orderBy: buildFeaturedOrderBy(),
    });

    const eligibleStories = records
      .map(toCompatStory)
      .filter((story) => story?.publisherReview?.showInPublicListings !== false);
    const total = eligibleStories.length;
    const pagedStories = eligibleStories.slice((safePage - 1) * safePageSize, safePage * safePageSize);
    const stories = await enrichStoriesWithImages(pagedStories, {
      allowRemoteFetch: false,
      remoteFetchLimit: 0,
      concurrency: 1,
    });
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));

    return {
      generatedAt: new Date().toISOString(),
      page: safePage,
      pageSize: safePageSize,
      total,
      totalStories: total,
      totalPages,
      hasMore: safePage < totalPages,
      filter: normalizedFilter,
      stories,
      articles: stories,
    };
  } finally {
    await releasePrisma();
  }
}

async function findStoryBySlug({ slug = "", category = "" } = {}) {
  if (isLocalOfflineMode()) return null;

  try {
    const requestedSlug = slugify(slug || "");
    if (!requestedSlug) return null;

    const where = buildCategoryWhere(category);
    const exact = await prisma.article.findFirst({
      where: {
        ...where,
        slug: {
          equals: requestedSlug,
          mode: "insensitive",
        },
      },
      select: COMPAT_SELECT,
      orderBy: buildFeaturedOrderBy(),
    }).catch(() => null);

    if (exact) {
      const story = toCompatStory(exact);
      if (story?.publisherReview?.showInPublicListings === false) return null;
      return enrichStoryForOutput(story);
    }

    const candidates = await prisma.article.findMany({
      where,
      select: COMPAT_SELECT,
      orderBy: buildFeaturedOrderBy(),
      take: FIND_CANDIDATE_LIMIT,
    }).catch(() => []);

    const matchedStory = candidates
      .map(toCompatStory)
      .filter((story) => story?.publisherReview?.showInPublicListings !== false)
      .find((story) =>
        articleSlugCandidates(story).some((candidate) => {
          const normalizedCandidate = String(candidate || "").toLowerCase();
          return normalizedCandidate === requestedSlug
            || normalizedCandidate.startsWith(`${requestedSlug}-`)
            || requestedSlug.startsWith(`${normalizedCandidate}-`);
        })
      ) || null;

    return enrichStoryForOutput(matchedStory);
  } finally {
    await releasePrisma();
  }
}

async function findStoryByIdentity({
  id = "",
  url = "",
  title = "",
  slug = "",
  category = "",
} = {}) {
  if (isLocalOfflineMode()) return null;

  try {
    const requestedId = String(id || "").trim();
    const requestedUrl = normalizeUrl(url);
    const requestedTitle = String(title || "").trim();
    const requestedSlug = slugify(slug || requestedTitle || "");

    if (requestedId) {
      const byId = await prisma.article.findUnique({
        where: { id: requestedId },
        select: COMPAT_SELECT,
      }).catch(() => null);

      if (byId) {
        const story = toCompatStory(byId);
        if (story?.publisherReview?.showInPublicListings === false) return null;
        return enrichStoryForOutput(story);
      }
    }

    if (requestedSlug) {
      const bySlug = await findStoryBySlug({ slug: requestedSlug, category });
      if (bySlug) return bySlug;
    }

    const where = buildCategoryWhere(category);

    if (requestedUrl) {
      const byUrl = await prisma.article.findFirst({
        where: {
          ...where,
          source_url: requestedUrl,
        },
        select: COMPAT_SELECT,
        orderBy: buildFeaturedOrderBy(),
      }).catch(() => null);

      if (byUrl) {
        const story = toCompatStory(byUrl);
        if (story?.publisherReview?.showInPublicListings === false) return null;
        return enrichStoryForOutput(story);
      }
    }

    if (requestedTitle) {
      const byTitle = await prisma.article.findFirst({
        where: {
          ...where,
          title: {
            equals: requestedTitle,
            mode: "insensitive",
          },
        },
        select: COMPAT_SELECT,
        orderBy: buildFeaturedOrderBy(),
      }).catch(() => null);

      if (byTitle) {
        const story = toCompatStory(byTitle);
        if (story?.publisherReview?.showInPublicListings === false) return null;
        return enrichStoryForOutput(story);
      }
    }

    const candidates = await prisma.article.findMany({
      where,
      select: COMPAT_SELECT,
      orderBy: buildFeaturedOrderBy(),
      take: FIND_CANDIDATE_LIMIT,
    }).catch(() => []);

    const matchedStory = candidates
      .map(toCompatStory)
      .filter((story) => story?.publisherReview?.showInPublicListings !== false)
      .find((story) => {
        if (requestedId && String(story.id || "").trim() === requestedId) return true;
        if (requestedUrl && normalizeUrl(story.sourceUrl || story.url || "") === requestedUrl) return true;
        if (
          requestedTitle
          && String(story.title || "").trim().toLowerCase() === requestedTitle.toLowerCase()
        ) {
          return true;
        }

        if (!requestedSlug) return false;

        return articleSlugCandidates(story).some((candidate) => {
          const normalizedCandidate = String(candidate || "").toLowerCase();
          return normalizedCandidate === requestedSlug
            || normalizedCandidate.startsWith(`${requestedSlug}-`)
            || requestedSlug.startsWith(`${normalizedCandidate}-`);
        });
      }) || null;

    return enrichStoryForOutput(matchedStory);
  } finally {
    await releasePrisma();
  }
}

module.exports = {
  normalizeStoryCategory,
  queryStories,
  findStoryByIdentity,
  findStoryBySlug,
  toCompatStory,
};
