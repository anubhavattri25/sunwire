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

      let pagePayload = await getStoriesForSsr({
        page: requestedPage,
        pageSize,
        filter,
        reason: "page_ssr",
      });

      const computedTotalStories = Number(pagePayload?.totalStories) || Number(pagePayload?.total) || 0;
      const computedTotalPages = Math.max(
        1,
        Number(pagePayload?.totalPages) || Math.ceil(Math.max(1, computedTotalStories) / pageSize)
      );
      const page = Math.min(requestedPage, computedTotalPages);

      if (page !== requestedPage) {
        pagePayload = await getStoriesForSsr({
          page,
          pageSize,
          filter,
          reason: "page_ssr_clamped",
        });
      }

      const poolPayload = await getStoriesForSsr({
        page: 1,
        pageSize: STORY_POOL_SIZE,
        filter: "all",
        reason: "page_ssr_pool",
      });

      const pageStories = getArticlesFromPayload(pagePayload);
      const allStories = getArticlesFromPayload(poolPayload);
      const totalStories = Number(pagePayload?.totalStories) || Number(pagePayload?.total) || pageStories.length;
      const totalPages = Math.max(1, Number(pagePayload?.totalPages) || computedTotalPages);

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

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=120"
  );

  res.status(200).send(minifyHtml(html));
};
