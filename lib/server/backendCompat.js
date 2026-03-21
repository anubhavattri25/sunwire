const prisma = require("../../backend/config/database");
const { articleSelect, toApiArticle } = require("../../backend/models/Article");
const { normalizeFilter, slugify } = require("../seo");
const { enrichStoriesWithImages, resolveStoryImage, withResolvedStoryImage } = require("./storyImages");

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 250;
const FIND_CANDIDATE_LIMIT = 250;
const COMPAT_SELECT = {
  ...articleSelect,
  slug: true,
};

async function releasePrisma() {
  if (!process.env.VERCEL) return;
  await prisma.$disconnect().catch(() => null);
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
  const normalized = normalizeFilter(String(input || "all").trim().toLowerCase());
  return normalized === "latest" ? "all" : normalized;
}

function normalizeStoryCategory(input = "") {
  const normalized = normalizeFilter(String(input || "all").trim().toLowerCase());
  return normalized === "all" ? "latest" : normalized;
}

function buildCategoryWhere(input = "all") {
  const normalized = normalizeListFilter(input);
  if (normalized === "all") return {};

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
    trustedSources: Array.isArray(article.trusted_sources) ? article.trusted_sources : [],
    primarySourceUrl: article.primary_source_url || sourceUrl,
    primarySourceName: article.primary_source_name || article.source || record.source || "",
    wordCount: Number(article.word_count || 0),
    estimatedReadingTime: Number(metadata.estimatedReadingTime || 0),
    trendingScore: Number(article.trending_score || 0),
    primarySource: {
      name: article.primary_source_name || article.source || record.source || "Original Source",
      url: article.primary_source_url || sourceUrl || "",
    },
  };
}

async function enrichStoryForOutput(story = null) {
  if (!story) return null;
  const image = await resolveStoryImage(story, { allowRemoteFetch: false });
  return withResolvedStoryImage(story, image);
}

async function queryStories({ page = 1, pageSize = DEFAULT_PAGE_SIZE, filter = "all" } = {}) {
  try {
    const safePage = parsePageNumber(page);
    const safePageSize = parsePageSize(pageSize);
    const normalizedFilter = normalizeListFilter(filter);
    const where = buildCategoryWhere(normalizedFilter);

    const [total, records] = await Promise.all([
      prisma.article.count({ where }),
      prisma.article.findMany({
        where,
        select: COMPAT_SELECT,
        orderBy: [
          { published_at: "desc" },
          { created_at: "desc" },
        ],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
    ]);

    const stories = await enrichStoriesWithImages(records.map(toCompatStory), {
      allowRemoteFetch: false,
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
      orderBy: [
        { published_at: "desc" },
        { created_at: "desc" },
      ],
    }).catch(() => null);

    if (exact) return enrichStoryForOutput(toCompatStory(exact));

    const candidates = await prisma.article.findMany({
      where,
      select: COMPAT_SELECT,
      orderBy: [
        { published_at: "desc" },
        { created_at: "desc" },
      ],
      take: FIND_CANDIDATE_LIMIT,
    }).catch(() => []);

    const matchedStory = candidates
      .map(toCompatStory)
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

      if (byId) return enrichStoryForOutput(toCompatStory(byId));
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
        orderBy: [
          { published_at: "desc" },
          { created_at: "desc" },
        ],
      }).catch(() => null);

      if (byUrl) return enrichStoryForOutput(toCompatStory(byUrl));
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
        orderBy: [
          { published_at: "desc" },
          { created_at: "desc" },
        ],
      }).catch(() => null);

      if (byTitle) return enrichStoryForOutput(toCompatStory(byTitle));
    }

    const candidates = await prisma.article.findMany({
      where,
      select: COMPAT_SELECT,
      orderBy: [
        { published_at: "desc" },
        { created_at: "desc" },
      ],
      take: FIND_CANDIDATE_LIMIT,
    }).catch(() => []);

    const matchedStory = candidates
      .map(toCompatStory)
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
