const { decodeParam } = require("../lib/article/shared");
const { findStoryByIdentity } = require("../lib/server/backendCompat");

const ARTICLE_CACHE_HEADER = "public, s-maxage=300, stale-while-revalidate=600";

function parseRequestedArticle(query = {}) {
  return {
    id: decodeParam(query.id || ""),
    slug: decodeParam(query.slug || ""),
    url: decodeParam(query.url || query.u || ""),
    title: decodeParam(query.title || query.t || ""),
    source: decodeParam(query.source || query.s || "Sunwire Desk"),
    publishedAt: decodeParam(query.published_at || query.publishedAt || query.p || ""),
    summary: decodeParam(query.summary || query.m || ""),
    image: decodeParam(query.image || query.i || ""),
    category: decodeParam(query.category || query.c || "latest"),
  };
}

function buildPrimarySource(story = {}, requested = {}) {
  return story.primarySource || {
    name: story.source || requested.source || "Original Source",
    url: story.sourceUrl || story.url || requested.url || "",
  };
}

function toArticlePayload(story = {}, requested = {}) {
  const title = story.title || requested.title || "Story";
  const summary = story.summary || story.subheadline || requested.summary || "";
  const body = story.body || story.content || "";
  const publishedAt = story.source_published_at || story.published_at || story.publishedAt || requested.publishedAt || "";
  const sourceUrl = story.sourceUrl || story.url || requested.url || "";
  const image = story.image || story.image_url || requested.image || "";

  return {
    title,
    source: story.source || requested.source || "Sunwire Desk",
    sourceUrl,
    published_at: publishedAt,
    publishedAt,
    image,
    summary,
    keyPoints: Array.isArray(story.keyPoints) ? story.keyPoints : [],
    practicalTakeaways: [],
    body,
    deepDive: Array.isArray(story.deepDive) ? story.deepDive : [],
    indiaPulse: story.indiaPulse || "",
    background: Array.isArray(story.background) ? story.background : [],
    factSheet: Array.isArray(story.factSheet) ? story.factSheet : [],
    tags: Array.isArray(story.tags) ? story.tags : [],
    metaDescription: story.metaDescription || summary.slice(0, 150),
    wordCount: Number(story.wordCount || 0),
    estimatedReadingTime: Number(story.estimatedReadingTime || 0),
    primarySource: buildPrimarySource(story, requested),
    youtubeEmbedUrl: "",
    related: Array.isArray(story.trustedSources) ? story.trustedSources.slice(0, 5) : [],
    seoTitle: story.metaTitle || `${title} | Sunwire`,
    seoDescription: story.metaDescription || summary.slice(0, 150),
    validation: {
      status: "accepted",
      reason: "database_only",
    },
  };
}

async function buildArticlePayload(req, requestedArticle) {
  const story = await findStoryByIdentity({
    id: requestedArticle.id || "",
    slug: requestedArticle.slug || "",
    url: requestedArticle.url || "",
    title: requestedArticle.title || "",
    category: requestedArticle.category || "",
  });

  if (!story) return null;
  return toArticlePayload(story, requestedArticle);
}

async function buildArticleResponse(req, requestedArticle) {
  const payload = await buildArticlePayload(req, requestedArticle);
  return payload
    ? { payload, cacheHeader: ARTICLE_CACHE_HEADER }
    : { payload: null, cacheHeader: ARTICLE_CACHE_HEADER };
}

const handler = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const requestedArticle = parseRequestedArticle(req.query || {});
  const result = await buildArticleResponse(req, requestedArticle);
  if (!result.payload) {
    res.setHeader("Cache-Control", ARTICLE_CACHE_HEADER);
    res.status(404).json({ error: "Article not found" });
    return;
  }

  res.setHeader("Cache-Control", result.cacheHeader);
  res.status(200).json(result.payload);
};

handler.parseRequestedArticle = parseRequestedArticle;
handler.buildArticlePayload = buildArticlePayload;
handler.buildArticleResponse = buildArticleResponse;

module.exports = handler;
