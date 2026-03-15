
const {
  SITE,
  buildArticleUrl,
  buildSectionUrl,
} = require("../lib/seo");

const HOME_PAGE_SIZE = 30;
const DESK_PAGE_SIZE = 20;
const FILTERS = ["ai", "tech", "entertainment", "sports", "business"];

function escapeXml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function canonicalArticleUrl(story = {}) {
  return buildArticleUrl({
    id: story.id || "",
    title: story.title || "",
    category: story.category || "",
  });
}

function storyTimestamp(story = {}) {
  const value = story.source_published_at || story.published_at || story.publishedAt || story.injected_at || "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function buildUrlEntry(loc, lastmod = "", priority = "0.7", changefreq = "hourly") {
  return [
    "<url>",
    `<loc>${escapeXml(loc)}</loc>`,
    lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : "",
    changefreq ? `<changefreq>${escapeXml(changefreq)}</changefreq>` : "",
    priority ? `<priority>${escapeXml(priority)}</priority>` : "",
    "</url>",
  ].filter(Boolean).join("");
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const snapshot = await runIngestion({
  limit: 1000,
  forceRefresh: false,
  reason: "sitemap",
}).catch(() => null);

const payload = {
  generatedAt: snapshot?.generatedAt || "",
  stories: Array.isArray(snapshot?.stories) ? snapshot.stories : [],
};
    const stories = Array.isArray(payload?.stories) ? payload.stories : [];
    const urls = new Set();
    const entries = [];

    const pushEntry = (loc, lastmod = "", priority = "0.7", changefreq = "hourly") => {
      if (!loc || urls.has(loc)) return;
      urls.add(loc);
      entries.push(buildUrlEntry(loc, lastmod, priority, changefreq));
    };

    pushEntry(SITE.origin, payload?.generatedAt || "", "1.0", "hourly");

    FILTERS.forEach((filter) => {
      pushEntry(buildSectionUrl(filter, 1), payload?.generatedAt || "", "0.9", "hourly");
    });

    const allPages = Math.max(1, Math.ceil(stories.length / HOME_PAGE_SIZE));
    for (let page = 2; page <= allPages; page += 1) {
      pushEntry(buildSectionUrl("all", page), payload?.generatedAt || "", "0.7", "hourly");
    }

    FILTERS.forEach((filter) => {
      const count = stories.filter((story) => {
        if (filter === "business") return String(story.category || "").toLowerCase() === "business";
        return String(story.category || "").toLowerCase() === filter;
      }).length;
      const pages = Math.max(1, Math.ceil(count / DESK_PAGE_SIZE));
      for (let page = 2; page <= pages; page += 1) {
        pushEntry(buildSectionUrl(filter, page), payload?.generatedAt || "", "0.6", "hourly");
      }
    });

    stories.forEach((story) => {
      const url = canonicalArticleUrl(story);
      if (!url || url.includes("?")) return;
      pushEntry(url, storyTimestamp(story), "0.8", "hourly");
    });

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries,
      "</urlset>",
    ].join("");

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");
    res.status(200).send(xml);
  } catch (_) {
    const fallback = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      buildUrlEntry(SITE.origin, "", "1.0", "hourly"),
      ...FILTERS.map((filter) => buildUrlEntry(buildSectionUrl(filter, 1), "", "0.9", "hourly")),
      "</urlset>",
    ].join("");

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).send(fallback);
  }
};
