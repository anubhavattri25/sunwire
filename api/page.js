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
const { readAdminSession } = require("../backend/utils/adminAuth");

const HOME_FIRST_PAGE_STORY_COUNT = 12;
const HOME_ARCHIVE_PAGE_SIZE = 16;
const DESK_PAGE_SIZE = 20;
const STORY_POOL_SIZE = 64;
const HOME_CDN_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=120";
const SKIP_LOCAL_HOME_SSR = false;

function getHomeTotalPages(totalStories = 0) {
  const safeTotal = Math.max(0, Number(totalStories) || 0);
  if (safeTotal <= HOME_FIRST_PAGE_STORY_COUNT) return 1;
  return 1 + Math.ceil((safeTotal - HOME_FIRST_PAGE_STORY_COUNT) / HOME_ARCHIVE_PAGE_SIZE);
}

function getHomePageStoryWindow(page = 1) {
  const safePage = normalizePageNumber(page);
  if (safePage <= 1) {
    return {
      startIndex: 0,
      pageSize: HOME_FIRST_PAGE_STORY_COUNT,
      endIndex: HOME_FIRST_PAGE_STORY_COUNT,
    };
  }

  const startIndex = HOME_FIRST_PAGE_STORY_COUNT + ((safePage - 2) * HOME_ARCHIVE_PAGE_SIZE);
  return {
    startIndex,
    pageSize: HOME_ARCHIVE_PAGE_SIZE,
    endIndex: startIndex + HOME_ARCHIVE_PAGE_SIZE,
  };
}

function resolveGoogleClientId() {
  return String(
    process.env.GOOGLE_CLIENT_ID
    || process.env.GOOGLE_AUTH_CLIENT_ID
    || process.env.GOOGLE_OAUTH_CLIENT_ID
    || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    || ""
  ).trim();
}

function injectRuntimeConfig(template = "", authState = null) {
  const clientId = resolveGoogleClientId();
  const runtimeScript = `<script>window.__SUNWIRE_HOME_DATA__=null;window.__SUNWIRE_AUTH_STATE__=${JSON.stringify(authState || null)};window.__SUNWIRE_GOOGLE_CLIENT_ID__=${JSON.stringify(clientId)};document.documentElement.dataset.googleClientId=${JSON.stringify(clientId)};var authButton=document.getElementById('authButton');if(authButton){authButton.dataset.googleClientId=${JSON.stringify(clientId)};}</script><script type="module" src="/app.js?v=20260401-2"></script>`;
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
    if (!category || !["ai", "tech", "entertainment", "sports", "business", "politics", "jobs"].includes(category)) return;
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
  const session = await readAdminSession(req, { trustSignedRole: true }).catch(() => null);
  const authState = session
    ? {
      user: {
        email: String(session.email || "").trim(),
        name: String(session.name || "").trim(),
        picture: String(session.picture || "").trim(),
      },
      role: String(session.role || "").trim().toLowerCase(),
    }
    : null;
  let state = buildHomeState(query);
  let template = readTemplate("index.html");
  let view = null;

  if (!state.searchQuery && !SKIP_LOCAL_HOME_SSR) {
    try {
      const filter = normalizeFilter(query.filter || "all");
      const requestedPage = normalizePageNumber(query.page || 1);
      const pageSize = filter === "all" ? HOME_ARCHIVE_PAGE_SIZE : DESK_PAGE_SIZE;
      let pagePayload = null;
      let poolPayload = null;
      let pageStories = [];
      let allStories = [];
      let totalStories = 0;
      let totalPages = 1;
      let page = requestedPage;

      if (filter === "all") {
        const requiredPoolSize = Math.max(STORY_POOL_SIZE, getHomePageStoryWindow(requestedPage).endIndex);
        poolPayload = await getStoriesForSsr({
          page: 1,
          pageSize: requiredPoolSize,
          filter: "all",
          reason: "page_ssr_pool",
        });

        allStories = getArticlesFromPayload(poolPayload);
        totalStories = Number(poolPayload?.totalStories) || Number(poolPayload?.total) || allStories.length;
        totalPages = getHomeTotalPages(totalStories);
        page = Math.min(requestedPage, totalPages);
        const { startIndex, endIndex, pageSize: homePageSize } = getHomePageStoryWindow(page);
        pageStories = allStories.slice(startIndex, endIndex);
        pagePayload = {
          ...poolPayload,
          page,
          pageSize: homePageSize,
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

      template = renderHomeTemplate(template, view, {
        authState,
        clientId: resolveGoogleClientId(),
      });
    } catch (error) {
      console.log("SSR failed, sending static template", error);
    }
  }

  if (SKIP_LOCAL_HOME_SSR) {
    template = injectRuntimeConfig(template, authState);
  } else if (!view) {
    template = injectRuntimeConfig(template, authState);
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
