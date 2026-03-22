const {
  SITE,
  buildArticleUrl,
  buildSectionUrl,
  normalizeFilter,
} = require("../seo");
const { queryStories } = require("./backendCompat");

const FILTERS = ["ai", "tech", "entertainment", "sports", "business"];
const HOME_PAGE_SIZE = 30;
const DESK_PAGE_SIZE = 20;
const FETCH_PAGE_SIZE = 250;
const NEWS_SITEMAP_WINDOW_MS = 48 * 60 * 60 * 1000;

function escapeXml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeTimestamp(value = "") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function canonicalArticleUrl(story = {}) {
  return buildArticleUrl({
    id: story.id || "",
    slug: story.slug || "",
    title: story.title || "",
    category: story.category || "",
  });
}

function storyTimestamp(story = {}) {
  return normalizeTimestamp(
    story.updatedAt
    || story.updated_at
    || story.source_published_at
    || story.published_at
    || story.publishedAt
    || story.injected_at
    || ""
  );
}

async function fetchAllStories() {
  const allStories = [];
  let totalPages = 1;
  let totalStories = 0;

  for (let page = 1; page <= totalPages; page += 1) {
    const payload = await queryStories({
      page,
      pageSize: FETCH_PAGE_SIZE,
      filter: "all",
    });
    const stories = Array.isArray(payload?.stories) ? payload.stories : [];
    totalPages = Math.max(1, Number(payload?.totalPages) || Math.ceil((Number(payload?.totalStories) || stories.length) / FETCH_PAGE_SIZE));
    totalStories = Number(payload?.totalStories) || Number(payload?.total) || stories.length;
    allStories.push(...stories);
    if (!stories.length) break;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalStories,
    stories: allStories,
  };
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

function buildNewsUrlEntry(story = {}) {
  const loc = canonicalArticleUrl(story);
  const publishedAt = normalizeTimestamp(story.source_published_at || story.published_at || story.publishedAt || "");
  if (!loc || !publishedAt) return "";

  return [
    "<url>",
    `<loc>${escapeXml(loc)}</loc>`,
    `<lastmod>${escapeXml(storyTimestamp(story) || publishedAt)}</lastmod>`,
    "<news:news>",
    "<news:publication>",
    `<news:name>${escapeXml(SITE.name)}</news:name>`,
    "<news:language>en</news:language>",
    "</news:publication>",
    `<news:publication_date>${escapeXml(publishedAt)}</news:publication_date>`,
    `<news:title>${escapeXml(String(story.title || "Story").trim())}</news:title>`,
    "</news:news>",
    "</url>",
  ].join("");
}

function filterRecentNewsStories(stories = []) {
  const cutoff = Date.now() - NEWS_SITEMAP_WINDOW_MS;
  return (Array.isArray(stories) ? stories : [])
    .filter((story) => {
      const publishedAt = new Date(story.source_published_at || story.published_at || story.publishedAt || "");
      return !Number.isNaN(publishedAt.getTime()) && publishedAt.getTime() >= cutoff;
    })
    .slice(0, 1000);
}

function buildSitemapXml({ stories = [], generatedAt = "" } = {}) {
  const urls = new Set();
  const entries = [];
  const addEntry = (loc, lastmod = "", priority = "0.7", changefreq = "hourly") => {
    if (!loc || urls.has(loc)) return;
    urls.add(loc);
    entries.push(buildUrlEntry(loc, lastmod, priority, changefreq));
  };

  addEntry(SITE.origin, generatedAt, "1.0", "hourly");
  FILTERS.forEach((filter) => {
    addEntry(buildSectionUrl(filter, 1), generatedAt, "0.9", "hourly");
  });

  const allPages = Math.max(1, Math.ceil(Math.max(stories.length, 1) / HOME_PAGE_SIZE));
  for (let page = 2; page <= allPages; page += 1) {
    addEntry(buildSectionUrl("all", page), generatedAt, "0.7", "hourly");
  }

  FILTERS.forEach((filter) => {
    const count = stories.filter((story) => normalizeFilter(story.category || "all") === filter).length;
    const pages = Math.max(1, Math.ceil(Math.max(count, 1) / DESK_PAGE_SIZE));
    for (let page = 2; page <= pages; page += 1) {
      addEntry(buildSectionUrl(filter, page), generatedAt, "0.6", "hourly");
    }
  });

  stories.forEach((story) => {
    const loc = canonicalArticleUrl(story);
    if (!loc || loc.includes("?")) return;
    addEntry(loc, storyTimestamp(story), "0.8", "hourly");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
  ].join("");
}

function buildNewsSitemapXml(stories = []) {
  const entries = filterRecentNewsStories(stories)
    .map((story) => buildNewsUrlEntry(story))
    .filter(Boolean);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    ...entries,
    "</urlset>",
  ].join("");
}

module.exports = {
  FILTERS,
  SITE,
  buildNewsSitemapXml,
  buildSitemapXml,
  canonicalArticleUrl,
  escapeXml,
  fetchAllStories,
  filterRecentNewsStories,
  storyTimestamp,
};
