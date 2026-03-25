const { createHash } = require("node:crypto");
const {
  buildHomeState,
  buildSectionUrl,
  injectHead,
  minifyHtml,
  normalizeFilter,
  normalizePageNumber,
  readTemplate,
} = require("../lib/seo");
const {
  getStoriesForSsr,
  getArticlesFromPayload,
} = require("../lib/server/ssrStories");
const { buildHomeView, renderHomeTemplate } = require("../lib/ssr");
const { enrichStoriesWithImages } = require("../lib/server/storyImages");

const HOME_PAGE_SIZE = 32;
const DESK_PAGE_SIZE = 20;
const STORY_POOL_SIZE = 72;
const HOME_CDN_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=120";
const HOME_POOL_PAGE_COVERAGE = Math.ceil(STORY_POOL_SIZE / HOME_PAGE_SIZE);
const SKIP_LOCAL_HOME_SSR = false;

function resolveGoogleClientId() {
  return String(
    process.env.GOOGLE_CLIENT_ID
    || process.env.GOOGLE_AUTH_CLIENT_ID
    || process.env.GOOGLE_OAUTH_CLIENT_ID
    || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    || ""
  ).trim();
}

function injectRuntimeConfig(template = "") {
  const clientId = resolveGoogleClientId();
  const runtimeScript = `<script>window.__SUNWIRE_HOME_DATA__=null;window.__SUNWIRE_GOOGLE_CLIENT_ID__=${JSON.stringify(clientId)};document.documentElement.dataset.googleClientId=${JSON.stringify(clientId)};var authButton=document.getElementById('authButton');if(authButton){authButton.dataset.googleClientId=${JSON.stringify(clientId)};}</script><script type="module" src="/app.js?v=20260326-10"></script>`;
  return String(template || "").replace(
    /<script type="module" src="\/?app\.js\?v=[^"]+"><\/script>/,
    runtimeScript
  );
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
    if (!category || !["ai", "tech", "entertainment", "sports", "business", "politics", "jobs", "food"].includes(category)) return;
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

function mergeUniqueStories(...groups) {
  const seen = new Set();
  const output = [];

  groups.flat().forEach((story) => {
    const key = storyKey(story || {});
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(story);
  });

  return output;
}

async function buildHydratedHomeView({
  filter = "all",
  page = 1,
  totalPages = 1,
  totalStories = 0,
  pageStories = [],
  allStories = [],
} = {}) {
  return buildHomeView({
    filter,
    page,
    totalPages,
    totalStories,
    pageStories,
    allStories,
  });
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  const query = req.query || {};
  let state = buildHomeState(query);
  let template = readTemplate("index.html");
  let view = null;

  if (!state.searchQuery && !SKIP_LOCAL_HOME_SSR) {
    try {
      const filter = normalizeFilter(query.filter || "all");
      const requestedPage = normalizePageNumber(query.page || 1);
      const pageSize = filter === "all" ? HOME_PAGE_SIZE : DESK_PAGE_SIZE;
      let pagePayload = null;
      let poolPayload = null;
      let pageStories = [];
      let allStories = [];
      let totalStories = 0;
      let totalPages = 1;
      let page = requestedPage;

      if (filter === "all" && requestedPage <= HOME_POOL_PAGE_COVERAGE) {
        poolPayload = await getStoriesForSsr({
          page: 1,
          pageSize: STORY_POOL_SIZE,
          filter: "all",
          reason: "page_ssr_pool",
        });

        allStories = getArticlesFromPayload(poolPayload);
        totalStories = Number(poolPayload?.totalStories) || Number(poolPayload?.total) || allStories.length;
        totalPages = Math.max(1, Math.ceil(Math.max(1, totalStories) / HOME_PAGE_SIZE));
        page = Math.min(requestedPage, totalPages);
        pageStories = allStories.slice((page - 1) * HOME_PAGE_SIZE, page * HOME_PAGE_SIZE);
        pagePayload = {
          ...poolPayload,
          page,
          pageSize,
          totalStories,
          totalPages,
          stories: pageStories,
          articles: pageStories,
          pageStories,
        };
      } else {
        pagePayload = await getStoriesForSsr({
          page: requestedPage,
          pageSize,
          filter,
          reason: "page_ssr",
        });

        totalStories = Number(pagePayload?.totalStories) || Number(pagePayload?.total) || 0;
        totalPages = Math.max(
          1,
          Number(pagePayload?.totalPages) || Math.ceil(Math.max(1, totalStories) / pageSize)
        );
        page = Math.min(requestedPage, totalPages);

        if (page !== requestedPage) {
          pagePayload = await getStoriesForSsr({
            page,
            pageSize,
            filter,
            reason: "page_ssr_clamped",
          });
          totalStories = Number(pagePayload?.totalStories) || Number(pagePayload?.total) || totalStories;
          totalPages = Math.max(
            1,
            Number(pagePayload?.totalPages) || Math.ceil(Math.max(1, totalStories) / pageSize)
          );
        }

        pageStories = getArticlesFromPayload(pagePayload);
        if (filter === "all") {
          poolPayload = await getStoriesForSsr({
            page: 1,
            pageSize: STORY_POOL_SIZE,
            filter: "all",
            reason: "page_ssr_pool",
          }).catch((error) => {
            console.log("SSR story pool fetch failed, using page stories", error);
            return pagePayload;
          });
          allStories = getArticlesFromPayload(poolPayload);
        } else {
          allStories = pageStories;
        }

        totalStories = Number(pagePayload?.totalStories) || Number(pagePayload?.total) || pageStories.length;
        totalPages = Math.max(1, Number(pagePayload?.totalPages) || totalPages);
      }

      view = await buildHydratedHomeView({
        filter,
        page,
        totalPages,
        totalStories,
        pageStories,
        allStories,
      });

      state = {
        ...buildHomeState({ ...query, filter, page }),
        nextUrl: page < totalPages ? buildSectionUrl(filter, page + 1) : "",
      };

      template = renderHomeTemplate(template, view);
    } catch (error) {
      console.log("SSR failed, sending static template", error);
    }
  }

  if (SKIP_LOCAL_HOME_SSR) {
    template = injectRuntimeConfig(template);
  }

  const html = injectHead(template, {
    ...state,
    preloadImage: view?.hero?.image || view?.hero?.image_url || "",
    preloadImageWidth: 1600,
    preloadImageHeight: 900,
    preloadImageSizes: "(max-width: 1200px) 100vw, 80vw",
    type: "website",
  });
  const finalHtml = minifyHtml(html);
  const etag = `W/"${Buffer.byteLength(finalHtml).toString(16)}-${createHash("sha1").update(finalHtml).digest("base64url")}"`;
  const ifNoneMatch = String(req.headers["if-none-match"] || "");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
  res.setHeader("CDN-Cache-Control", HOME_CDN_CACHE_CONTROL);
  res.setHeader("Vercel-CDN-Cache-Control", HOME_CDN_CACHE_CONTROL);
  res.setHeader("ETag", etag);

  if (ifNoneMatch.split(/\s*,\s*/).includes(etag)) {
    res.status(304).end();
    return;
  }

  res.status(200).send(finalHtml);
};
