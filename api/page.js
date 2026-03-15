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

const HOME_PAGE_SIZE = 30;
const DESK_PAGE_SIZE = 20;
const STORY_POOL_SIZE = 250;
const HOME_CDN_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=120";
const HOME_POOL_PAGE_COVERAGE = Math.ceil(STORY_POOL_SIZE / HOME_PAGE_SIZE);

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  const query = req.query || {};
  let state = buildHomeState(query);
  let template = readTemplate("index.html");

  if (!state.searchQuery) {
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

      const view = buildHomeView({
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

  const html = injectHead(template, {
    ...state,
    type: "website",
  });
  const finalHtml = minifyHtml(html);
  const etag = `W/"${Buffer.byteLength(finalHtml).toString(16)}-${createHash("sha1").update(finalHtml).digest("base64url")}"`;
  const ifNoneMatch = String(req.headers["if-none-match"] || "");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("CDN-Cache-Control", HOME_CDN_CACHE_CONTROL);
  res.setHeader("Vercel-CDN-Cache-Control", HOME_CDN_CACHE_CONTROL);
  res.setHeader("ETag", etag);

  if (ifNoneMatch.split(/\s*,\s*/).includes(etag)) {
    res.status(304).end();
    return;
  }

  res.status(200).send(finalHtml);
};
