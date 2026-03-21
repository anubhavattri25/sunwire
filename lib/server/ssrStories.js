const { queryStories } = require("./backendCompat");
const SSR_PREFERS_DATABASE = process.env.SSR_FETCH_MODE !== "api";

function normalizePage(value = 1) {
  return Math.max(1, Number.parseInt(value || "1", 10) || 1);
}

function normalizePageSize(value = 100) {
  return Math.max(1, Number.parseInt(value || "100", 10) || 100);
}

function getNewsApiBaseUrl() {
  return process.env.NODE_ENV === "production"
    ? "https://sunwire.in/api/news"
    : "http://127.0.0.1:4000/api/news";
}

function getArticlesFromPayload(payload = {}) {
  if (Array.isArray(payload?.articles)) return payload.articles;
  if (Array.isArray(payload?.stories)) return payload.stories;
  if (Array.isArray(payload?.pageStories)) return payload.pageStories;
  return [];
}

async function fetchStoriesFromApi({
  page = 1,
  pageSize = 100,
  filter = "all",
} = {}) {
  const API = getNewsApiBaseUrl();
  const safePage = normalizePage(page);
  const safePageSize = normalizePageSize(pageSize);
  const params = new URLSearchParams({
    page: String(safePage),
    pageSize: String(safePageSize),
    filter: String(filter || "all").trim().toLowerCase() || "all",
  });

  console.log("API used:", API);

  const res = await fetch(`${API}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`News API returned ${res.status}`);
  }

  const data = await res.json();
  const articles = getArticlesFromPayload(data);

  console.log("Articles fetched:", articles.length);

  return {
    generatedAt: data.generatedAt || "",
    page: Number(data.page) || safePage,
    pageSize: Number(data.pageSize) || safePageSize,
    totalPages: Math.max(
      1,
      Number(data.totalPages)
        || Math.ceil((Number(data.totalStories) || articles.length) / safePageSize)
    ),
    totalStories: Number(data.totalStories) || Number(data.total) || articles.length,
    articles,
    stories: articles,
    pageStories: articles,
    sourceMode: "api",
  };
}

async function getStoriesForSsr({
  page = 1,
  pageSize = 100,
  filter = "all",
} = {}) {
  const safePage = normalizePage(page);
  const safePageSize = normalizePageSize(pageSize);

  if (!SSR_PREFERS_DATABASE) {
    try {
      return await fetchStoriesFromApi({
        page: safePage,
        pageSize: safePageSize,
        filter,
      });
    } catch (_) {}
  }

  const fallback = await queryStories({
    page: safePage,
    pageSize: safePageSize,
    filter,
  });
  const articles = getArticlesFromPayload(fallback);

  console.log("Articles fetched:", articles.length);

  return {
    generatedAt: fallback.generatedAt || new Date().toISOString(),
    page: Number(fallback.page) || safePage,
    pageSize: Number(fallback.pageSize) || safePageSize,
    totalPages: Math.max(
      1,
      Number(fallback.totalPages)
        || Math.ceil((Number(fallback.totalStories) || Number(fallback.total) || articles.length) / safePageSize)
    ),
    totalStories: Number(fallback.totalStories) || Number(fallback.total) || articles.length,
    articles,
    stories: articles,
    pageStories: articles,
    sourceMode: "database",
  };
}

module.exports = {
  getStoriesForSsr,
  getArticlesFromPayload,
};
