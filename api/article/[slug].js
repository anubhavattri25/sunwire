const { findStoryBySlug } = require("../../lib/server/backendCompat");

const ARTICLE_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=300";
const ARTICLE_CDN_CACHE_HEADER = "public, s-maxage=300, stale-while-revalidate=600";

function toArticlePayload(story = {}) {
  const title = story.title || "Story";
  const summary = story.summary || story.subheadline || "";
  const sourceUrl = story.sourceUrl || story.url || "";
  const publishedAt = story.source_published_at || story.published_at || story.publishedAt || "";

  return {
    ...story,
    sourceUrl,
    published_at: publishedAt,
    publishedAt,
    practicalTakeaways: [],
    youtubeEmbedUrl: "",
    seoTitle: story.metaTitle || `${title} | Sunwire`,
    seoDescription: story.metaDescription || summary.slice(0, 150),
    validation: {
      status: "accepted",
      reason: "database_only",
    },
  };
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const slug = String(req.query?.slug || "").trim().toLowerCase();
  const category = String(req.query?.category || req.query?.c || "").trim();

  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  const story = await findStoryBySlug({ slug, category }).catch(() => null);
  if (!story) {
    res.setHeader("Cache-Control", ARTICLE_CACHE_HEADER);
    res.setHeader("CDN-Cache-Control", ARTICLE_CDN_CACHE_HEADER);
    res.setHeader("Vercel-CDN-Cache-Control", ARTICLE_CDN_CACHE_HEADER);
    res.status(404).json({ error: "Article not found" });
    return;
  }

  res.setHeader("Cache-Control", ARTICLE_CACHE_HEADER);
  res.setHeader("CDN-Cache-Control", ARTICLE_CDN_CACHE_HEADER);
  res.setHeader("Vercel-CDN-Cache-Control", ARTICLE_CDN_CACHE_HEADER);
  res.status(200).json(toArticlePayload(story));
};
