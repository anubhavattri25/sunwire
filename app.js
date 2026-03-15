import {
  DISPLAY_TIMEZONE,
  applyResponsiveImage,
  cleanText,
  decodeHtmlEntities,
  escapeHtml,
  fmtDate,
  isElementNearViewport,
  scheduleIdleTask,
  setLinkHref,
  setMetaContent,
  timeAgo,
  toTitleCase,
} from "./shared/client-utils.mjs";

const tickerTrack = document.getElementById("tickerTrack");
const paginationEl = document.getElementById("pagination");
const homeRefreshBtn = document.getElementById("homeRefreshBtn");
const livePulseText = document.getElementById("livePulseText");
const liveStatPrimary = document.getElementById("liveStatPrimary");
const liveStatSecondary = document.getElementById("liveStatSecondary");
const trendingUpdatedAtEl = document.getElementById("trendingUpdatedAt");
const menuToggle = document.getElementById("menuToggle");
const siteHeader = document.querySelector(".site-header");
const searchButton = document.getElementById("searchButton");
const headerSearchForm = document.getElementById("headerSearch");
const headerSearchInput = document.getElementById("headerSearchInput");
const headerSearchClear = document.getElementById("headerSearchClear");
const headerSearchStatus = document.getElementById("headerSearchStatus");
const showAllButton = document.getElementById("showAllButton");
const activeDeskChip = document.getElementById("activeDeskChip");
const heroDeskChip = document.getElementById("heroDeskChip");
const navLinks = [...document.querySelectorAll("[data-nav-filter]")];
const trendingModeButtons = [...document.querySelectorAll("[data-trending-mode]")];

const headlineOfTheDayLink = document.getElementById("headlineOfTheDayLink");
const headlineOfTheDayMeta = document.getElementById("headlineOfTheDayMeta");
const heroAuthorEl = document.getElementById("heroAuthor");
const heroSummaryEl = document.getElementById("heroSummary");
const heroImageEl = document.getElementById("heroImage");

const trendingGridEl = document.getElementById("trendingGrid");
const categorySectionsGridEl = document.getElementById("categorySectionsGrid");
const moreNewsGridEl = document.getElementById("moreNewsGrid");
const categoryZoneSectionEl = categorySectionsGridEl.closest(".category-zone");
const moreNewsSectionEl = moreNewsGridEl.closest(".more-news-shell");
const categoryNewsTitleEl = document.getElementById("categoryNewsTitle");
const paginationShellEl = paginationEl?.closest(".pagination-shell");

const eventsListEl = document.getElementById("eventsList");
const priceBoardMetaEl = document.getElementById("priceBoardMeta");
const priceBoardListEl = document.getElementById("priceBoardList");
const priceBoardSourcesEl = document.getElementById("priceBoardSources");
const toolNameEl = document.getElementById("toolName");
const toolUseEl = document.getElementById("toolUse");
const toolLinkEl = document.getElementById("toolLink");
const homepageSidebarEl = document.getElementById("homepageSidebar");

const newsCardTemplate = document.getElementById("newsCardTemplate");
const sectionPanelTemplate = document.getElementById("sectionPanelTemplate");

const DEFAULT_HOME_PAGE_SIZE = 30;
const DESK_PAGE_SIZE = 20;
const CATEGORY_RAIL_COUNT = 15;
const CATEGORY_PREVIEW_FETCH_SIZE = 24;
const CATEGORY_POOL_FETCH_SIZE = 250;
const HOME_POOL_PAGE_COVERAGE = Math.ceil(CATEGORY_POOL_FETCH_SIZE / DEFAULT_HOME_PAGE_SIZE);
const MORE_SECTION_COUNT = 4;
const TRENDING_COUNT = 4;
const HERO_ROTATION_POOL_SIZE = 6;
const LAST_HERO_STORAGE_KEY = "sunwire:last-hero-story-key";
const AUTO_REFRESH_MS = 20 * 60 * 1000;
const SIDEBAR_REFRESH_MS = 20 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_FETCH_PAGE_SIZE = 100;
const API_RESPONSE_TTL_MS = 2 * 60 * 1000;
const DEFERRED_ASSET_VERSION = "20260315-5";
const FILTER_ALIASES = {
  all: "all",
  latest: "all",
  "india-pulse": "all",
  politics: "all",
  "war-conflict": "all",
  "startups-funding": "all",
  ai: "ai",
  tech: "tech",
  entertainment: "entertainment",
  sports: "sports",
  business: "business",
};
const CATEGORY_KEYS = ["ai", "tech", "entertainment", "sports", "business"];
const SEO_SITE_NAME = "Sunwire";
const SEO_SITE_ORIGIN = "https://sunwire.in";
const SEO_DEFAULT_TITLE = "Sunwire - Latest AI, Tech, Entertainment and Sports News";
const SEO_DEFAULT_DESCRIPTION = "Sunwire delivers fresh AI, technology, entertainment, sports, and business news with concise summaries and practical insights.";
const SEO_SOCIAL_IMAGE = `${SEO_SITE_ORIGIN}/social-card.svg`;
const SEO_FILTER_META = {
  all: {
    title: SEO_DEFAULT_TITLE,
    description: SEO_DEFAULT_DESCRIPTION,
  },
  latest: {
    title: SEO_DEFAULT_TITLE,
    description: SEO_DEFAULT_DESCRIPTION,
  },
  ai: {
    title: "AI News | Sunwire",
    description: "Latest AI news, model launches, developer tools, chips, and practical coverage curated by Sunwire.",
  },
  tech: {
    title: "Tech News | Sunwire",
    description: "Latest technology news across software, platforms, cloud, cybersecurity, chips, and product launches on Sunwire.",
  },
  entertainment: {
    title: "Entertainment News | Sunwire",
    description: "Latest entertainment news covering films, streaming, creators, music, celebrity culture, and releases on Sunwire.",
  },
  sports: {
    title: "Sports News | Sunwire",
    description: "Latest sports news with fast reads across cricket, football, major tournaments, athletes, and match momentum on Sunwire.",
  },
  business: {
    title: "Business News | Sunwire",
    description: "Latest business news on startups, funding, markets, earnings, platform economics, and company moves on Sunwire.",
  },
};
const CATEGORY_EYEBROWS = {
  ai: "Models and agents",
  tech: "Platforms and chips",
  entertainment: "Culture and releases",
  sports: "Matches and momentum",
  business: "Markets and money",
};
const POLITICS_KEYWORDS = [
  "politics", "political", "policy", "policies", "government", "election", "elections",
  "president", "prime minister", "minister", "congress", "senate", "parliament", "white house",
  "tariff", "trade war", "sanction", "sanctions", "visa", "asylum", "regulation", "regulatory",
  "antitrust", "supreme court", "lawmakers", "diplomatic", "geopolitic", "border", "immigration"
];
const WAR_KEYWORDS = [
  "war", "conflict", "military", "missile", "missiles", "drone strike", "airstrike", "air strike",
  "shelling", "troops", "army", "navy", "air force", "defense", "defence", "invasion", "ceasefire",
  "battle", "combat", "frontline", "weapon", "weapons", "gaza", "ukraine", "russia", "israel",
  "iran", "hamas", "hezbollah", "rebels", "insurgent", "border clash"
];
const BUSINESS_KEYWORDS = [
  "startup", "startups", "founder", "founders", "funding", "fundraise", "fundraising",
  "raised", "raises", "raising", "seed round", "series a", "series b", "series c",
  "valuation", "venture capital", "vc", "private equity", "acquisition", "acquires",
  "acquired", "merger", "ipo", "listing", "listed", "shares", "earnings", "revenue",
  "profit", "loss", "unicorn", "fintech", "saas", "enterprise", "deal", "dealmaking"
];

const TOPIC_FALLBACK_IMAGES = [
  {
    match: /(ipl|cricket|virat|kohli|rohit|dhoni|bcci|t20|odi|world cup|cricbuzz)/i,
    image: "https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1400&q=80",
  },
  {
    match: /(football|soccer|messi|ronaldo|champions league|premier league|fifa)/i,
    image: "https://images.unsplash.com/photo-1517466787929-bc90951d0974?auto=format&fit=crop&w=1400&q=80",
  },
  {
    match: /(movie|film|bollywood|hollywood|box office|trailer|netflix|prime video|jiohotstar|ott|actor|actress|celebrity|award)/i,
    image: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1400&q=80",
  },
  {
    match: /(music|concert|tour|album|spotify|singer|band)/i,
    image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1400&q=80",
  },
  {
    match: /(iphone|apple|ios|macbook|pixel|android|samsung|device|smartphone|laptop)/i,
    image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1400&q=80",
  },
  {
    match: /(openai|anthropic|claude|chatgpt|gemini|copilot|llm|ai|model|nvidia|microsoft|google)/i,
    image: "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1400&q=80",
  },
  {
    match: /(spacex|starship|rocket|launch|nasa|space)/i,
    image: "https://images.unsplash.com/photo-1516849841032-87cbac4d88f7?auto=format&fit=crop&w=1400&q=80",
  },
];

const CATEGORY_FALLBACK_IMAGES = {
  ai: "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1400&q=80",
  tech: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1400&q=80",
  entertainment: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1400&q=80",
  sports: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1400&q=80",
  business: "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1400&q=80",
  news: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1400&q=80",
};

let currentStories = [];
let currentCategoryMap = {};
let currentPage = 1;
let totalPages = 1;
let totalStories = 0;
let activeFilter = "all";
let activeTrendingMode = "trending";
let isLoading = false;
let activeLoadRequestId = 0;
let activeSearchQuery = "";
let searchIndexCache = {
  stories: [],
  fetchedAt: 0,
};
const apiResponseCache = new Map();
let homeWidgetsModulePromise = null;
let searchModulePromise = null;
let sidebarObserver = null;
let topSectionsObserver = null;
let sidebarHydrationPromise = null;
let pendingSidebarPayload = null;
let pendingTopSections = [];
let pendingTopSectionsVariant = "dense";

function loadHomeWidgetsModule() {
  homeWidgetsModulePromise ||= import(`./app-widgets.mjs?v=${DEFERRED_ASSET_VERSION}`);
  return homeWidgetsModulePromise;
}

function loadSearchModule() {
  searchModulePromise ||= import(`./app-search.mjs?v=${DEFERRED_ASSET_VERSION}`);
  return searchModulePromise;
}

function cleanTitle(title = "") {
  return cleanText(title)
    .replace(/\s*\|\s*[^|]+$/g, "")
    .replace(/\s*-\s*(live updates|latest updates|full story|explained)\b.*$/gi, "")
    .replace(/\b(opinion|commentary):\s*/gi, "")
    .replace(/\s*:\s*practical update\s*#\d+\b/gi, "")
    .replace(/\s*practical update\s*#\d+\b/gi, "")
    .replace(/\s*update\s*#\d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function clipText(text = "", maxLength = 120) {
  const value = cleanText(text);
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength);
  const boundary = Math.max(clipped.lastIndexOf(" "), Math.floor(maxLength * 0.7));
  return `${clipped.slice(0, boundary).trim()}...`;
}

function optimizeHeadline(title = "", variant = "card") {
  const maxLengthByVariant = {
    hero: 116,
    trending: 70,
    compact: 64,
    card: 88,
  };
  return clipText(cleanTitle(title), maxLengthByVariant[variant] || 88);
}

function optimizeSummary(summary = "", story = {}, variant = "card") {
  const seed = cleanText(summary || story.description || story.excerpt || "")
    .replace(/this matters because\b.*$/i, "")
    .replace(/experts believe\b.*$/i, "")
    .replace(/it highlights the importance\b.*$/i, "")
    .replace(/a practical next step is\b.*$/i, "")
    .replace(/\bopen story\b.*$/i, "")
    .replace(/\bread more\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const fallback = cleanTitle(story.title || "");
  const source = seed || fallback;
  const maxLength = variant === "hero" ? 150 : 92;
  return clipText(source, maxLength);
}

function resolveFilter(filter = "all") {
  return FILTER_ALIASES[filter] || "all";
}

function buildSectionPath(filter = activeFilter, page = currentPage) {
  const resolvedFilter = resolveFilter(filter);
  const safePage = Math.max(1, Number(page) || 1);

  if (resolvedFilter === "all") {
    return safePage > 1 ? `/page/${safePage}` : "/";
  }

  return safePage > 1
    ? `/${resolvedFilter}/page/${safePage}`
    : `/${resolvedFilter}`;
}

function parseHomeRoute(location = window.location) {
  const queryParams = new URLSearchParams(location.search);
  const pathname = String(location.pathname || "/").replace(/\/+$/g, "") || "/";
  const sectionMatch = pathname.match(/^\/(ai|tech|entertainment|sports|business)(?:\/page\/(\d+))?$/i);
  const rootPageMatch = pathname.match(/^\/page\/(\d+)$/i);

  if (sectionMatch) {
    return {
      filter: resolveFilter(sectionMatch[1] || "all"),
      page: Math.max(1, Number(sectionMatch[2]) || 1),
      query: cleanText(queryParams.get("q") || ""),
    };
  }

  if (rootPageMatch) {
    return {
      filter: "all",
      page: Math.max(1, Number(rootPageMatch[1]) || 1),
      query: cleanText(queryParams.get("q") || ""),
    };
  }

  const initialFilter = String(queryParams.get("filter") || "all").toLowerCase();
  return {
    filter: Object.prototype.hasOwnProperty.call(FILTER_ALIASES, initialFilter) ? initialFilter : "all",
    page: Math.max(1, Number(queryParams.get("page")) || 1),
    query: cleanText(queryParams.get("q") || ""),
  };
}

function readPreloadedHomeData() {
  return window.__SUNWIRE_HOME_DATA__ && typeof window.__SUNWIRE_HOME_DATA__ === "object"
    ? window.__SUNWIRE_HOME_DATA__
    : null;
}

function extractNewsStories(payload = {}) {
  if (Array.isArray(payload?.pageStories)) return payload.pageStories;
  if (Array.isArray(payload?.stories)) return payload.stories;
  if (Array.isArray(payload?.articles)) return payload.articles;
  if (Array.isArray(payload?.mainStories)) return payload.mainStories;
  return [];
}

function normalizeNewsPayload(payload = {}) {
  const stories = extractNewsStories(payload);
  return {
    ...payload,
    stories,
    articles: stories,
    pageStories: stories,
  };
}

function activeDeskLabel() {
  if (activeSearchQuery) return "Search";
  if (activeFilter === "all") return "All Desks";
  if (activeFilter === "india-pulse") return "India Pulse";
  if (activeFilter === "war-conflict") return "War & Conflict";
  if (activeFilter === "politics") return "Politics";
  if (activeFilter === "startups-funding") return "Startups & Funding";
  if (activeFilter === "business") return "Startups & Funding";
  return toTitleCase(activeFilter);
}

function buildCanonicalHomeUrl({ filter = activeFilter, page = currentPage, query = activeSearchQuery } = {}) {
  const resolvedFilter = resolveFilter(filter);
  const safePage = Math.max(1, Number(page) || 1);
  if (cleanText(query)) {
    const url = new URL(buildSectionPath(resolvedFilter, 1), SEO_SITE_ORIGIN);
    url.searchParams.set("q", cleanText(query));
    return url.toString();
  }
  return new URL(buildSectionPath(resolvedFilter, safePage), SEO_SITE_ORIGIN).toString();
}

function syncHomeSeo() {
  const filter = resolveFilter(activeFilter);
  const page = Math.max(1, Number(currentPage) || 1);
  const searchQuery = cleanText(activeSearchQuery);
  const meta = SEO_FILTER_META[filter] || SEO_FILTER_META.all;
  const isIndexable = !searchQuery;
  const title = isIndexable
    ? `${meta.title}${page > 1 ? ` - Page ${page}` : ""}`
    : `Search results for "${searchQuery}" | ${SEO_SITE_NAME}`;
  const description = isIndexable
    ? `${meta.description}${page > 1 ? ` Page ${page} of Sunwire coverage.` : ""}`
    : `Search results for ${searchQuery} on ${SEO_SITE_NAME}.`;
  const canonical = buildCanonicalHomeUrl({ filter, page, query: searchQuery });

  document.title = title;
  setMetaContent('meta[name="description"]', description);
  setMetaContent('meta[name="robots"]', isIndexable ? "index, follow" : "noindex, follow");
  setLinkHref('link[rel="canonical"]', canonical);
  setMetaContent('meta[property="og:title"]', title);
  setMetaContent('meta[property="og:description"]', description);
  setMetaContent('meta[property="og:url"]', canonical);
  setMetaContent('meta[property="og:site_name"]', SEO_SITE_NAME);
  setMetaContent('meta[property="og:image"]', SEO_SOCIAL_IMAGE);
  setMetaContent('meta[name="twitter:title"]', title);
  setMetaContent('meta[name="twitter:description"]', description);
  setMetaContent('meta[name="twitter:image"]', SEO_SOCIAL_IMAGE);
}

function getPageSizeForFilter(filter = activeFilter) {
  return filter === "all" || filter === "latest" ? DEFAULT_HOME_PAGE_SIZE : DESK_PAGE_SIZE;
}

function setSearchStatus(message = "") {
  if (headerSearchStatus) headerSearchStatus.textContent = message;
}

function setSearchOpenState(isOpen) {
  const shouldOpen = Boolean(isOpen);
  siteHeader.classList.toggle("is-search-open", shouldOpen);
  if (headerSearchForm) headerSearchForm.hidden = !shouldOpen;
  if (searchButton) searchButton.setAttribute("aria-expanded", String(shouldOpen));
}

function clearSearchInput() {
  if (headerSearchInput) headerSearchInput.value = "";
}

function syncSearchAuxiliaryControls() {
  const hasQuery = Boolean(activeSearchQuery || cleanText(headerSearchInput?.value || ""));
  if (headerSearchClear) headerSearchClear.textContent = hasQuery ? "Clear" : "Close";
}

function updateBrowserUrl(options = {}) {
  const config = typeof options === "string"
    ? { filter: options }
    : options;
  const filter = String(config.filter ?? activeFilter ?? "all").toLowerCase();
  const normalizedFilter = resolveFilter(filter);
  const query = cleanText(config.query ?? activeSearchQuery);
  const page = Math.max(1, Number(config.page ?? currentPage) || 1);
  const url = new URL(window.location.href);
  url.pathname = buildSectionPath(normalizedFilter, query ? 1 : page);
  url.searchParams.delete("filter");
  if (query) {
    url.searchParams.set("q", query);
  } else {
    url.searchParams.delete("q");
  }
  url.searchParams.delete("page");
  window.history.pushState({}, "", `${url.pathname}${url.search}`);
  syncHomeSeo();
}

function openDeskInPlace(filter = "all") {
  activeSearchQuery = "";
  currentPage = 1;
  setSearchStatus("");
  clearSearchInput();
  setSearchOpenState(false);
  activeFilter = filter;
  syncActiveControls();
  updateBrowserUrl({ filter, query: "", page: 1 });
  return loadStories(1);
}

function categoryLabel(story = {}) {
  if (story.displayCategory) return toTitleCase(story.displayCategory);
  if (activeFilter === "business" && story.category !== "business") return "Business";
  return toTitleCase(story.category || activeFilter || "news");
}

function getDisplayTimestamp(story = {}) {
  return story.source_published_at || story.published_at || story.publishedAt || story.injected_at || "";
}

function toDateKeyInTimezone(isoString, timeZone = DISPLAY_TIMEZONE) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildFallbackImage(story = {}) {
  const haystack = `${story.title || ""} ${story.summary || ""} ${story.source || ""} ${story.category || ""}`;
  const matched = TOPIC_FALLBACK_IMAGES.find((entry) => entry.match.test(haystack));
  if (matched) return matched.image;
  return CATEGORY_FALLBACK_IMAGES[story.category || "news"] || CATEGORY_FALLBACK_IMAGES.news;
}

function storyImage(story = {}) {
  const candidate = decodeHtmlEntities(String(story.image || story.image_url || "").trim());
  const isValidRemote = /^https?:\/\//i.test(candidate) && !/\.svg(\?|$)/i.test(candidate);
  return isValidRemote ? candidate : buildFallbackImage(story);
}

function buildArticleHref(story = {}) {
  const slug = cleanText(story.slug || story.title || story.id || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug ? `/article/${slug}` : "/";
}

function storyKey(story = {}) {
  return String(story.id || story.sourceUrl || story.url || story.title || "").trim();
}

function isPoliticsRelatedStory(story = {}) {
  const haystack = cleanText([
    story.title,
    story.summary,
    story.description,
    story.source,
    story.category,
  ].filter(Boolean).join(" ")).toLowerCase();
  return POLITICS_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function isWarRelatedStory(story = {}) {
  const haystack = cleanText([
    story.title,
    story.summary,
    story.description,
    story.source,
    story.category,
  ].filter(Boolean).join(" ")).toLowerCase();
  return WAR_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function isBusinessFocusStory(story = {}) {
  const haystack = cleanText([
    story.title,
    story.summary,
    story.description,
    story.source,
    story.category,
  ].filter(Boolean).join(" ")).toLowerCase();
  return BUSINESS_KEYWORDS.some((keyword) => haystack.includes(keyword))
    || story.category === "business";
}

function buildPoliticsStories(stories = [], used = new Set(), count = MORE_SECTION_COUNT, mode = "just-in") {
  return takeUnique(
    sortStoriesForTrending(stories.filter(isPoliticsRelatedStory), mode),
    used,
    count
  ).map((story) => ({
    ...story,
    displayCategory: "Politics",
  }));
}

function buildWarStories(stories = [], used = new Set(), count = MORE_SECTION_COUNT, mode = "just-in") {
  return takeUnique(
    sortStoriesForTrending(stories.filter(isWarRelatedStory), mode),
    used,
    count
  ).map((story) => ({
    ...story,
    displayCategory: "War",
  }));
}

function buildBusinessFocusStories(stories = [], used = new Set(), count = MORE_SECTION_COUNT, mode = "just-in") {
  return takeUnique(
    sortStoriesForTrending(stories.filter(isBusinessFocusStory), mode),
    used,
    count
  ).map((story) => ({
    ...story,
    displayCategory: "Startups & Funding",
  }));
}

function isIndiaPriorityStory(story = {}) {
  const haystack = cleanText([
    story.title,
    story.summary,
    story.displayCategory,
    story.source,
    story.category,
    story.searchTrendTopic,
  ].filter(Boolean).join(" ")).toLowerCase();

  if (Number(story.searchTrendScore || 0) >= 45) return true;
  if (Number(story.indiaAudienceRelevance || 0) >= 18) return true;
  if (isPoliticsRelatedStory(story) || isWarRelatedStory(story)) return true;
  return [
    "india", "indian", "nepal", "pakistan", "china", "border", "war", "missile",
    "prime minister", "pm", "cabinet", "parliament", "policy", "economy", "oil",
    "inflation", "rupee", "rbi", "sensex", "nifty", "tariff"
  ].some((keyword) => haystack.includes(keyword));
}

function compareHomepagePriority(a, b) {
  const priorityFlagDiff = Number(isIndiaPriorityStory(b)) - Number(isIndiaPriorityStory(a));
  if (priorityFlagDiff !== 0) return priorityFlagDiff;

  const trendDiff = Number(b.searchTrendScore || 0) - Number(a.searchTrendScore || 0);
  if (trendDiff !== 0) return trendDiff;

  const indiaDiff = Number(b.indiaAudienceRelevance || 0) - Number(a.indiaAudienceRelevance || 0);
  if (indiaDiff !== 0) return indiaDiff;

  const trendingDiff = Number(b.trendingScore || 0) - Number(a.trendingScore || 0);
  if (trendingDiff !== 0) return trendingDiff;

  const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
  if (priorityDiff !== 0) return priorityDiff;

  return new Date(getDisplayTimestamp(b)).getTime() - new Date(getDisplayTimestamp(a)).getTime();
}

function sortStoriesForHomepageFocus(stories = []) {
  return [...stories].sort(compareHomepagePriority);
}

function dedupeStories(stories = []) {
  const seen = new Set();
  return stories.filter((story) => {
    const key = storyKey(story);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeComparableStoryText(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRedditStory(story = {}) {
  const haystack = normalizeComparableStoryText([
    story.source,
    story.sourceUrl,
    story.url,
  ].filter(Boolean).join(" "));
  return haystack.includes("reddit") || haystack.includes("r sports") || haystack.includes("r technology");
}

function hasRenderableStoryCopy(story = {}) {
  const headline = normalizeComparableStoryText(story.title || "");
  const copy = normalizeComparableStoryText(
    story.content || story.body || story.summary || story.subheadline || ""
  );
  if (!headline || !copy || copy.length < 40) return false;
  if (copy === headline) return false;
  return !copy.startsWith(`${headline} source`);
}

function isDisplayableStory(story = {}) {
  return Boolean(cleanText(story.slug || story.title || story.id || ""))
    && !isRedditStory(story)
    && hasRenderableStoryCopy(story);
}

function filterDisplayableStories(stories = []) {
  return dedupeStories(stories).filter(isDisplayableStory);
}

function sortStoriesForLatest(stories = []) {
  return [...stories].sort((a, b) => {
    const injectedDiff = new Date(getDisplayTimestamp(b)).getTime()
      - new Date(getDisplayTimestamp(a)).getTime();
    if (injectedDiff !== 0) return injectedDiff;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function sortStoriesForTrending(stories = [], mode = "trending") {
  return [...stories].sort((a, b) => {
    if (mode === "just-in") {
      const timeDiff = new Date(getDisplayTimestamp(b)).getTime()
        - new Date(getDisplayTimestamp(a)).getTime();
      if (timeDiff !== 0) return timeDiff;
    }

    const trendingDiff = Number(b.trendingScore || 0) - Number(a.trendingScore || 0);
    if (trendingDiff !== 0) return trendingDiff;
    const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    const engagementDiff = Number(b.engagementScore || 0) - Number(a.engagementScore || 0);
    if (engagementDiff !== 0) return engagementDiff;
    return new Date(getDisplayTimestamp(b)).getTime()
      - new Date(getDisplayTimestamp(a)).getTime();
  });
}

function selectHeadlineOfTheDay(articles = []) {
  const eligibleArticles = filterDisplayableStories(articles);
  if (!eligibleArticles.length) return null;

  const todayKey = toDateKeyInTimezone(new Date().toISOString(), DISPLAY_TIMEZONE);
  const todaysArticles = eligibleArticles.filter((article) =>
    toDateKeyInTimezone(getDisplayTimestamp(article), DISPLAY_TIMEZONE) === todayKey
  );
  const todaysPriorityStories = todaysArticles.filter(isIndiaPriorityStory);
  const allPriorityStories = eligibleArticles.filter(isIndiaPriorityStory);
  const pool = todaysPriorityStories.length
    ? todaysPriorityStories
    : todaysArticles.length
      ? todaysArticles
      : allPriorityStories.length
        ? allPriorityStories
        : eligibleArticles;
  const ranked = [...pool].sort(compareHomepagePriority);
  const candidates = ranked.slice(0, Math.min(HERO_ROTATION_POOL_SIZE, ranked.length));
  if (candidates.length && candidates.some(isIndiaPriorityStory)) {
    return candidates[0];
  }
  let lastHeroKey = "";

  try {
    lastHeroKey = window.localStorage.getItem(LAST_HERO_STORAGE_KEY) || "";
  } catch (_) {
    lastHeroKey = "";
  }

  const eligible = candidates.filter((story) => storyKey(story) !== lastHeroKey);
  const rotationPool = eligible.length ? eligible : candidates;
  const selected = rotationPool[Math.floor(Math.random() * rotationPool.length)] || ranked[0] || null;

  if (selected) {
    try {
      window.localStorage.setItem(LAST_HERO_STORAGE_KEY, storyKey(selected));
    } catch (_) {
      // Ignore storage access issues and still return a headline candidate.
    }
  }

  return selected;
}

function takeUnique(stories = [], used = new Set(), count = 0, fallbackStories = []) {
  const picked = [];
  const localSeen = new Set();

  [...stories, ...fallbackStories].forEach((story) => {
    if (picked.length >= count) return;
    const key = storyKey(story);
    if (!key || used.has(key) || localSeen.has(key)) return;
    localSeen.add(key);
    used.add(key);
    picked.push(story);
  });

  return picked;
}

function buildGlobalLayout(mainStories = [], categoryMap = {}) {
  const used = new Set();
  const filteredMainStories = filterDisplayableStories(mainStories);
  const latestPool = dedupeStories(sortStoriesForLatest(filteredMainStories));
  const allStories = filterDisplayableStories([
    ...mainStories,
    ...CATEGORY_KEYS.flatMap((key) => categoryMap[key] || []),
  ]);
  const homepagePriorityPool = dedupeStories(sortStoriesForHomepageFocus(allStories));
  const hero = selectHeadlineOfTheDay(homepagePriorityPool.length ? homepagePriorityPool : latestPool) || latestPool[0] || null;
  if (hero) used.add(storyKey(hero));

  const trendingSourcePool = dedupeStories([
    ...homepagePriorityPool,
    ...sortStoriesForTrending(filteredMainStories, activeTrendingMode),
  ]);
  const trending = takeUnique(trendingSourcePool, used, TRENDING_COUNT, latestPool);
  const topSections = ["ai", "tech"].map((key) => ({
    key,
    title: toTitleCase(key),
    eyebrow: CATEGORY_EYEBROWS[key] || "Category desk",
    filter: key,
    layout: "rail",
    stories: takeUnique(
      filterDisplayableStories([
        ...(categoryMap[key] || []),
        ...filteredMainStories.filter((story) => story.category === key),
      ]),
      used,
      CATEGORY_RAIL_COUNT,
      latestPool
    ),
  })).filter((section) => section.stories.length);

  const moreSections = [
    {
      key: "latest-news",
      title: "Latest News",
      eyebrow: "Rapid read",
      filter: "latest",
      stories: takeUnique(sortStoriesForLatest(filteredMainStories), used, MORE_SECTION_COUNT, latestPool),
    },
    {
      key: "entertainment-wire",
      title: "Entertainment",
      eyebrow: "Culture and releases",
      filter: "entertainment",
      stories: takeUnique(filterDisplayableStories(categoryMap.entertainment || []), used, MORE_SECTION_COUNT, latestPool),
    },
    {
      key: "sports-wire",
      title: "Sports",
      eyebrow: "Matches and momentum",
      filter: "sports",
      stories: takeUnique(filterDisplayableStories(categoryMap.sports || []), used, MORE_SECTION_COUNT, latestPool),
    },
    {
      key: "business-wire",
      title: "Business",
      eyebrow: "Markets and money",
      filter: "business",
      stories: takeUnique(filterDisplayableStories(categoryMap.business || []), used, MORE_SECTION_COUNT, latestPool),
    },
  ].filter((section) => section.stories.length);

  return { hero, trending, topSections, moreSections };
}

function buildFocusedLayout(stories = [], filter = "all") {
  const renderableStories = filterDisplayableStories(stories);
  const latestPool = dedupeStories(sortStoriesForLatest(renderableStories));
  const focusedPool = filter === "india-pulse"
    ? dedupeStories(sortStoriesForHomepageFocus(renderableStories.filter(isIndiaPriorityStory)))
    : filter === "war-conflict"
      ? dedupeStories(sortStoriesForTrending(renderableStories.filter(isWarRelatedStory), "just-in"))
      : filter === "politics"
        ? dedupeStories(sortStoriesForTrending(renderableStories.filter(isPoliticsRelatedStory), "just-in"))
        : filter === "startups-funding"
          ? dedupeStories(sortStoriesForTrending(renderableStories.filter(isBusinessFocusStory), "just-in"))
    : latestPool;
  const deskStories = focusedPool.length ? focusedPool : latestPool;
  const hero = selectHeadlineOfTheDay(deskStories) || deskStories[0] || null;
  const label = filter === "latest" ? "Latest" : activeDeskLabel();
  const trendingBase = filter === "india-pulse"
    ? sortStoriesForHomepageFocus(deskStories)
    : sortStoriesForTrending(deskStories, activeTrendingMode);
  const trending = trendingBase.slice(0, TRENDING_COUNT);
  const topSections = [
    {
      key: `${filter}-catalog`,
      title: filter === "india-pulse" ? "India Pulse" : `${label} Desk`,
      eyebrow: filter === "india-pulse"
        ? "Most searched and high-impact"
        : filter === "startups-funding"
          ? "Capital, founders and deals"
          : CATEGORY_EYEBROWS[filter] || "Category desk",
      filter,
      hideAction: true,
      layout: "catalog",
      cardVariant: "dense",
      stories: deskStories.slice(0, DESK_PAGE_SIZE),
    },
  ];

  const moreSections = [];

  return { hero, trending, topSections, moreSections };
}

function createSkeletonCard(variant = "") {
  const card = document.createElement("article");
  card.className = `news-card ${variant ? `news-card--${variant}` : ""}`;
  card.innerHTML = `
    <div class="news-card__media is-loading"></div>
    <div class="news-card__body">
      <div class="is-loading" style="height:18px;border-radius:10px;"></div>
      <div class="is-loading" style="height:18px;border-radius:10px;width:82%;"></div>
      <div class="is-loading" style="height:14px;border-radius:10px;width:58%;"></div>
    </div>
  `;
  return card;
}

function renderLoadingState() {
  pendingTopSections = [];
  if (topSectionsObserver) {
    topSectionsObserver.disconnect();
    topSectionsObserver = null;
  }

  headlineOfTheDayLink.textContent = "Loading headline...";
  headlineOfTheDayLink.href = "/";
  heroSummaryEl.textContent = "Preparing the latest stories across every SunWire desk.";
  headlineOfTheDayMeta.textContent = "Loading publish time";
  heroAuthorEl.textContent = "SunWire Desk";
  heroDeskChip.textContent = activeDeskLabel();
  applyResponsiveImage(heroImageEl, buildFallbackImage({ category: "tech", title: "SunWire Live Signal" }), {
    alt: "SunWire loading state",
    width: 1600,
    height: 900,
    sizes: "(max-width: 1050px) 100vw, 66vw",
    highPriority: true,
  });

  trendingGridEl.innerHTML = "";
  categorySectionsGridEl.innerHTML = "";
  moreNewsGridEl.innerHTML = "";

  for (let i = 0; i < 4; i += 1) trendingGridEl.appendChild(createSkeletonCard("compact"));

  for (let i = 0; i < 4; i += 1) {
    const panel = sectionPanelTemplate.content.firstElementChild.cloneNode(true);
    panel.classList.add("content-visibility");
    panel.querySelector(".desk-panel__eyebrow").textContent = "Loading";
    panel.querySelector(".desk-panel__title").textContent = "Loading stories";
    panel.querySelector(".desk-panel__action").hidden = true;
    const grid = panel.querySelector(".desk-panel__grid");
    grid.classList.add("desk-panel__grid--rail");
    for (let j = 0; j < CATEGORY_RAIL_COUNT; j += 1) grid.appendChild(createSkeletonCard("dense"));
    categorySectionsGridEl.appendChild(panel);
  }
}

function renderTicker(stories = []) {
  const headlines = stories
    .slice(0, 10)
    .map((story) => `BREAKING: ${optimizeHeadline(story.title, "compact")}`)
    .join("    ");
  tickerTrack.textContent = headlines ? `${headlines}    ${headlines}` : "BREAKING: SpaceX Announces Starship Flight 4 for June 7";
}

function renderHero(story) {
  if (!story) {
    headlineOfTheDayLink.textContent = "No headline available yet.";
    headlineOfTheDayLink.href = "/";
    heroSummaryEl.textContent = "Fresh AI, tech, entertainment, sports, and business stories are loading.";
    headlineOfTheDayMeta.textContent = "Waiting for fresh stories.";
    heroAuthorEl.textContent = "SunWire Desk";
    heroDeskChip.textContent = activeDeskLabel();
    applyResponsiveImage(heroImageEl, buildFallbackImage({ category: "tech", title: "SunWire Live Signal" }), {
      alt: "SunWire lead story",
      width: 1600,
      height: 900,
      sizes: "(max-width: 1050px) 100vw, 66vw",
      highPriority: true,
    });
    return;
  }

  headlineOfTheDayLink.textContent = optimizeHeadline(story.title, "hero");
  headlineOfTheDayLink.href = buildArticleHref(story);
  heroSummaryEl.textContent = optimizeSummary(story.summary || "", story, "hero");
  headlineOfTheDayMeta.textContent = fmtDate(getDisplayTimestamp(story));
  heroAuthorEl.textContent = story.source || "SunWire Desk";
  heroDeskChip.textContent = categoryLabel(story);
  applyResponsiveImage(heroImageEl, storyImage(story), {
    alt: story.title || "Headline of the day",
    width: 1600,
    height: 900,
    sizes: "(max-width: 1050px) 100vw, 66vw",
    highPriority: true,
  });
}

function createNewsCard(story, variant = "standard") {
  const card = newsCardTemplate.content.firstElementChild.cloneNode(true);
  card.classList.add(`news-card--${variant}`);

  const mediaLink = card.querySelector(".news-card__media");
  const image = card.querySelector(".news-card__image");
  const tag = card.querySelector(".news-card__tag");
  const headlineLink = card.querySelector(".news-card__headlineLink");
  const headline = card.querySelector(".news-card__headline");
  const summary = card.querySelector(".news-card__summary");
  const timeEl = card.querySelector(".news-card__time");
  const sourceEl = card.querySelector(".news-card__source");
  const href = buildArticleHref(story);

  mediaLink.href = href;
  headlineLink.href = href;
  applyResponsiveImage(image, storyImage(story), {
    alt: story.title || "SunWire story image",
    width: 1600,
    height: variant === "standard" ? 1000 : 900,
    sizes: variant === "compact"
      ? "(max-width: 900px) 100vw, 24vw"
      : variant === "dense"
        ? "(max-width: 900px) 100vw, 48vw"
        : "(max-width: 900px) 100vw, 30vw",
  });
  tag.textContent = categoryLabel(story);
  headline.textContent = optimizeHeadline(story.title, variant === "compact" ? "compact" : "card");
  summary.textContent = optimizeSummary(story.summary || "", story);
  timeEl.textContent = timeAgo(getDisplayTimestamp(story));
  sourceEl.textContent = story.source || "SunWire";

  return card;
}

function renderTrendingSection(stories = []) {
  trendingGridEl.innerHTML = "";
  if (!stories.length) {
    trendingGridEl.innerHTML = "<p>No trending stories available right now.</p>";
    trendingUpdatedAtEl.textContent = "Updated just now";
    return;
  }

  stories.forEach((story) => trendingGridEl.appendChild(createNewsCard(story, "compact")));
  trendingUpdatedAtEl.textContent = `Updated ${timeAgo(getDisplayTimestamp(stories[0]))}`;
}

function renderDeskPanels(container, sections = [], variant = "dense") {
  container.innerHTML = "";

  sections
    .filter((section) => Array.isArray(section?.stories) && section.stories.length)
    .forEach((section) => {
      const panel = sectionPanelTemplate.content.firstElementChild.cloneNode(true);
      panel.classList.add("content-visibility");
      panel.querySelector(".desk-panel__eyebrow").textContent = section.eyebrow || "Coverage";

      const title = panel.querySelector(".desk-panel__title");
      title.textContent = section.title || "Stories";

      const openSection = async () => {
        if (!section.filter || isLoading) return;
        siteHeader.classList.remove("is-open");
        await openDeskInPlace(section.filter);
        window.scrollTo({ top: 0, behavior: "smooth" });
      };

      const action = panel.querySelector(".desk-panel__action");
      action.hidden = true;
      if (!section.hideAction && section.filter) {
        title.classList.add("desk-panel__title--interactive");
        title.tabIndex = 0;
        title.setAttribute("role", "link");
        title.addEventListener("click", openSection);
        title.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          openSection();
        });
      }

      const grid = panel.querySelector(".desk-panel__grid");
      if (section.layout === "rail") {
        grid.classList.add("desk-panel__grid--rail");
      }
      if (section.layout === "catalog") {
        grid.classList.add("desk-panel__grid--catalog");
      }

      const cardVariant = section.cardVariant || variant;
      section.stories.forEach((story) => grid.appendChild(createNewsCard(story, cardVariant)));
      container.appendChild(panel);
    });
}

function renderPendingTopSections() {
  if (!categorySectionsGridEl) return;
  if (!pendingTopSections.length) {
    categorySectionsGridEl.innerHTML = "";
    return;
  }
  renderDeskPanels(categorySectionsGridEl, pendingTopSections, pendingTopSectionsVariant);
}

function scheduleTopSectionsRender(sections = [], variant = "dense") {
  pendingTopSections = sections;
  pendingTopSectionsVariant = variant;

  if (!categoryZoneSectionEl || categoryZoneSectionEl.hidden || !sections.length) {
    if (topSectionsObserver) {
      topSectionsObserver.disconnect();
      topSectionsObserver = null;
    }
    renderPendingTopSections();
    return;
  }

  if (isElementNearViewport(categoryZoneSectionEl, 280)) {
    renderPendingTopSections();
    return;
  }

  if (!topSectionsObserver) {
    topSectionsObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      renderPendingTopSections();
      topSectionsObserver.disconnect();
      topSectionsObserver = null;
    }, { rootMargin: "280px 0px" });
  }

  topSectionsObserver.disconnect();
  topSectionsObserver.observe(categoryZoneSectionEl);
}

async function hydrateSidebar(forceRefresh = false) {
  if (!homepageSidebarEl) return;
  if (sidebarHydrationPromise && !forceRefresh) return sidebarHydrationPromise;

  sidebarHydrationPromise = (async () => {
    const widgets = await loadHomeWidgetsModule();
    if (forceRefresh || !pendingSidebarPayload) {
      try {
        pendingSidebarPayload = await fetchSidebarData(forceRefresh);
      } catch (_) {
        pendingSidebarPayload = pendingSidebarPayload || {};
      }
    }

    widgets.renderSidebarData({
      toolNameEl,
      toolUseEl,
      toolLinkEl,
      eventsListEl,
      priceBoardMetaEl,
      priceBoardListEl,
      priceBoardSourcesEl,
    }, pendingSidebarPayload || {});
  })().finally(() => {
    sidebarHydrationPromise = null;
  });

  return sidebarHydrationPromise;
}

function scheduleSidebarHydration({ forceRefresh = false } = {}) {
  if (!homepageSidebarEl) return;

  if (forceRefresh) pendingSidebarPayload = null;

  if (isElementNearViewport(homepageSidebarEl, 220)) {
    void hydrateSidebar(forceRefresh);
    return;
  }

  if (!sidebarObserver) {
    sidebarObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      void hydrateSidebar(false);
      sidebarObserver.disconnect();
      sidebarObserver = null;
    }, { rootMargin: "220px 0px" });
  }

  sidebarObserver.disconnect();
  sidebarObserver.observe(homepageSidebarEl);
}

function renderStats(visibleCount) {
  livePulseText.textContent = currentStories[0]
    ? `${activeDeskLabel()} updated ${timeAgo(getDisplayTimestamp(currentStories[0]))}`
    : "Scanning the live wire";
  if (liveStatPrimary) liveStatPrimary.textContent = `${visibleCount} stories on this page`;
  if (liveStatSecondary) liveStatSecondary.textContent = "Live desks updated";
}

function renderPagination(totalPagesCount, activePageNumber) {
  if (!paginationEl) return;
  paginationEl.innerHTML = "";
  const pages = Math.max(1, totalPagesCount);
  const fragment = document.createDocumentFragment();

  const addButton = ({ label, page, disabled = false, isActive = false, isNav = false }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `page-btn${isActive ? " is-active" : ""}${disabled ? " is-disabled" : ""}${isNav ? " page-btn--nav" : ""}`;
    btn.textContent = label;
    if (!disabled) {
      btn.addEventListener("click", async () => {
        if (page === currentPage || isLoading) return;
        updateBrowserUrl({ filter: activeFilter, query: activeSearchQuery, page });
        await loadStories(page);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
    fragment.appendChild(btn);
  };

  addButton({ label: "Previous", page: Math.max(1, activePageNumber - 1), disabled: activePageNumber === 1, isNav: true });

  const windowSize = 4;
  const start = Math.max(1, activePageNumber - 1);
  const end = Math.min(pages, start + windowSize - 1);
  const pageStart = Math.max(1, end - windowSize + 1);

  for (let page = pageStart; page <= end; page += 1) {
    addButton({ label: String(page), page, isActive: page === activePageNumber });
  }

  addButton({ label: "Next", page: Math.min(pages, activePageNumber + 1), disabled: activePageNumber === pages, isNav: true });
  paginationEl.appendChild(fragment);
}

function updateActiveDeskChip() {
  if (activeSearchQuery) {
    activeDeskChip.textContent = "Search";
    showAllButton.textContent = "Clear Search";
    showAllButton.disabled = isLoading;
    return;
  }

  const label = activeDeskLabel();
  activeDeskChip.textContent = label;
  showAllButton.textContent = activeFilter === "all" ? "Showing All" : "Show All";
  showAllButton.disabled = activeFilter === "all" || isLoading;
}

function syncActiveControls() {
  const searchIsOpen = siteHeader.classList.contains("is-search-open");
  navLinks.forEach((link) => {
    const isActive = !activeSearchQuery
      && activeFilter !== "all"
      && link.dataset.navFilter === activeFilter;
    link.classList.toggle("is-active", isActive);
  });

  trendingModeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.trendingMode === activeTrendingMode);
  });

  menuToggle.setAttribute("aria-expanded", String(siteHeader.classList.contains("is-open")));
  searchButton.classList.toggle("is-active", searchIsOpen || Boolean(activeSearchQuery));
  searchButton.setAttribute("aria-expanded", String(searchIsOpen));
  syncSearchAuxiliaryControls();
  updateActiveDeskChip();
}

async function fetchJson(url, { forceFresh = false } = {}) {
  const cacheKey = url;
  const cached = !forceFresh ? apiResponseCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const separator = url.includes("?") ? "&" : "?";
  const requestUrl = forceFresh ? `${url}${separator}_ts=${Date.now()}` : url;
  const promise = fetch(requestUrl, { cache: forceFresh ? "no-store" : "default" })
    .then((response) => {
      if (!response.ok) throw new Error(`Request failed for ${url}`);
      return response.json();
    })
    .catch((error) => {
      apiResponseCache.delete(cacheKey);
      throw error;
    });

  if (!forceFresh) {
    apiResponseCache.set(cacheKey, {
      expiresAt: Date.now() + API_RESPONSE_TTL_MS,
      promise,
    });
  }

  return promise;
}

async function fetchSidebarData(forceRefresh = false) {
  return fetchJson("/api/sidebar", { forceFresh: forceRefresh });
}

function buildNewsApiUrl(params = new URLSearchParams()) {
  const isLocalHost = window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1";
  const baseUrl = isLocalHost
    ? "http://127.0.0.1:4000/api/news"
    : "/api/news";
  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

async function fetchCentralNews(page = 1, filter = "all", pageSize = getPageSizeForFilter(filter), forceRefresh = false) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    filter: resolveFilter(filter),
  });
  if (forceRefresh) params.set("refresh", "1");
  const payload = await fetchJson(buildNewsApiUrl(params), { forceFresh: forceRefresh });
  return normalizeNewsPayload(payload);
}

function createEmptyCategoryMap() {
  return CATEGORY_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});
}

function buildHomepageCategoryMapFromStories(stories = []) {
  const categoryMap = createEmptyCategoryMap();
  const filteredStories = filterDisplayableStories(stories);

  CATEGORY_KEYS.forEach((key) => {
    categoryMap[key] = dedupeStories(
      filteredStories.filter((story) => String(story.category || "").toLowerCase() === key)
    );
  });

  return categoryMap;
}

async function fetchHomepageCategoryMap(forceRefresh = false) {
  const poolPayload = await fetchCentralNews(1, "all", CATEGORY_POOL_FETCH_SIZE, forceRefresh);
  return buildHomepageCategoryMapFromStories(extractNewsStories(poolPayload));
}

function buildHomepageDataFromPool(poolPayload = {}, page = 1) {
  const safePage = Math.max(1, Number(page) || 1);
  const pooledStories = dedupeStories(extractNewsStories(poolPayload));
  const totalStories = Number(poolPayload?.totalStories) || Number(poolPayload?.total) || pooledStories.length;
  const totalPages = Math.max(1, Math.ceil(Math.max(1, totalStories) / DEFAULT_HOME_PAGE_SIZE));
  const clampedPage = Math.min(safePage, totalPages);
  const startIndex = (clampedPage - 1) * DEFAULT_HOME_PAGE_SIZE;
  const pageStories = pooledStories.slice(startIndex, startIndex + DEFAULT_HOME_PAGE_SIZE);

  return {
    main: {
      ...poolPayload,
      page: clampedPage,
      pageSize: DEFAULT_HOME_PAGE_SIZE,
      totalStories,
      totalPages,
      stories: pageStories,
      articles: pageStories,
      pageStories,
    },
    mainStories: pageStories,
    categoryMap: buildHomepageCategoryMapFromStories(pooledStories),
  };
}

async function fetchAllStoriesForSearch(forceRefresh = false) {
  const cacheIsFresh = !forceRefresh
    && Array.isArray(searchIndexCache.stories)
    && searchIndexCache.stories.length
    && Date.now() - searchIndexCache.fetchedAt < SEARCH_CACHE_TTL_MS;

  if (cacheIsFresh) return searchIndexCache.stories;

  const firstPage = await fetchCentralNews(1, "all", SEARCH_FETCH_PAGE_SIZE, forceRefresh);
  const totalPagesCount = Math.max(1, Number(firstPage?.totalPages) || 1);
  const collectedStories = [...extractNewsStories(firstPage)];

  if (totalPagesCount > 1) {
    const remainingPages = await Promise.all(
      Array.from({ length: totalPagesCount - 1 }, (_, index) =>
        fetchCentralNews(index + 2, "all", SEARCH_FETCH_PAGE_SIZE, forceRefresh).catch(() => ({ stories: [], articles: [] }))
      )
    );
    collectedStories.push(...remainingPages.flatMap((payload) => extractNewsStories(payload)));
  }

  const dedupedStories = dedupeStories(collectedStories);
  searchIndexCache = {
    stories: dedupedStories,
    fetchedAt: Date.now(),
  };
  return dedupedStories;
}

function applyHomepagePayload(main, mainStories, categoryMap) {
  const safeCategoryMap = createEmptyCategoryMap();
  CATEGORY_KEYS.forEach((key) => {
    safeCategoryMap[key] = filterDisplayableStories(categoryMap[key] || []);
  });

  const filteredMainStories = filterDisplayableStories(mainStories);
  const combinedStories = filterDisplayableStories([
    ...filteredMainStories,
    ...CATEGORY_KEYS.flatMap((key) => safeCategoryMap[key] || []),
  ]);

  currentStories = filteredMainStories;
  currentCategoryMap = safeCategoryMap;
  currentPage = Number(main?.page) || currentPage;
  totalPages = Math.max(1, Number(main?.totalPages) || 1);
  totalStories = Math.max(filteredMainStories.length, Number(main?.totalStories) || filteredMainStories.length);

  const layout = activeFilter === "all" || activeFilter === "latest"
    ? buildGlobalLayout(filteredMainStories, safeCategoryMap)
    : buildFocusedLayout(filteredMainStories, activeFilter);

  renderTicker(sortStoriesForTrending(combinedStories, activeTrendingMode));
  renderHomepageLayout(layout);
  scheduleSidebarHydration();
  renderPagination(totalPages, currentPage);
  syncHomeSeo();
}

function renderCurrentStories() {
  if (activeSearchQuery) {
    renderSearchResults(activeSearchQuery, currentStories);
    return;
  }

  applyHomepagePayload(
    { page: currentPage, totalPages, totalStories },
    currentStories,
    currentCategoryMap
  );
}

function countVisibleStories(layout = {}) {
  const visibleKeys = new Set();
  [layout.hero, ...(layout.trending || [])]
    .filter(Boolean)
    .forEach((story) => visibleKeys.add(storyKey(story)));

  [...(layout.topSections || []), ...(layout.moreSections || [])].forEach((section) => {
    (section.stories || []).forEach((story) => visibleKeys.add(storyKey(story)));
  });

  return visibleKeys.size;
}

function renderHomepageLayout(layout) {
  const hasTopSections = Array.isArray(layout?.topSections) && layout.topSections.length > 0;
  const hasMoreSections = Array.isArray(layout?.moreSections) && layout.moreSections.length > 0;
  const isFocusedDeskView = activeFilter !== "all" && activeFilter !== "latest";

  if (categoryZoneSectionEl) categoryZoneSectionEl.hidden = !hasTopSections;
  if (moreNewsSectionEl) moreNewsSectionEl.hidden = !hasMoreSections;
  if (paginationShellEl) paginationShellEl.hidden = true;
  categorySectionsGridEl.classList.toggle("desk-panels--focused", isFocusedDeskView);
  if (categoryNewsTitleEl) {
    categoryNewsTitleEl.textContent = activeFilter === "all" || activeFilter === "latest"
      ? "Category News Grid"
      : `${activeDeskLabel()} Desk`;
  }

  renderHero(layout.hero);
  renderTrendingSection(layout.trending || []);
  scheduleTopSectionsRender(layout.topSections || [], "dense");
  renderDeskPanels(moreNewsGridEl, layout.moreSections || [], "dense");
  renderStats(countVisibleStories(layout));
}

function renderSearchResults(query = "", stories = [], layout = null) {
  const normalizedQuery = cleanText(query);
  const resolvedLayout = layout || {
    hero: stories[0] || null,
    trending: stories.slice(1, TRENDING_COUNT + 1),
    topSections: [],
    moreSections: [],
  };
  const hasResults = Array.isArray(stories) && stories.length > 0;

  if (categoryZoneSectionEl) categoryZoneSectionEl.hidden = !hasResults;
  if (moreNewsGridEl) moreNewsGridEl.innerHTML = "";
  if (moreNewsSectionEl) moreNewsSectionEl.hidden = true;
  if (paginationShellEl) paginationShellEl.hidden = true;
  categorySectionsGridEl.classList.add("desk-panels--focused");
  if (categoryNewsTitleEl) categoryNewsTitleEl.textContent = hasResults
    ? `Results for "${normalizedQuery}"`
    : "Search Results";

  if (hasResults) {
    renderTicker(stories);
    renderHero(resolvedLayout.hero);
    renderTrendingSection(resolvedLayout.trending);
    scheduleTopSectionsRender(resolvedLayout.topSections, "dense");
    scheduleSidebarHydration();
    livePulseText.textContent = `${stories.length} ${stories.length === 1 ? "story" : "stories"} matched "${normalizedQuery}"`;
    if (liveStatPrimary) liveStatPrimary.textContent = `${stories.length} search results`;
    if (liveStatSecondary) liveStatSecondary.textContent = "Across all desks";
    syncHomeSeo();
    return;
  }

  renderTicker([]);
  headlineOfTheDayLink.textContent = `No results for "${normalizedQuery}"`;
  headlineOfTheDayLink.href = "/";
  heroSummaryEl.textContent = "Try a different keyword to search across AI, tech, entertainment, sports, and business coverage.";
  headlineOfTheDayMeta.textContent = "Search all desks";
  heroAuthorEl.textContent = "SunWire Search";
  heroDeskChip.textContent = "Search";
  applyResponsiveImage(heroImageEl, buildFallbackImage({ category: "news", title: normalizedQuery }), {
    alt: `No search results for ${normalizedQuery}`,
    width: 1600,
    height: 900,
    sizes: "(max-width: 1050px) 100vw, 66vw",
    highPriority: true,
  });
  trendingGridEl.innerHTML = `<p>No stories matched "${escapeHtml(normalizedQuery)}".</p>`;
  scheduleTopSectionsRender([], "dense");
  scheduleSidebarHydration();
  livePulseText.textContent = `No results for "${normalizedQuery}"`;
  if (liveStatPrimary) liveStatPrimary.textContent = "0 search results";
  if (liveStatSecondary) liveStatSecondary.textContent = "Try another keyword";
  syncHomeSeo();
}

async function loadSidebar(forceRefresh = false) {
  scheduleSidebarHydration({ forceRefresh });
}

async function loadStories(page = 1, forceRefresh = false) {
  if (isLoading) return;
  isLoading = true;
  const requestId = ++activeLoadRequestId;
  const requestedFilter = activeFilter;
  const normalizedFilter = String(requestedFilter || "all").toLowerCase();
  syncActiveControls();
  renderLoadingState();

  try {
    if ((normalizedFilter === "all" || normalizedFilter === "latest") && page <= HOME_POOL_PAGE_COVERAGE) {
      const poolPayload = await fetchCentralNews(1, "all", CATEGORY_POOL_FETCH_SIZE, forceRefresh);
      if (requestId !== activeLoadRequestId) return;
      const derivedHomepageData = buildHomepageDataFromPool(poolPayload, page);
      applyHomepagePayload(
        derivedHomepageData.main,
        derivedHomepageData.mainStories,
        derivedHomepageData.categoryMap
      );
      return;
    }

    const categoryMapPromise = normalizedFilter === "all" || normalizedFilter === "latest"
      ? fetchHomepageCategoryMap(forceRefresh).catch(() => null)
      : null;
    const main = await fetchCentralNews(page, normalizedFilter, getPageSizeForFilter(normalizedFilter), forceRefresh);
    if (requestId !== activeLoadRequestId) return;

    const mainStories = dedupeStories(extractNewsStories(main));
    const initialCategoryMap = createEmptyCategoryMap();
    if (CATEGORY_KEYS.includes(normalizedFilter)) {
      initialCategoryMap[normalizedFilter] = mainStories;
    }

    applyHomepagePayload(main, mainStories, initialCategoryMap);

    if (categoryMapPromise) {
      const categoryMap = await categoryMapPromise;
      if (requestId !== activeLoadRequestId) return;
      if (categoryMap) applyHomepagePayload(main, mainStories, categoryMap);
    }
  } catch (_) {
    if (requestId !== activeLoadRequestId) return;
    currentStories = [];
    currentCategoryMap = createEmptyCategoryMap();
    currentPage = 1;
    totalPages = 1;
    totalStories = 0;
    renderTicker([]);
    renderHomepageLayout(buildFocusedLayout([], activeFilter));
    scheduleSidebarHydration();
    renderPagination(1, 1);
    if (liveStatPrimary) liveStatPrimary.textContent = "0 stories on this page";
    syncHomeSeo();
  } finally {
    if (requestId === activeLoadRequestId) {
      isLoading = false;
      syncActiveControls();
    }
  }
}

async function performSearch(query = "", { forceRefresh = false, shouldPushState = true } = {}) {
  const normalizedQuery = cleanText(query);

  if (!normalizedQuery) {
    activeSearchQuery = "";
    currentPage = 1;
    setSearchStatus("");
    clearSearchInput();
    setSearchOpenState(false);
    syncActiveControls();
    if (shouldPushState) updateBrowserUrl({ filter: activeFilter, query: "", page: 1 });
    await loadStories(1, forceRefresh);
    return;
  }

  if (isLoading) return;
  isLoading = true;
  const requestId = ++activeLoadRequestId;
  activeSearchQuery = normalizedQuery;
  currentPage = 1;
  totalPages = 1;
  totalStories = 0;
  currentCategoryMap = createEmptyCategoryMap();
  setSearchOpenState(true);
  if (headerSearchInput) headerSearchInput.value = normalizedQuery;
  setSearchStatus(`Searching all news for ${normalizedQuery}`);
  syncActiveControls();
  renderLoadingState();

  try {
    const universe = await fetchAllStoriesForSearch(forceRefresh);
    if (requestId !== activeLoadRequestId) return;

    const searchModule = await loadSearchModule();
    if (requestId !== activeLoadRequestId) return;
    const matchedStories = searchModule.findStoriesForQuery(universe, normalizedQuery, {
      cleanText,
      dedupeStories,
      getDisplayTimestamp,
    });
    const searchLayout = searchModule.buildSearchLayout(matchedStories, normalizedQuery, {
      cleanText,
      dedupeStories,
      trendingCount: TRENDING_COUNT,
    });
    currentStories = matchedStories;
    currentCategoryMap = createEmptyCategoryMap();
    currentPage = 1;
    totalPages = 1;
    totalStories = matchedStories.length;
    renderSearchResults(normalizedQuery, matchedStories, searchLayout);
    renderPagination(1, 1);
    setSearchStatus(`${matchedStories.length} ${matchedStories.length === 1 ? "result" : "results"} for ${normalizedQuery}`);
    if (shouldPushState) updateBrowserUrl({ filter: activeFilter, query: normalizedQuery, page: 1 });
  } catch (_) {
    if (requestId !== activeLoadRequestId) return;
    currentStories = [];
    currentCategoryMap = createEmptyCategoryMap();
    currentPage = 1;
    totalPages = 1;
    totalStories = 0;
    renderSearchResults(normalizedQuery, []);
    renderPagination(1, 1);
    setSearchStatus(`No results available for ${normalizedQuery}`);
  } finally {
    if (requestId === activeLoadRequestId) {
      isLoading = false;
      syncActiveControls();
    }
  }
}

menuToggle.addEventListener("click", () => {
  siteHeader.classList.toggle("is-open");
  syncActiveControls();
});

navLinks.forEach((link) => {
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    const nextFilter = link.dataset.navFilter || "all";
    if (isLoading || nextFilter === activeFilter) {
      siteHeader.classList.remove("is-open");
      syncActiveControls();
      return;
    }

    siteHeader.classList.remove("is-open");
    await openDeskInPlace(nextFilter);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

trendingModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextMode = button.dataset.trendingMode || "trending";
    if (nextMode === activeTrendingMode) return;
    activeTrendingMode = nextMode;
    syncActiveControls();
    if (currentStories.length) renderCurrentStories();
  });
});

showAllButton.addEventListener("click", async () => {
  if (activeSearchQuery) {
    await performSearch("", { shouldPushState: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if (isLoading || activeFilter === "all") return;
  await openDeskInPlace("all");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

homeRefreshBtn.addEventListener("click", async () => {
  if (isLoading) return;
  searchIndexCache = { stories: [], fetchedAt: 0 };
  apiResponseCache.clear();
  await Promise.allSettled([
    activeSearchQuery
      ? performSearch(activeSearchQuery, { forceRefresh: true })
      : loadStories(1, true),
    loadSidebar(true),
  ]);
});

searchButton.addEventListener("click", () => {
  const isOpen = siteHeader.classList.contains("is-search-open");
  if (!isOpen) {
    setSearchOpenState(true);
    if (headerSearchInput) {
      headerSearchInput.value = activeSearchQuery || "";
      headerSearchInput.focus();
      headerSearchInput.select();
    }
    syncActiveControls();
    return;
  }

  if (cleanText(headerSearchInput?.value || activeSearchQuery)) {
    headerSearchForm?.requestSubmit();
    return;
  }

  setSearchOpenState(false);
  setSearchStatus("");
  syncActiveControls();
});

searchButton.addEventListener("pointerenter", () => {
  void loadSearchModule();
}, { once: true });

headerSearchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isLoading) return;
  await performSearch(headerSearchInput?.value || "", { shouldPushState: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
});

headerSearchClear?.addEventListener("click", async () => {
  if (isLoading) return;
  if (activeSearchQuery || cleanText(headerSearchInput?.value || "")) {
    await performSearch("", { shouldPushState: true });
  } else {
    setSearchOpenState(false);
    setSearchStatus("");
    syncActiveControls();
  }
});

headerSearchInput?.addEventListener("keydown", async (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (activeSearchQuery || cleanText(headerSearchInput.value || "")) {
    await performSearch("", { shouldPushState: true });
    return;
  }
  setSearchOpenState(false);
  syncActiveControls();
});

headerSearchInput?.addEventListener("input", () => {
  syncSearchAuxiliaryControls();
});

headerSearchInput?.addEventListener("focus", () => {
  void loadSearchModule();
}, { once: true });

document.addEventListener("click", (event) => {
  if (!siteHeader.contains(event.target)) {
    siteHeader.classList.remove("is-open");
    if (!activeSearchQuery && !cleanText(headerSearchInput?.value || "")) {
      setSearchOpenState(false);
      setSearchStatus("");
    }
    syncActiveControls();
  }
});

{
  const route = parseHomeRoute(window.location);
  activeFilter = route.filter;
  currentPage = route.page;
  activeSearchQuery = route.query;
  if (headerSearchInput && activeSearchQuery) {
    headerSearchInput.value = activeSearchQuery;
  }
}

syncActiveControls();
syncHomeSeo();
currentCategoryMap = createEmptyCategoryMap();
const preloadedHomeData = readPreloadedHomeData();
if (preloadedHomeData && !activeSearchQuery) {
  currentStories = extractNewsStories(preloadedHomeData);
  currentCategoryMap = preloadedHomeData.categoryMap || createEmptyCategoryMap();
  currentPage = Math.max(1, Number(preloadedHomeData.page) || currentPage);
  totalPages = Math.max(1, Number(preloadedHomeData.totalPages) || 1);
  totalStories = Math.max(currentStories.length, Number(preloadedHomeData.totalStories) || currentStories.length);
  applyHomepagePayload(
    { page: currentPage, totalPages, totalStories },
    currentStories,
    currentCategoryMap
  );
} else {
  renderLoadingState();
  if (activeSearchQuery) {
    setSearchOpenState(true);
    performSearch(activeSearchQuery, { shouldPushState: false });
  } else {
    loadStories(currentPage);
  }
}
loadSidebar();
window.addEventListener("load", () => {
  scheduleIdleTask(() => {
    void loadHomeWidgetsModule();
    if (activeSearchQuery) void loadSearchModule();
  });
}, { once: true });
window.addEventListener("popstate", async () => {
  const route = parseHomeRoute(window.location);
  const previousFilter = activeFilter;
  const previousQuery = activeSearchQuery;
  const previousPage = currentPage;
  const resolvedFilter = route.filter;
  const nextQuery = route.query;
  const nextPage = route.page;
  if ((resolvedFilter === previousFilter && nextQuery === previousQuery && nextPage === previousPage) || isLoading) return;
  activeFilter = resolvedFilter;
  currentPage = nextPage;
  if (nextQuery) {
    if (headerSearchInput) headerSearchInput.value = nextQuery;
    await performSearch(nextQuery, { shouldPushState: false });
    return;
  }
  activeSearchQuery = "";
  clearSearchInput();
  setSearchStatus("");
  setSearchOpenState(false);
  syncActiveControls();
  syncHomeSeo();
  await loadStories(currentPage);
});
window.setInterval(() => {
  if (document.hidden) return;
  if (activeSearchQuery) {
    performSearch(activeSearchQuery, { shouldPushState: false });
    return;
  }
  loadStories(currentPage);
}, AUTO_REFRESH_MS);
window.setInterval(() => {
  if (!document.hidden) loadSidebar();
}, SIDEBAR_REFRESH_MS);
