const { buildArticlePath, decodeParam, slugify } = require("../lib/seo");
const { findStoryByIdentity } = require("../lib/server/backendCompat");

function normalizeUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function slugCandidates(story = {}) {
  return [...new Set([
    story.slug,
    story.title,
    story.summary,
    story.subheadline,
    story.metaTitle,
    story.metaDescription,
    `${story.id || ""} ${story.title || ""}`,
  ].map((value) => slugify(value || "")).filter(Boolean))];
}

function findStory(stories = [], query = {}) {
  const requestedId = String(query.id || "").trim();
  const requestedUrl = normalizeUrl(decodeParam(query.u || query.url || ""));
  const requestedTitle = String(decodeParam(query.t || query.title || "")).trim().toLowerCase();
  const requestedCategory = String(query.category || query.c || "").trim().toLowerCase();
  const requestedSlug = String(query.slug || "").trim().toLowerCase();

  return stories.find((story) => String(story.id || "").trim() === requestedId)
    || stories.find((story) => normalizeUrl(story.sourceUrl || story.url || "") === requestedUrl)
    || stories.find((story) => String(story.title || "").trim().toLowerCase() === requestedTitle)
    || stories.find((story) =>
      requestedSlug
      && slugCandidates(story).some((candidate) => (
        candidate.toLowerCase() === requestedSlug
        || candidate.toLowerCase().startsWith(`${requestedSlug}-`)
        || requestedSlug.startsWith(`${candidate.toLowerCase()}-`)
      ))
      && (!requestedCategory || String(story.category || "").toLowerCase() === requestedCategory)
    )
    || null;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const story = await findStoryByIdentity({
        id: req.query?.id || "",
        url: decodeParam(req.query?.u || req.query?.url || ""),
        title: decodeParam(req.query?.t || req.query?.title || ""),
        slug: String(req.query?.slug || "").trim(),
        category: req.query?.category || req.query?.c || "",
      }).catch(() => null);

    if (!story) {
      res.status(404).send("Not found");
      return;
    }

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.setHeader("Location", buildArticlePath({
      id: story.id || "",
      slug: story.slug || "",
      title: story.title || "",
      category: story.category || "",
    }));
    res.status(301).send("");
  } catch (_) {
    res.status(404).send("Not found");
  }
};
