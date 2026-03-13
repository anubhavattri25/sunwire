const {
  buildHomeState,
  buildSectionUrl,
  injectHead,
  minifyHtml,
  normalizeFilter,
  normalizePageNumber,
  readTemplate,
} = require("../lib/seo");
const { getStoriesForSsr } = require("../lib/server/ssrStories");
const { buildHomeView, renderHomeTemplate } = require("../lib/ssr");

function applyFilter(stories = [], filter = "all") {
  const normalizedFilter = normalizeFilter(filter);
  if (normalizedFilter === "all") return stories;
  return stories.filter((story) => normalizeFilter(story.category || "all") === normalizedFilter);
}

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
      const payload = await getStoriesForSsr({ pageSize: 250, reason: "page_ssr" });
      const allStories = Array.isArray(payload?.stories) ? payload.stories : [];
      const filter = normalizeFilter(query.filter || "all");
      const filteredStories = applyFilter(allStories, filter);
      const totalStories = filteredStories.length;
      const pageSize = filter === "all" ? 30 : 20;
      const totalPages = Math.max(1, Math.ceil(totalStories / pageSize));
      const page = Math.min(normalizePageNumber(query.page || 1), totalPages);
      const startIndex = (page - 1) * pageSize;
      const pageStories = filteredStories.slice(startIndex, startIndex + pageSize);
      const view = buildHomeView({
        filter,
        page,
        totalPages,
        totalStories,
        pageStories,
        allStories,
      });

      view.pageStories = pageStories;
      state = {
        ...buildHomeState({ ...query, filter, page }),
        nextUrl: page < totalPages ? buildSectionUrl(filter, page + 1) : "",
      };
      template = renderHomeTemplate(template, view);
    } catch (_) {
      // Fall back to the static template and allow the client to hydrate.
    }
  }

  const html = injectHead(template, {
    ...state,
    type: "website",
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  res.status(200).send(minifyHtml(html));
};
