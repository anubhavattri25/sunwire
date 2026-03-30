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
const authButton = document.getElementById("authButton");
const authStatus = document.getElementById("authStatus");
const authFeedback = document.getElementById("authFeedback");
const adminMenu = document.getElementById("adminMenu");
const adminMenuButton = document.getElementById("adminMenuButton");
const adminMenuPanel = document.getElementById("adminMenuPanel");
const adminMenuItems = [...document.querySelectorAll("[data-admin-target]")];
const headerSearchForm = document.getElementById("headerSearch");
const headerSearchInput = document.getElementById("headerSearchInput");
const headerSearchClear = document.getElementById("headerSearchClear");
const headerSearchStatus = document.getElementById("headerSearchStatus");
const showAllButton = document.getElementById("showAllButton");
const activeDeskChip = document.getElementById("activeDeskChip");
const heroDeskChip = document.getElementById("heroDeskChip");
const heroSectionEl = document.getElementById("heroSection");
const homeTopLayoutEl = document.querySelector(".home-top-layout");
const navLinks = [...document.querySelectorAll("[data-nav-filter]")];
const trendingModeButtons = [...document.querySelectorAll("[data-trending-mode]")];

const headlineOfTheDayLink = document.getElementById("headlineOfTheDayLink");
const headlineOfTheDayMeta = document.getElementById("headlineOfTheDayMeta");
const heroAuthorEl = document.getElementById("heroAuthor");
const heroSummaryEl = document.getElementById("heroSummary");
const heroMediaLinkEl = document.getElementById("heroMediaLink");
const heroImageEl = document.getElementById("heroImage");
const heroViewStoryEl = document.getElementById("heroViewStory");

const trendingGridEl = document.getElementById("trendingGrid");
const trendingSectionEl = trendingGridEl?.closest(".trending-strip");
const categorySectionsGridEl = document.getElementById("categorySectionsGrid");
const moreNewsGridEl = document.getElementById("moreNewsGrid");
const categoryZoneSectionEl = categorySectionsGridEl?.closest(".category-zone");
const moreNewsSectionEl = moreNewsGridEl?.closest(".more-news-shell");
const moreNewsSectionHeadEl = moreNewsSectionEl?.querySelector(".section-head");
const categoryNewsTitleEl = document.getElementById("categoryNewsTitle");
const moreNewsTitleEl = document.getElementById("moreNewsTitle");
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

const HOME_FIRST_PAGE_STORY_COUNT = 12;
const HOME_ARCHIVE_PAGE_SIZE = 16;
const DESK_PAGE_SIZE = 16;
const CATEGORY_GRID_STORY_COUNT = 4;
const CATEGORY_PREVIEW_FETCH_SIZE = 24;
const CATEGORY_POOL_FETCH_SIZE = 64;
const RANDOM_NEWS_COUNT = 16;
const TRENDING_COUNT = 4;
const HERO_ROTATION_POOL_SIZE = 6;
const LAST_HERO_STORAGE_KEY = "sunwire:last-hero-story-key";
const AUTO_REFRESH_MS = 20 * 60 * 1000;
const SIDEBAR_REFRESH_MS = 20 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_FETCH_PAGE_SIZE = 100;
const API_RESPONSE_TTL_MS = 5 * 60 * 1000;
const ARTICLE_CACHE_PREFIX = "sunwire-article-cache:v2:";
const DEFERRED_ASSET_VERSION = "20260331-15";
const ADMIN_DASHBOARD_ASSET_VERSION = "20260327-10";
const GOOGLE_AUTH_SESSION_STORAGE_KEY = "sunwire:google-auth-session:v1";
const GOOGLE_AUTH_ID_TOKEN_STORAGE_KEY = "sunwire:google-auth-id-token:v1";
const GOOGLE_AUTH_REQUEST_STORAGE_KEY = "sunwire:google-auth-request:v1";
const NEWSROOM_ROLE_STORAGE_KEY = "sunwire:newsroom-role:v1";
const AUTH_UI_OVERRIDE_STORAGE_KEY = "sunwire:auth-ui-override:v1";
const ADMIN_EMAIL = "anubhavattri07@gmail.com";
const FILTER_ALIASES = {
  all: "all",
  latest: "all",
  "india-pulse": "all",
  politics: "politics",
  "war-conflict": "all",
  "startups-funding": "all",
  ai: "ai",
  tech: "tech",
  entertainment: "entertainment",
  sports: "sports",
  business: "business",
  jobs: "jobs",
};
const CATEGORY_KEYS = ["ai", "tech", "entertainment", "sports", "business", "politics", "jobs"];
const TECH_DESK_SOURCE_PATTERNS = [
  /livemint tech/i,
  /indian express tech/i,
  /techpp/i,
  /india today technology/i,
  /the hindu technology/i,
];
const NON_TECH_TECH_DESK_PATTERNS = [
  /pinkvilla/i,
  /filmfare/i,
  /bollywood hungama/i,
  /koimoi/i,
  /india today entertainment/i,
];
const TECH_DESK_KEYWORDS = [
  "tech", "technology", "software", "hardware", "smartphone", "iphone", "android", "samsung",
  "apple", "google", "microsoft", "meta", "amazon", "chip", "chips", "chipset", "semiconductor",
  "cybersecurity", "cloud", "browser", "api", "app", "apps", "platform", "device", "devices",
  "gadget", "gadgets", "laptop", "tablet", "wearable", "startup", "saas", "ai", "artificial intelligence"
];
const NON_TECH_TECH_DESK_KEYWORDS = [
  "movie", "film", "box office", "actor", "actress", "celebrity", "bollywood", "hollywood",
  "trailer", "album", "music", "awards", "award", "kapoor", "ranveer", "janhvi", "karan johar"
];
const HOMEPAGE_SECTION_DEFINITIONS = [
  { key: "ai", title: "AI", eyebrow: "Models and agents", category: "ai", filter: "ai" },
  { key: "tech", title: "Tech", eyebrow: "Platforms and chips", category: "tech", filter: "tech" },
  { key: "entertainment", title: "Entertainment", eyebrow: "Culture and releases", category: "entertainment", filter: "entertainment" },
  { key: "sports", title: "Sports", eyebrow: "Matches and momentum", category: "sports", filter: "sports" },
  { key: "business", title: "Business", eyebrow: "Markets and money", category: "business", filter: "business" },
  { key: "politics", title: "Politics", eyebrow: "Power and policy", category: "politics", filter: "politics" },
  { key: "jobs", title: "Jobs", eyebrow: "Hiring and careers", category: "jobs", filter: "jobs" },
];
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
  politics: {
    title: "Politics News | Sunwire",
    description: "Latest politics news covering ministers, policy, elections, government, and power moves on Sunwire.",
  },
  jobs: {
    title: "Jobs News | Sunwire",
    description: "Latest jobs and hiring news covering recruitment, vacancies, careers, and government opportunities on Sunwire.",
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
const ECONOMY_KEYWORDS = [
  "economy", "economic", "inflation", "deflation", "gdp", "cpi", "ppi", "interest rate",
  "federal reserve", "fed", "rbi", "central bank", "treasury", "bond", "yield", "tariff",
  "trade", "oil", "crude", "currency", "rupee", "dollar", "unemployment", "growth", "recession",
  "markets", "market", "stocks", "shares", "sensex", "nifty", "nasdaq", "dow", "s&p"
];
const JOBS_KEYWORDS = [
  "job", "jobs", "hiring", "hire", "recruit", "recruiting", "layoff", "layoffs", "career",
  "careers", "workforce", "salary", "payroll", "headcount", "internship", "internships",
  "employee", "employees", "talent", "opening", "openings", "resume"
];
const FOOD_KEYWORDS = [
  "food", "restaurant", "restaurants", "dining", "chef", "menu", "cafe", "coffee", "tea",
  "recipe", "recipes", "cooking", "kitchen", "grocery", "groceries", "snack", "snacks",
  "beverage", "beverages", "drink", "drinks", "cuisine", "meals", "michelin"
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
const PLACEHOLDER_PALETTES = [
  { background: "1E3A8A", foreground: "F8FAFC" },
  { background: "7C2D12", foreground: "FFFBEB" },
  { background: "14532D", foreground: "F7FEE7" },
  { background: "581C87", foreground: "FAF5FF" },
  { background: "0F766E", foreground: "F0FDFA" },
  { background: "9A3412", foreground: "FFF7ED" },
  { background: "1F2937", foreground: "F9FAFB" },
  { background: "831843", foreground: "FFF1F2" },
];

let currentStories = [];
let currentCategoryMap = {};
const authUiOverride = readAuthUiOverride();
let serverInjectedAuthState = authUiOverride?.state === "logged-out"
  ? { user: null, role: "" }
  : readServerInjectedAuthState();
let googleAuthSession = authUiOverride?.state === "logged-out"
  ? null
  : (readGoogleAuthSession() || serverInjectedAuthState.user || null);
let googleAuthIdToken = readGoogleAuthIdToken();
let newsroomRole = authUiOverride?.state === "logged-out"
  ? ""
  : (
    readStoredNewsroomRole()
    || cleanText(serverInjectedAuthState.role || "").toLowerCase()
    || (isAdminUserEmail(googleAuthSession?.email || "") ? "admin" : "")
  );
let isAuthBusy = false;
let authBusyLabel = "";
let adminSessionPromise = null;
let lastAdminSessionVerifiedAt = serverInjectedAuthState.user && serverInjectedAuthState.role ? Date.now() : 0;
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
const articlePrefetchPromises = new Map();
const routePrefetchSet = new Set();
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

function readAuthUiOverride() {
  try {
    const raw = window.sessionStorage.getItem(AUTH_UI_OVERRIDE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = cleanText(parsed?.state || "");
    const expiresAt = Number(parsed?.expiresAt || 0);
    if (!state || (expiresAt && expiresAt <= Date.now())) {
      window.sessionStorage.removeItem(AUTH_UI_OVERRIDE_STORAGE_KEY);
      return null;
    }
    return { state, expiresAt };
  } catch (_) {
    return null;
  }
}

function setAuthUiOverride(state = "") {
  try {
    if (!state) {
      window.sessionStorage.removeItem(AUTH_UI_OVERRIDE_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(AUTH_UI_OVERRIDE_STORAGE_KEY, JSON.stringify({
      state: cleanText(state),
      expiresAt: Date.now() + 15000,
    }));
  } catch (_) {
    // Ignore storage failures during auth transitions.
  }
}

function readGoogleClientId() {
  return cleanText(
    window.__SUNWIRE_GOOGLE_CLIENT_ID__
    || authButton?.dataset?.googleClientId
    || document.documentElement?.dataset?.googleClientId
    || ""
  );
}

function readServerInjectedAuthState() {
  const payload = window.__SUNWIRE_AUTH_STATE__;
  if (!payload || typeof payload !== "object") {
    return { user: null, role: "" };
  }

  const email = cleanText(payload?.user?.email || payload?.email || "");
  return {
    user: email
      ? {
        email,
        name: cleanText(payload?.user?.name || payload?.name || ""),
        picture: cleanText(payload?.user?.picture || payload?.picture || ""),
      }
      : null,
    role: cleanText(payload?.role || "").toLowerCase(),
  };
}

function readGoogleAuthSession() {
  try {
    const raw = window.localStorage.getItem(GOOGLE_AUTH_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const email = cleanText(parsed?.email || "");
    if (!email) return null;
    return {
      email,
      name: cleanText(parsed?.name || ""),
      picture: cleanText(parsed?.picture || ""),
    };
  } catch (_) {
    return null;
  }
}

function readGoogleAuthIdToken() {
  try {
    const token = cleanText(window.localStorage.getItem(GOOGLE_AUTH_ID_TOKEN_STORAGE_KEY) || "");
    if (!token) return "";
    const payload = decodeJwtPayload(token);
    const expiresAt = Number(payload?.exp || 0) * 1000;
    if (expiresAt && expiresAt <= Date.now()) {
      window.localStorage.removeItem(GOOGLE_AUTH_ID_TOKEN_STORAGE_KEY);
      return "";
    }
    return token;
  } catch (_) {
    window.localStorage.removeItem(GOOGLE_AUTH_ID_TOKEN_STORAGE_KEY);
    return "";
  }
}

function readStoredNewsroomRole() {
  try {
    return cleanText(window.localStorage.getItem(NEWSROOM_ROLE_STORAGE_KEY) || "").toLowerCase();
  } catch (_) {
    window.localStorage.removeItem(NEWSROOM_ROLE_STORAGE_KEY);
    return "";
  }
}

function saveGoogleAuthSession(session = null) {
  if (!session?.email) {
    window.localStorage.removeItem(GOOGLE_AUTH_SESSION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    GOOGLE_AUTH_SESSION_STORAGE_KEY,
    JSON.stringify({
      email: cleanText(session.email),
      name: cleanText(session.name || ""),
      picture: cleanText(session.picture || ""),
    })
  );
}

function saveGoogleAuthIdToken(token = "") {
  const normalized = cleanText(token);
  googleAuthIdToken = normalized;
  if (!normalized) {
    window.localStorage.removeItem(GOOGLE_AUTH_ID_TOKEN_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(GOOGLE_AUTH_ID_TOKEN_STORAGE_KEY, normalized);
}

function setNewsroomRole(role = "") {
  newsroomRole = cleanText(role).toLowerCase();
  if (!newsroomRole) {
    window.localStorage.removeItem(NEWSROOM_ROLE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(NEWSROOM_ROLE_STORAGE_KEY, newsroomRole);
}

function isAdminUserEmail(email = "") {
  return cleanText(email).toLowerCase() === ADMIN_EMAIL;
}

function hasNewsroomAccess() {
  return newsroomRole === "admin" || newsroomRole === "submitter";
}

function hasFreshAdminSession() {
  return Boolean(lastAdminSessionVerifiedAt && (Date.now() - lastAdminSessionVerifiedAt) < 60 * 1000);
}

function markAdminSessionVerified() {
  lastAdminSessionVerifiedAt = Date.now();
}

function clearAdminSessionVerification() {
  lastAdminSessionVerifiedAt = 0;
}

function runWithAdminSessionLock(factory) {
  if (adminSessionPromise) return adminSessionPromise;
  const task = Promise.resolve()
    .then(() => factory())
    .finally(() => {
      if (adminSessionPromise === task) adminSessionPromise = null;
    });
  adminSessionPromise = task;
  return task;
}

function setAuthStatus(message = "") {
  if (authStatus) authStatus.textContent = cleanText(message);
}

function showAuthFeedback(message = "", tone = "info") {
  if (!authFeedback) return;
  const normalized = cleanText(message);
  authFeedback.hidden = !normalized;
  authFeedback.textContent = normalized;
  authFeedback.classList.remove("is-error", "is-success");
  if (!normalized) return;
  if (tone === "error") authFeedback.classList.add("is-error");
  if (tone === "success") authFeedback.classList.add("is-success");
}

function formatAuthErrorMessage(error) {
  const rawMessage = cleanText(error?.message || "");
  const normalized = rawMessage.toLowerCase();
  if (!normalized) return "Google login failed. Please try again.";
  if (normalized.includes("not configured")) {
    return "Google login is not configured yet. Add GOOGLE_CLIENT_ID to make the button work.";
  }
  if (normalized.includes("access_denied")) return "Google login was canceled.";
  if (normalized.includes("state")) return "Google login could not be verified. Please try again.";
  if (normalized.includes("nonce")) return "Google login could not be verified. Please try again.";
  return rawMessage;
}

function syncAuthButton() {
  if (!authButton) return;
  const email = cleanText(googleAuthSession?.email || "");
  authButton.disabled = isAuthBusy;
  authButton.classList.toggle("is-busy", isAuthBusy);
  authButton.classList.toggle("is-authenticated", Boolean(email));
  authButton.textContent = isAuthBusy
    ? (authBusyLabel || (email ? "Logging out..." : "Redirecting..."))
    : (email || "Login");
  authButton.title = email ? `${email} - click to logout` : "Login with Google";
  authButton.setAttribute("aria-label", email ? `Logout ${email}` : "Login with Google");
}

function syncAdminMenu() {
  if (!adminMenu || !adminMenuButton) return;
  const canOpenDashboard = hasNewsroomAccess();
  const dashboardItem = adminMenuItems.find((item) => item.dataset.adminTarget === "dashboard");
  const primaryLabel = newsroomRole === "admin" ? "Admin" : "Editor";
  adminMenu.hidden = !canOpenDashboard;
  adminMenuButton.classList.toggle("is-admin", canOpenDashboard);
  adminMenuButton.textContent = primaryLabel;
  adminMenuButton.setAttribute("aria-label", canOpenDashboard ? `${primaryLabel} menu` : "Admin menu");
  if (dashboardItem) {
    dashboardItem.textContent = newsroomRole === "admin" ? "Admin Dashboard" : "Editor Dashboard";
  }
  adminMenuItems.forEach((item) => {
    const allowedRoles = cleanText(item.dataset.adminRoles || "admin,submitter")
      .split(",")
      .map((entry) => cleanText(entry).toLowerCase())
      .filter(Boolean);
    item.hidden = !canOpenDashboard || !allowedRoles.includes(newsroomRole);
  });
  if (!canOpenDashboard || !adminMenu.classList.contains("is-open")) {
    setAdminMenuOpenState(false);
  }
}

function setAuthBusyState(nextBusy, label = "") {
  isAuthBusy = Boolean(nextBusy);
  authBusyLabel = isAuthBusy ? cleanText(label) : "";
  syncAuthButton();
}

function decodeJwtPayload(token = "") {
  const parts = String(token || "").split(".");
  if (parts.length < 2) throw new Error("Google login returned an invalid credential.");
  const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = window.atob(padded);
  return JSON.parse(decoded);
}

function extractGoogleUserProfile(credential = "") {
  const profile = decodeJwtPayload(credential);
  const email = cleanText(profile.email || "");
  if (!email) throw new Error("Google did not return an email address.");
  return {
    email,
    name: cleanText(profile.name || ""),
    picture: cleanText(profile.picture || ""),
  };
}

function readGoogleAuthRequest() {
  try {
    const raw = window.sessionStorage.getItem(GOOGLE_AUTH_REQUEST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = cleanText(parsed?.state || "");
    const nonce = cleanText(parsed?.nonce || "");
    const returnPath = cleanText(parsed?.returnPath || "/");
    if (!state || !nonce) return null;
    return { state, nonce, returnPath: returnPath || "/" };
  } catch (_) {
    return null;
  }
}

function saveGoogleAuthRequest(request = null) {
  if (!request?.state || !request?.nonce) {
    window.sessionStorage.removeItem(GOOGLE_AUTH_REQUEST_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(
    GOOGLE_AUTH_REQUEST_STORAGE_KEY,
    JSON.stringify({
      state: cleanText(request.state),
      nonce: cleanText(request.nonce),
      returnPath: cleanText(request.returnPath || "/"),
    })
  );
}

function createRandomAuthToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildGoogleRedirectUri() {
  return `${window.location.origin}/`;
}

function buildGoogleLoginUrl() {
  const clientId = readGoogleClientId();
  if (!clientId) throw new Error("Google login is not configured yet.");

  const request = {
    state: createRandomAuthToken(16),
    nonce: createRandomAuthToken(16),
    returnPath: `${window.location.pathname}${window.location.search}` || "/",
  };
  saveGoogleAuthRequest(request);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: buildGoogleRedirectUri(),
    response_type: "id_token",
    scope: "openid email profile",
    prompt: "select_account",
    nonce: request.nonce,
    state: request.state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function clearGoogleAuthResponseFromUrl(nextPath = null) {
  const targetPath = cleanText(nextPath || `${window.location.pathname}${window.location.search}` || "/");
  if (window.location.hash) {
    window.history.replaceState({}, document.title, targetPath);
  }
}

function consumeGoogleRedirectResponse() {
  const hash = String(window.location.hash || "").replace(/^#/, "").trim();
  if (!hash) return;

  const params = new URLSearchParams(hash);
  const idToken = cleanText(params.get("id_token") || "");
  const error = cleanText(params.get("error") || "");
  const state = cleanText(params.get("state") || "");
  if (!idToken && !error) return;

  const authRequest = readGoogleAuthRequest();
  const nextPath = cleanText(authRequest?.returnPath || "/");
  clearGoogleAuthResponseFromUrl(nextPath);
  saveGoogleAuthRequest(null);

  if (error) {
    const message = formatAuthErrorMessage(new Error(error));
    setAuthStatus(message);
    showAuthFeedback(message, "error");
    return;
  }

  if (!authRequest || state !== authRequest.state) {
    const message = formatAuthErrorMessage(new Error("state_mismatch"));
    setAuthStatus(message);
    showAuthFeedback(message, "error");
    return;
  }

  try {
    const payload = decodeJwtPayload(idToken);
    const nonce = cleanText(payload?.nonce || "");
    if (!nonce || nonce !== authRequest.nonce) {
      throw new Error("nonce_mismatch");
    }
    const profile = extractGoogleUserProfile(idToken);
    googleAuthSession = profile;
    setNewsroomRole(isAdminUserEmail(profile.email) ? "admin" : "submitter");
    saveGoogleAuthSession(profile);
    saveGoogleAuthIdToken(idToken);
    setAuthUiOverride("");
    setAuthStatus(`Logged in as ${profile.email}`);
    showAuthFeedback(`Logged in as ${profile.email}`, "success");
    syncAdminMenu();
    prefetchAdminRoutes();
    void syncAdminSession(idToken, { quiet: true });
  } catch (error) {
    console.error(error);
    const message = formatAuthErrorMessage(error);
    setAuthStatus(message);
    showAuthFeedback(message, "error");
  }
}

function loginWithGoogle() {
  if (isAuthBusy) return;

  try {
    setAuthBusyState(true, "Redirecting...");
    setAuthStatus("Redirecting to Google sign in.");
    showAuthFeedback("");
    const loginUrl = buildGoogleLoginUrl();
    window.location.assign(loginUrl);
  } catch (error) {
    console.error(error);
    const message = formatAuthErrorMessage(error);
    setAuthStatus(message);
    showAuthFeedback(message, "error");
    setAuthBusyState(false);
  }
}

async function logoutGoogleUser() {
  if (isAuthBusy) return;

  const currentEmail = cleanText(googleAuthSession?.email || "");
  setAuthBusyState(true, "Logging out...");

  try {
    setAuthUiOverride("logged-out");
    googleAuthSession = null;
    serverInjectedAuthState = { user: null, role: "" };
    setNewsroomRole("");
    clearAdminSessionVerification();
    saveGoogleAuthSession(null);
    saveGoogleAuthIdToken("");
    setAuthStatus(currentEmail ? `${currentEmail} logged out.` : "Logged out.");
    showAuthFeedback(currentEmail ? `${currentEmail} logged out.` : "Logged out.", "success");
    syncAdminMenu();
    clearAdminSession({ keepalive: true }).catch(() => null);
  } finally {
    setAuthBusyState(false);
    window.location.replace(`${window.location.pathname}${window.location.search}`);
  }
}

async function syncAdminSessionInternal(idToken = "", options = {}) {
  const previousRole = newsroomRole;
  const token = cleanText(idToken || googleAuthIdToken || "");
  if (!token) {
    if (!previousRole) setNewsroomRole("");
    clearAdminSessionVerification();
    if (!options.quiet) showAuthFeedback("Please log in again to verify admin access.", "error");
    return false;
  }

  try {
    const response = await fetch("/api/admin/session", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idToken: token }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNewsroomRole("");
      clearAdminSessionVerification();
      syncAdminMenu();
      if (!options.quiet) {
        showAuthFeedback(payload.error || "Dashboard access could not be verified.", "error");
      }
      return false;
    }
    setNewsroomRole(payload.role || "");
    setAuthUiOverride("");
    markAdminSessionVerified();
    syncAdminMenu();
    return true;
  } catch (_) {
    if (!previousRole) setNewsroomRole("");
    clearAdminSessionVerification();
    syncAdminMenu();
    if (!options.quiet) showAuthFeedback("Dashboard access could not be verified right now.", "error");
    return false;
  }
}

async function syncAdminSession(idToken = "", options = {}) {
  return runWithAdminSessionLock(() => syncAdminSessionInternal(idToken, options));
}

async function clearAdminSession(options = {}) {
  try {
    await fetch("/api/admin/session", {
      method: "DELETE",
      credentials: "include",
      keepalive: options.keepalive === true,
    });
  } catch (_) {
    // Ignore session cleanup failures.
  }
}

async function hydrateAdminSession(options = {}) {
  if (hasFreshAdminSession() && hasNewsroomAccess()) return true;

  return runWithAdminSessionLock(async () => {
    try {
      const response = await fetch("/api/admin/session", {
        method: "GET",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.authenticated && cleanText(payload?.role || "")) {
        setNewsroomRole(payload.role || "");
        setAuthUiOverride("");
        markAdminSessionVerified();
        syncAdminMenu();
        return true;
      }
    } catch (_) {
      // Ignore cookie hydration failures.
    }

    if (googleAuthSession?.email && googleAuthIdToken) {
      return syncAdminSessionInternal("", { quiet: options.quiet !== false });
    }

    clearAdminSessionVerification();
    setNewsroomRole("");
    syncAdminMenu();
    return false;
  });
}

function setAdminMenuOpenState(nextOpen) {
  const shouldOpen = Boolean(nextOpen);
  if (!adminMenu || !adminMenuButton || !adminMenuPanel) return;
  adminMenu.classList.toggle("is-open", shouldOpen);
  adminMenuButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  adminMenuPanel.hidden = !shouldOpen;
}

async function openAdminDashboard(mode = "") {
  const email = cleanText(googleAuthSession?.email || "");
  if (!email) {
    showAuthFeedback("Login with Google to access the admin dashboard.", "error");
    loginWithGoogle();
    return;
  }

  const nextMode = cleanText(mode);
  const url = nextMode && nextMode !== "dashboard"
    ? `/admin/news?mode=${encodeURIComponent(nextMode)}`
    : "/admin/news";

  if (hasNewsroomAccess()) {
    const ready = hasFreshAdminSession()
      ? true
      : await hydrateAdminSession({ quiet: true });
    if (!ready) return;
    prefetchAdminRoutes();
    window.location.assign(url);
    return;
  }

  const ready = googleAuthIdToken
    ? await syncAdminSession()
    : await hydrateAdminSession({ quiet: false });
  if (!ready) return;
  window.location.assign(url);
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
  const sectionMatch = pathname.match(/^\/(ai|tech|entertainment|sports|business|politics|jobs)(?:\/page\/(\d+))?$/i);
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

function isArchiveRouteState() {
  return !activeSearchQuery && currentPage > 1;
}

function syncHomeModeVisibility() {
  const archiveMode = isArchiveRouteState();
  if (document.body) {
    document.body.setAttribute("data-home-mode", archiveMode ? "archive" : "home");
  }
  if (homeTopLayoutEl) homeTopLayoutEl.hidden = archiveMode;
  if (homepageSidebarEl) homepageSidebarEl.hidden = archiveMode;
  if (archiveMode && categoryZoneSectionEl) categoryZoneSectionEl.hidden = true;
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
  return filter === "all" || filter === "latest" ? HOME_ARCHIVE_PAGE_SIZE : DESK_PAGE_SIZE;
}

function getHomeTotalPages(totalStories = 0) {
  const safeTotal = Math.max(0, Number(totalStories) || 0);
  if (safeTotal <= HOME_FIRST_PAGE_STORY_COUNT) return 1;
  return 1 + Math.ceil((safeTotal - HOME_FIRST_PAGE_STORY_COUNT) / HOME_ARCHIVE_PAGE_SIZE);
}

function getHomePageStoryWindow(page = 1) {
  const safePage = Math.max(1, Number(page) || 1);
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

function buildNavigationUrl(options = {}) {
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
  return `${url.pathname}${url.search}`;
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
  const paletteSeed = [
    story.title,
    story.summary,
    story.category,
    story.source,
    story.sourceUrl,
    story.url,
  ].filter(Boolean).join("|");
  const palette = PLACEHOLDER_PALETTES[
    Array.from(paletteSeed).reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 7)
    % PLACEHOLDER_PALETTES.length
  ];
  const category = cleanText(String(story.category || "latest").replace(/[-_]+/g, " ")).toUpperCase();
  const title = cleanText(story.title || "Sunwire story");
  const compactTitle = title.length > 54 ? `${title.slice(0, 51).trim()}...` : title;
  const source = cleanText(story.source || "Sunwire").slice(0, 28);
  const text = [category, compactTitle, source].join(" | ");

  return `https://placehold.co/1200x675/${palette.background}/${palette.foreground}?text=${encodeURIComponent(text)}`;
}

function isRenderableRemoteImage(value = "") {
  const normalized = decodeHtmlEntities(String(value || "").trim());
  if (!normalized) return false;
  if (/\$\{[^}]+\}/.test(normalized) || /%24%7B[^%]+%7D/i.test(normalized)) return false;
  if (!/^https?:\/\//i.test(normalized)) return false;
  return !/\.svg(\?|$)/i.test(normalized);
}

function isLikelyTechStory(story = {}) {
  const source = cleanText(String(story.source || "")).toLowerCase();
  const haystack = cleanText([
    story.title,
    story.summary,
    story.content,
    story.body,
    story.source,
    story.category,
  ].filter(Boolean).join(" ")).toLowerCase();

  if (NON_TECH_TECH_DESK_PATTERNS.some((pattern) => pattern.test(source))) return false;
  if (NON_TECH_TECH_DESK_KEYWORDS.some((keyword) => haystack.includes(keyword))) return false;
  if (TECH_DESK_SOURCE_PATTERNS.some((pattern) => pattern.test(source))) return true;
  return TECH_DESK_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function storyImage(story = {}) {
  const candidates = [story.image, story.image_url, story.image_storage_url]
    .map((value) => decodeHtmlEntities(String(value || "").trim()))
    .filter(Boolean);
  const candidate = candidates.find((value) => isRenderableRemoteImage(value)) || "";
  return candidate || buildFallbackImage(story);
}

function buildArticleHref(story = {}) {
  const slug = cleanText(story.slug || story.title || story.id || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!slug) return "/";

  const params = new URLSearchParams();
  if (story.id) params.set("id", String(story.id || "").trim());
  if (story.sourceUrl || story.url) params.set("u", String(story.sourceUrl || story.url || "").trim());
  if (story.title) params.set("t", cleanText(story.title || ""));
  if (story.category) params.set("c", resolveFilter(story.category || "all"));
  params.set("sw", "2");
  const query = params.toString();

  return query ? `/article/${slug}?${query}` : `/article/${slug}`;
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

function buildPoliticsStories(stories = [], used = new Set(), count = RANDOM_NEWS_COUNT, mode = "just-in") {
  return takeUnique(
    sortStoriesForTrending(stories.filter(isPoliticsRelatedStory), mode),
    used,
    count
  ).map((story) => ({
    ...story,
    displayCategory: "Politics",
  }));
}

function buildWarStories(stories = [], used = new Set(), count = RANDOM_NEWS_COUNT, mode = "just-in") {
  return takeUnique(
    sortStoriesForTrending(stories.filter(isWarRelatedStory), mode),
    used,
    count
  ).map((story) => ({
    ...story,
    displayCategory: "War",
  }));
}

function buildBusinessFocusStories(stories = [], used = new Set(), count = RANDOM_NEWS_COUNT, mode = "just-in") {
  return takeUnique(
    sortStoriesForTrending(stories.filter(isBusinessFocusStory), mode),
    used,
    count
  ).map((story) => ({
    ...story,
    displayCategory: "Startups & Funding",
  }));
}

function isEconomyStory(story = {}) {
  const haystack = cleanText([
    story.title,
    story.summary,
    story.content,
    story.displayCategory,
    story.source,
    story.category,
    story.searchTrendTopic,
  ].filter(Boolean).join(" ")).toLowerCase();

  return ECONOMY_KEYWORDS.some((keyword) => haystack.includes(keyword))
    || story.category === "business";
}

function isJobsStory(story = {}) {
  const haystack = cleanText([
    story.title,
    story.summary,
    story.content,
    story.displayCategory,
    story.source,
    story.category,
    story.searchTrendTopic,
  ].filter(Boolean).join(" ")).toLowerCase();

  return JOBS_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function isFoodStory(story = {}) {
  const haystack = cleanText([
    story.title,
    story.summary,
    story.content,
    story.displayCategory,
    story.source,
    story.category,
    story.searchTrendTopic,
  ].filter(Boolean).join(" ")).toLowerCase();

  return FOOD_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function isAudienceGatheringStory(story = {}) {
  return Number(story.searchTrendScore || 0) >= 35
    || Number(story.indiaAudienceRelevance || 0) >= 15
    || Number(story.trendingScore || 0) >= 12
    || Number(story.priority || 0) >= 1;
}

function isHomepageGeneralStory(story = {}) {
  const category = String(story.category || "").toLowerCase();
  return category !== "food"
    && category !== "jobs"
    && !isFoodStory(story)
    && !isJobsStory(story);
}

function isActiveFeaturedManualStory(story = {}) {
  const featuredUntil = new Date(story?.featured_until || story?.featuredUntil || "").getTime();
  return Boolean(story?.is_featured && featuredUntil && featuredUntil > Date.now());
}

function isHomepageFeaturedStory(story = {}) {
  if (isActiveFeaturedManualStory(story)) return true;
  const category = String(story.category || "").toLowerCase();
  if (!isHomepageGeneralStory(story)) return false;
  if (category === "ai") return true;
  if (category === "tech") return isLikelyTechStory(story);
  if (isWarRelatedStory(story)) return true;
  return isAudienceGatheringStory(story);
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
  const manualFeaturedDiff = Number(isActiveFeaturedManualStory(b)) - Number(isActiveFeaturedManualStory(a));
  if (manualFeaturedDiff !== 0) return manualFeaturedDiff;

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

function articleSessionCacheKey(story = {}) {
  return `${ARTICLE_CACHE_PREFIX}${cleanText(story.sourceUrl || story.url || "")}|${cleanText(story.title || "")}`;
}

function writePrefetchedArticle(story = {}, article = null) {
  if (!article) return;

  try {
    window.sessionStorage.setItem(articleSessionCacheKey(story), JSON.stringify(article));
  } catch (_) {
    // Ignore session storage failures.
  }
}

function collectKnownStories() {
  return dedupeStories([
    ...currentStories,
    ...Object.values(currentCategoryMap || {}).flatMap((stories) => Array.isArray(stories) ? stories : []),
  ]);
}

function findStoryByArticleHref(href = "") {
  if (!href) return null;

  let pathname = href;
  try {
    pathname = new URL(href, window.location.origin).pathname;
  } catch (_) {
    pathname = href;
  }

  return collectKnownStories().find((story) => {
    try {
      return new URL(buildArticleHref(story), window.location.origin).pathname === pathname;
    } catch (_) {
      return buildArticleHref(story) === pathname;
    }
  }) || null;
}

function warmArticleRoute(href = "") {
  if (!href || routePrefetchSet.has(href)) return;
  routePrefetchSet.add(href);

  const preload = document.createElement("link");
  preload.rel = "prefetch";
  preload.as = "document";
  preload.href = href;
  preload.dataset.sunwirePrefetch = href;
  document.head.appendChild(preload);
}

function warmScriptAsset(href = "") {
  if (!href || routePrefetchSet.has(href)) return;
  routePrefetchSet.add(href);

  const preload = document.createElement("link");
  preload.rel = "modulepreload";
  preload.href = href;
  preload.dataset.sunwirePrefetch = href;
  document.head.appendChild(preload);
}

function prefetchAdminRoutes() {
  const routes = hasNewsroomAccess()
    ? (newsroomRole === "admin"
      ? [
        "/admin/news",
        "/admin/news?mode=news-requests",
        "/admin/news?mode=edit-news",
        "/admin/news?mode=watch-all-news",
        "/admin/news?mode=access-control",
      ]
      : ["/admin/news", "/admin/news?mode=submit-request"])
    : [];
  routes.forEach((href) => warmArticleRoute(href));
  warmScriptAsset(`/admin/news.js?v=${ADMIN_DASHBOARD_ASSET_VERSION}`);
  warmScriptAsset("/shared/client-utils.mjs");
  if (hasNewsroomAccess() && !hasFreshAdminSession()) {
    void hydrateAdminSession({ quiet: true }).catch(() => null);
  }
}

function buildArticleApiUrl(story = {}) {
  const href = buildArticleHref(story);
  const parsedHref = new URL(href, window.location.origin);
  const slug = String(parsedHref.pathname.split("/").pop() || "").trim();
  if (!slug) return "";

  const params = new URLSearchParams(parsedHref.searchParams);
  params.set("slug", slug);
  params.set("category", resolveFilter(story.category || "all"));
  if (story.id) params.set("id", String(story.id || "").trim());
  return `/api/article?${params.toString()}`;
}

async function prefetchArticleForStory(story = {}) {
  const href = buildArticleHref(story);
  if (!href || href === "/") return null;

  warmArticleRoute(href);

  const existing = articlePrefetchPromises.get(href);
  if (existing) return existing;

  const apiUrl = buildArticleApiUrl(story);
  if (!apiUrl) return null;

  const request = fetchJson(apiUrl)
    .then((article) => {
      writePrefetchedArticle(story, article);
      return article;
    })
    .finally(() => {
      articlePrefetchPromises.delete(href);
    });

  articlePrefetchPromises.set(href, request);
  return request;
}

function scheduleHomepageArticlePrefetch(limit = 6) {
  scheduleIdleTask(() => {
    collectKnownStories()
      .slice(0, limit)
      .forEach((story) => {
        void prefetchArticleForStory(story);
      });
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

function deterministicShuffle(stories = [], salt = 1) {
  return [...stories]
    .map((story, index) => {
      const key = `${storyKey(story)}|${salt}|${index}`;
      const weight = Array.from(key).reduce((hash, char) => ((hash * 33) + char.charCodeAt(0)) >>> 0, 5381);
      return { story, weight };
    })
    .sort((left, right) => left.weight - right.weight)
    .map((entry) => entry.story);
}

function mapSectionStories(stories = [], label = "") {
  return stories.map((story) => ({
    ...story,
    displayCategory: label || story.displayCategory || story.category || "News",
  }));
}

function buildCategoryPlaceholderStories(section = {}, currentStories = [], targetCount = 8) {
  const count = Math.max(0, targetCount - currentStories.length);
  if (!count) return [];

  const category = String(section.category || section.key || "latest").trim().toLowerCase() || "latest";
  const label = section.title || toTitleCase(category);
  const source = currentStories.length ? "Sunwire Live Desk" : "Sunwire";

  return Array.from({ length: count }, (_, index) => ({
    id: `placeholder-${category}-${index + 1}`,
    slug: `placeholder-${category}-${index + 1}`,
    title: currentStories.length
      ? `More ${label.toLowerCase()} updates coming soon`
      : `${label} updates are loading`,
    summary: currentStories.length
      ? `More verified ${label.toLowerCase()} stories will appear here as fresh coverage is ingested.`
      : `This ${label.toLowerCase()} rail is reserved for strictly matched stories only.`,
    content: currentStories.length
      ? `More verified ${label.toLowerCase()} stories will appear here as fresh coverage is ingested.`
      : `This ${label.toLowerCase()} rail is reserved for strictly matched stories only.`,
    source,
    category,
    displayCategory: label,
    published_at: "",
    source_published_at: "",
  }));
}

function buildHomepageSectionStories(section = {}, allStories = [], categoryMap = {}, latestPool = []) {
  const baseStories = filterDisplayableStories(allStories);
  const sectionLabel = section.title || "News";

  if (section.category) {
    const categoryStories = section.category === "tech"
      ? (categoryMap[section.category] || []).filter(isLikelyTechStory)
      : (categoryMap[section.category] || []);
    const exactStories = takeUnique(
      filterDisplayableStories([
        ...categoryStories,
        ...baseStories.filter((story) =>
          String(story.category || "").toLowerCase() === section.category
          && (section.category !== "tech" || isLikelyTechStory(story))
        ),
      ]),
      new Set(),
      8
    );
    return mapSectionStories([
      ...exactStories.slice(0, 8),
      ...buildCategoryPlaceholderStories(section, exactStories.slice(0, 8), 8),
    ].slice(0, 8), sectionLabel);
  }

  if (section.source === "latest") {
    return mapSectionStories(takeUnique(latestPool, new Set(), 8), sectionLabel);
  }

  if (section.source === "politics") {
    const exactStories = takeUnique(
      sortStoriesForTrending(baseStories.filter(isPoliticsRelatedStory), "just-in").map((story) => ({
        ...story,
        displayCategory: sectionLabel,
      })),
      new Set(),
      8
    );
    const fallbackStories = mapSectionStories(
      takeUnique(
        latestPool.filter((story) => !exactStories.some((entry) => storyKey(entry) === storyKey(story))),
        new Set(),
        Math.max(0, 8 - exactStories.length)
      ),
      sectionLabel
    );
    return [...exactStories, ...fallbackStories].slice(0, 8);
  }

  if (section.source === "economy") {
    const exactStories = takeUnique(
      sortStoriesForTrending(baseStories.filter(isEconomyStory), "just-in").map((story) => ({
        ...story,
        displayCategory: sectionLabel,
      })),
      new Set(),
      8
    );
    const fallbackStories = mapSectionStories(
      takeUnique(
        latestPool.filter((story) => !exactStories.some((entry) => storyKey(entry) === storyKey(story))),
        new Set(),
        Math.max(0, 8 - exactStories.length)
      ),
      sectionLabel
    );
    return [...exactStories, ...fallbackStories].slice(0, 8);
  }

  if (section.source === "jobs") {
    const exactStories = takeUnique(
      sortStoriesForTrending(baseStories.filter(isJobsStory), "just-in").map((story) => ({
        ...story,
        displayCategory: sectionLabel,
      })),
      new Set(),
      8
    );
    const fallbackStories = mapSectionStories(
      takeUnique(
        latestPool.filter((story) => !exactStories.some((entry) => storyKey(entry) === storyKey(story))),
        new Set(),
        Math.max(0, 8 - exactStories.length)
      ),
      sectionLabel
    );
    return [...exactStories, ...fallbackStories].slice(0, 8);
  }

  return [];
}

function buildHomepageDeskSections(allStories = [], categoryMap = {}, latestPool = []) {
  return HOMEPAGE_SECTION_DEFINITIONS.map((section) => ({
    key: section.key,
    title: section.title,
    eyebrow: section.eyebrow,
    filter: section.filter || "",
    hideAction: !section.filter,
    layout: "rail",
    cardVariant: "compact",
    stories: buildHomepageSectionStories(section, allStories, categoryMap, latestPool),
  })).filter((section) => section.stories.length);
}

function buildGlobalLayout(mainStories = [], categoryMap = {}) {
  const filteredMainStories = filterDisplayableStories(mainStories);
  const allStories = filterDisplayableStories([
    ...mainStories,
    ...CATEGORY_KEYS.flatMap((key) => categoryMap[key] || []),
  ]);
  const latestPool = dedupeStories(sortStoriesForLatest(filteredMainStories));
  const allStoriesPool = dedupeStories(allStories);

  if (currentPage > 1) {
    const fallbackStories = deterministicShuffle(
      allStoriesPool.filter((story) => !filteredMainStories.some((entry) => storyKey(entry) === storyKey(story))),
      currentPage + 11
    );
    const fullGridStories = takeUnique(
      filteredMainStories,
      new Set(),
      HOME_ARCHIVE_PAGE_SIZE,
      fallbackStories
    );
    return {
      hero: null,
      trending: [],
      topSections: [],
      moreSections: [],
      fullGridStories,
      hideHero: true,
      hideTrending: true,
      pageTitle: `Page ${currentPage} News Grid`,
    };
  }

  const used = new Set();
  const homepageGeneralPool = dedupeStories(allStoriesPool.filter(isHomepageGeneralStory));
  const homepagePriorityPool = dedupeStories(
    sortStoriesForHomepageFocus(homepageGeneralPool.filter(isHomepageFeaturedStory))
  );
  const homepageFallbackPool = homepageGeneralPool.length ? homepageGeneralPool : allStoriesPool;
  const latestGeneralPool = dedupeStories(sortStoriesForLatest(filteredMainStories.filter(isHomepageGeneralStory)));
  const hero = selectHeadlineOfTheDay(homepagePriorityPool.length ? homepagePriorityPool : homepageFallbackPool)
    || latestGeneralPool[0]
    || homepageFallbackPool[0]
    || latestPool[0]
    || null;

  const trendingSourcePool = dedupeStories([
    ...filteredMainStories,
    ...homepagePriorityPool,
    ...sortStoriesForTrending(homepageFallbackPool, activeTrendingMode),
  ]);
  const trending = takeUnique(trendingSourcePool, new Set(), HOME_FIRST_PAGE_STORY_COUNT, homepageFallbackPool);
  const topSections = [];
  const moreSections = [];

  const tickerStories = dedupeStories([
    hero,
    ...trending,
  ].filter(Boolean));

  return { hero, trending, topSections, moreSections, tickerStories };
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
  const label = filter === "latest" ? "Latest" : activeDeskLabel();
  const fullGridStories = deskStories.slice(0, getPageSizeForFilter(filter));

  return {
    hero: null,
    trending: [],
    topSections: [],
    moreSections: [],
    fullGridStories,
    hideHero: true,
    hideTrending: true,
    hideSectionHead: true,
    pageTitle: currentPage > 1 ? `${label} Page ${currentPage}` : `${label} News`,
  };
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
  const isFocusedDeskView = !activeSearchQuery && activeFilter !== "all" && activeFilter !== "latest";
  syncHomeModeVisibility();
  pendingTopSections = [];
  if (topSectionsObserver) {
    topSectionsObserver.disconnect();
    topSectionsObserver = null;
  }

  if (heroSectionEl) heroSectionEl.hidden = currentPage > 1 || isFocusedDeskView;
  if (trendingSectionEl) trendingSectionEl.hidden = currentPage > 1 || isFocusedDeskView;
  if (categoryZoneSectionEl) categoryZoneSectionEl.hidden = true;
  if (moreNewsSectionEl) moreNewsSectionEl.hidden = currentPage <= 1 && !isFocusedDeskView;
  if (moreNewsSectionEl) moreNewsSectionEl.classList.toggle("more-news-shell--clean", isFocusedDeskView || currentPage > 1);
  if (moreNewsSectionHeadEl) moreNewsSectionHeadEl.hidden = isFocusedDeskView || currentPage > 1;
  if (homepageSidebarEl) homepageSidebarEl.hidden = currentPage > 1 || isFocusedDeskView;
  if (currentPage <= 1 && !isFocusedDeskView) {
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
      sizes: "(max-width: 1200px) 100vw, 80vw",
      highPriority: true,
    });
  }

  if (trendingGridEl) trendingGridEl.innerHTML = "";
  if (categorySectionsGridEl) categorySectionsGridEl.innerHTML = "";
  if (moreNewsGridEl) moreNewsGridEl.innerHTML = "";

  if (currentPage <= 1 && !isFocusedDeskView && trendingGridEl) {
    for (let i = 0; i < HOME_FIRST_PAGE_STORY_COUNT; i += 1) trendingGridEl.appendChild(createSkeletonCard("compact"));
  }

  if (moreNewsGridEl && (currentPage > 1 || isFocusedDeskView)) {
    moreNewsGridEl.classList.remove("desk-panels", "desk-panels--expanded");
    moreNewsGridEl.classList.add("news-card-grid");
    moreNewsGridEl.classList.toggle("news-card-grid--page", currentPage > 1);
    moreNewsGridEl.classList.toggle("news-card-grid--homepage", currentPage <= 1);
    const loadingGrid = document.createDocumentFragment();
    const loadingCount = currentPage > 1 || isFocusedDeskView
      ? getPageSizeForFilter(activeFilter)
      : RANDOM_NEWS_COUNT;
    for (let i = 0; i < loadingCount; i += 1) {
      loadingGrid.appendChild(createSkeletonCard("dense"));
    }
    moreNewsGridEl.appendChild(loadingGrid);
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
    if (heroMediaLinkEl) heroMediaLinkEl.href = "/";
    heroSummaryEl.textContent = "Fresh AI, tech, entertainment, sports, and business stories are loading.";
    headlineOfTheDayMeta.textContent = "Waiting for fresh stories.";
    heroAuthorEl.textContent = "SunWire Desk";
    heroDeskChip.textContent = activeDeskLabel();
    applyResponsiveImage(heroImageEl, buildFallbackImage({ category: "tech", title: "SunWire Live Signal" }), {
      alt: "SunWire lead story",
      width: 1600,
      height: 900,
      sizes: "(max-width: 1200px) 100vw, 80vw",
      highPriority: true,
    });
    return;
  }

  const heroHref = buildArticleHref(story);
  const optimizedHeadline = optimizeHeadline(story.title, "hero");
  if (optimizedHeadline.includes(":")) {
    const parts = optimizedHeadline.split(":");
    headlineOfTheDayLink.innerHTML = `<span class="highlight">${escapeHtml(parts[0])}</span>: ${escapeHtml(parts.slice(1).join(":"))}`;
  } else {
    headlineOfTheDayLink.textContent = optimizedHeadline;
  }

  headlineOfTheDayLink.href = heroHref;
  if (heroMediaLinkEl) heroMediaLinkEl.href = heroHref;
  if (heroViewStoryEl) heroViewStoryEl.href = heroHref;

  heroSummaryEl.textContent = optimizeSummary(story.summary || "", story, "hero");
  headlineOfTheDayMeta.textContent = fmtDate(getDisplayTimestamp(story));
  heroAuthorEl.textContent = story.source || "SunWire Desk";
  heroDeskChip.textContent = categoryLabel(story);
  const heroImageSrc = storyImage(story);
  applyResponsiveImage(heroImageEl, heroImageSrc, {
    alt: story.title || "Headline of the day",
    width: 1600,
    height: 900,
    sizes: "(max-width: 1200px) 100vw, 80vw",
    fallbackSrc: buildFallbackImage(story),
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
  const imageSrc = storyImage(story);

  mediaLink.href = href;
  headlineLink.href = href;
  applyResponsiveImage(image, imageSrc, {
    alt: story.title || "SunWire story image",
    width: 1600,
    height: variant === "standard" ? 1000 : 900,
    sizes: variant === "compact"
      ? "(max-width: 900px) 100vw, 24vw"
      : variant === "dense"
        ? "(max-width: 900px) 100vw, 48vw"
        : "(max-width: 900px) 100vw, 30vw",
    fallbackSrc: buildFallbackImage(story),
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
  const allRails = sections.every((section) => section?.layout === "rail");
  container.classList.add("desk-panels");
  container.classList.toggle("desk-panels--top", allRails);
  container.classList.toggle("desk-panels--expanded", !allRails);
  container.classList.remove("news-card-grid", "news-card-grid--page", "news-card-grid--homepage");

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
        action.hidden = false;
        action.addEventListener("click", openSection);
      }

      const grid = panel.querySelector(".desk-panel__grid");
      if (section.layout === "rail") {
        grid.classList.add("desk-panel__grid--rail");
      }
      if (section.layout === "stack") {
        grid.classList.add("desk-panel__grid--stack");
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
  if (livePulseText) livePulseText.textContent = currentStories[0]
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
        currentPage = page;
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
    if (activeDeskChip) activeDeskChip.textContent = "Search";
    if (showAllButton) showAllButton.textContent = "Clear Search";
    if (showAllButton) showAllButton.disabled = isLoading;
    return;
  }

  const label = activeDeskLabel();
  if (activeDeskChip) activeDeskChip.textContent = label;
  if (showAllButton) showAllButton.textContent = activeFilter === "all" ? "Showing All" : "Show All";
  if (showAllButton) showAllButton.disabled = activeFilter === "all" || isLoading;
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
  return fetchJson("/api/sidebar?v=20260331-sidebar4", { forceFresh: true });
}

function renderFlatNewsGrid(container, stories = [], variant = "dense") {
  if (!container) return;
  container.innerHTML = "";
  container.classList.remove("desk-panels", "desk-panels--expanded");
  container.classList.add("news-card-grid");
  container.classList.toggle("news-card-grid--page", currentPage > 1);
  container.classList.toggle("news-card-grid--homepage", currentPage <= 1);
  stories.forEach((story) => container.appendChild(createNewsCard(story, variant)));
}

function buildNewsApiUrl(params = new URLSearchParams()) {
  const baseUrl = "/api/news";
  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

async function fetchCentralNews(
  page = 1,
  filter = "all",
  pageSize = getPageSizeForFilter(filter),
  forceRefresh = false,
  triggerBackendRefresh = false
) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    filter: resolveFilter(filter),
  });
  if (triggerBackendRefresh) params.set("refresh", "1");
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
      filteredStories.filter((story) =>
        String(story.category || "").toLowerCase() === key
        && (key !== "tech" || isLikelyTechStory(story))
      )
    );
  });

  return categoryMap;
}

async function fetchHomepageCategoryMap(forceRefresh = false, triggerBackendRefresh = false) {
  const poolPayload = await fetchCentralNews(1, "all", CATEGORY_POOL_FETCH_SIZE, forceRefresh, triggerBackendRefresh);
  return buildHomepageCategoryMapFromStories(extractNewsStories(poolPayload));
}

function buildHomepageDataFromPool(poolPayload = {}, page = 1) {
  const safePage = Math.max(1, Number(page) || 1);
  const pooledStories = dedupeStories(extractNewsStories(poolPayload));
  const totalStories = Number(poolPayload?.totalStories) || Number(poolPayload?.total) || pooledStories.length;
  const totalPages = getHomeTotalPages(totalStories);
  const clampedPage = Math.min(safePage, totalPages);
  const { startIndex, endIndex, pageSize } = getHomePageStoryWindow(clampedPage);
  const pageStories = pooledStories.slice(startIndex, endIndex);

  return {
    main: {
      ...poolPayload,
      page: clampedPage,
      pageSize,
      totalStories,
      totalPages,
      stories: pageStories,
      articles: pageStories,
      pageStories,
    },
    mainStories: pageStories,
    categoryMap: createEmptyCategoryMap(),
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
  syncHomeModeVisibility();

  const layout = activeFilter === "all" || activeFilter === "latest"
    ? buildGlobalLayout(filteredMainStories, safeCategoryMap)
    : buildFocusedLayout(filteredMainStories, activeFilter);

  renderTicker(
    activeFilter === "all" || activeFilter === "latest"
      ? (layout.tickerStories || [])
      : sortStoriesForTrending(combinedStories, activeTrendingMode)
  );
  renderHomepageLayout(layout);
  scheduleHomepageArticlePrefetch();
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
  (layout.fullGridStories || [])
    .filter(Boolean)
    .forEach((story) => visibleKeys.add(storyKey(story)));
  [layout.hero, ...(layout.trending || [])]
    .filter(Boolean)
    .forEach((story) => visibleKeys.add(storyKey(story)));

  [...(layout.topSections || []), ...(layout.moreSections || [])].forEach((section) => {
    (section.stories || []).forEach((story) => visibleKeys.add(storyKey(story)));
  });

  return visibleKeys.size;
}

function renderHomepageLayout(layout) {
  const hasFullGrid = Array.isArray(layout?.fullGridStories) && layout.fullGridStories.length > 0;
  const hasMoreSections = Array.isArray(layout?.moreSections) && layout.moreSections.length > 0;
  const isFocusedDeskView = activeFilter !== "all" && activeFilter !== "latest";
  const archiveMode = isArchiveRouteState() || hasFullGrid;
  const hideMoreNewsHeader = Boolean(layout?.hideSectionHead);

  if (homeTopLayoutEl) homeTopLayoutEl.hidden = archiveMode;
  if (heroSectionEl) heroSectionEl.hidden = archiveMode;
  if (trendingSectionEl) trendingSectionEl.hidden = archiveMode;
  if (categoryZoneSectionEl) categoryZoneSectionEl.hidden = true;
  if (moreNewsSectionEl) moreNewsSectionEl.hidden = !(hasMoreSections || hasFullGrid);
  if (moreNewsSectionEl) moreNewsSectionEl.classList.toggle("more-news-shell--clean", hideMoreNewsHeader);
  if (moreNewsSectionHeadEl) moreNewsSectionHeadEl.hidden = hideMoreNewsHeader;
  if (homepageSidebarEl) homepageSidebarEl.hidden = archiveMode;
  if (paginationShellEl) paginationShellEl.hidden = totalPages <= 1;
  if (document.body) {
    document.body.setAttribute("data-home-mode", archiveMode ? "archive" : "home");
  }
  if (categorySectionsGridEl) categorySectionsGridEl.classList.toggle("desk-panels--focused", isFocusedDeskView);
  if (categoryNewsTitleEl) {
    categoryNewsTitleEl.textContent = "Category News Grid";
  }
  if (moreNewsTitleEl) {
    moreNewsTitleEl.textContent = hasFullGrid
      ? (layout.pageTitle || `${activeDeskLabel()} News`)
      : "More News";
  }

  if (!hasFullGrid) {
    renderHero(layout.hero);
    renderTrendingSection(layout.trending || []);
    scheduleTopSectionsRender(layout.topSections || [], "dense");
    const recentStories = Array.isArray(layout.moreSections?.[0]?.stories)
      ? layout.moreSections[0].stories
      : [];
    if (moreNewsGridEl) renderFlatNewsGrid(moreNewsGridEl, recentStories, "dense");
  } else {
    scheduleTopSectionsRender([], "dense");
    if (moreNewsGridEl) renderFlatNewsGrid(moreNewsGridEl, layout.fullGridStories || [], "dense");
  }
  renderStats(countVisibleStories(layout));
}

function renderSearchResults(query = "", stories = [], layout = null) {
  const normalizedQuery = cleanText(query);
  const resolvedLayout = layout || {
    hero: stories[0] || null,
    trending: stories.slice(1, HOME_FIRST_PAGE_STORY_COUNT + 1),
    topSections: [],
    moreSections: [],
  };
  const hasResults = Array.isArray(stories) && stories.length > 0;

  if (categoryZoneSectionEl) categoryZoneSectionEl.hidden = !hasResults;
  if (moreNewsGridEl) moreNewsGridEl.innerHTML = "";
  if (moreNewsSectionEl) moreNewsSectionEl.hidden = true;
  if (paginationShellEl) paginationShellEl.hidden = true;
  if (categorySectionsGridEl) categorySectionsGridEl.classList.add("desk-panels--focused");
  if (categoryNewsTitleEl) categoryNewsTitleEl.textContent = hasResults
    ? `Results for "${normalizedQuery}"`
    : "Search Results";

  if (hasResults) {
    renderTicker(stories);
    renderHero(resolvedLayout.hero);
    renderTrendingSection(resolvedLayout.trending);
    scheduleTopSectionsRender(resolvedLayout.topSections, "dense");
    scheduleHomepageArticlePrefetch(4);
    scheduleSidebarHydration();
    if (livePulseText) livePulseText.textContent = `${stories.length} ${stories.length === 1 ? "story" : "stories"} matched "${normalizedQuery}"`;
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
  if (trendingGridEl) trendingGridEl.innerHTML = `<p>No stories matched "${escapeHtml(normalizedQuery)}".</p>`;
  scheduleTopSectionsRender([], "dense");
  scheduleSidebarHydration();
  if (livePulseText) livePulseText.textContent = `No results for "${normalizedQuery}"`;
  if (liveStatPrimary) liveStatPrimary.textContent = "0 search results";
  if (liveStatSecondary) liveStatSecondary.textContent = "Try another keyword";
  syncHomeSeo();
}

async function loadSidebar(forceRefresh = false) {
  if (isArchiveRouteState()) {
    if (homepageSidebarEl) homepageSidebarEl.hidden = true;
    return;
  }
  scheduleSidebarHydration({ forceRefresh });
}

async function loadStories(page = 1, forceRefresh = false, triggerBackendRefresh = false) {
  if (isLoading) return;
  isLoading = true;
  const requestId = ++activeLoadRequestId;
  const requestedFilter = activeFilter;
  const normalizedFilter = String(requestedFilter || "all").toLowerCase();
  currentPage = Math.max(1, Number(page) || 1);
  syncActiveControls();
  renderLoadingState();

  try {
    if (normalizedFilter === "all" || normalizedFilter === "latest") {
      const requiredPoolSize = Math.max(CATEGORY_POOL_FETCH_SIZE, getHomePageStoryWindow(page).endIndex);
      const poolPayload = await fetchCentralNews(1, "all", requiredPoolSize, forceRefresh, triggerBackendRefresh);
      if (requestId !== activeLoadRequestId) return;
      const derivedHomepageData = buildHomepageDataFromPool(poolPayload, page);
      applyHomepagePayload(
        derivedHomepageData.main,
        derivedHomepageData.mainStories,
        derivedHomepageData.categoryMap
      );
      return;
    }
    const main = await fetchCentralNews(
      page,
      normalizedFilter,
      getPageSizeForFilter(normalizedFilter),
      forceRefresh,
      triggerBackendRefresh
    );
    if (requestId !== activeLoadRequestId) return;

    const mainStories = dedupeStories(extractNewsStories(main));
    const initialCategoryMap = createEmptyCategoryMap();
    if (CATEGORY_KEYS.includes(normalizedFilter)) {
      initialCategoryMap[normalizedFilter] = mainStories;
    }

    applyHomepagePayload(main, mainStories, initialCategoryMap);
  } catch (_) {
    if (requestId !== activeLoadRequestId) return;
    if (currentPage > 1 && !activeSearchQuery) {
      syncHomeModeVisibility();
      renderPagination(Math.max(1, totalPages), currentPage);
      if (livePulseText) livePulseText.textContent = "Unable to refresh this page right now";
      if (liveStatPrimary) liveStatPrimary.textContent = "Showing last loaded stories";
      if (liveStatSecondary) liveStatSecondary.textContent = "Retry in a moment";
    } else {
      currentStories = [];
      currentCategoryMap = createEmptyCategoryMap();
      totalPages = 1;
      totalStories = 0;
      renderTicker([]);
      renderHomepageLayout(buildFocusedLayout([], activeFilter));
      scheduleSidebarHydration();
      renderPagination(1, 1);
      if (liveStatPrimary) liveStatPrimary.textContent = "0 stories on this page";
    }
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
  setAdminMenuOpenState(false);
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

showAllButton?.addEventListener("click", async () => {
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
      : loadStories(1, true, true),
    loadSidebar(true),
  ]);
});

authButton?.addEventListener("click", async () => {
  if (googleAuthSession?.email) {
    await logoutGoogleUser();
    return;
  }
  loginWithGoogle();
});

adminMenuButton?.addEventListener("click", () => {
  const isOpen = adminMenu?.classList.contains("is-open");
  siteHeader.classList.remove("is-open");
  prefetchAdminRoutes();
  setAdminMenuOpenState(!isOpen);
});

adminMenuButton?.addEventListener("pointerenter", () => {
  prefetchAdminRoutes();
}, { once: true });

adminMenuItems.forEach((item) => {
  item.addEventListener("click", async (event) => {
    const target = item.dataset.adminTarget || "home";
    setAdminMenuOpenState(false);
    if (target === "home") {
      event.preventDefault();
      window.location.assign("/");
      return;
    }
    event.preventDefault();
    await openAdminDashboard(target);
  });
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

document.addEventListener("mouseover", (event) => {
  const anchor = event.target instanceof Element
    ? event.target.closest('a[href^="/article/"]')
    : null;
  if (!anchor) return;
  const story = findStoryByArticleHref(anchor.getAttribute("href") || "");
  if (!story) return;
  void prefetchArticleForStory(story);
});

document.addEventListener("focusin", (event) => {
  const anchor = event.target instanceof Element
    ? event.target.closest('a[href^="/article/"]')
    : null;
  if (!anchor) return;
  const story = findStoryByArticleHref(anchor.getAttribute("href") || "");
  if (!story) return;
  void prefetchArticleForStory(story);
});

document.addEventListener("touchstart", (event) => {
  const anchor = event.target instanceof Element
    ? event.target.closest('a[href^="/article/"]')
    : null;
  if (!anchor) return;
  const story = findStoryByArticleHref(anchor.getAttribute("href") || "");
  if (!story) return;
  void prefetchArticleForStory(story);
}, { passive: true });

document.addEventListener("click", (event) => {
  if (adminMenu && !adminMenu.contains(event.target)) {
    setAdminMenuOpenState(false);
  }
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

syncHomeModeVisibility();
syncActiveControls();
consumeGoogleRedirectResponse();
syncAuthButton();
syncAdminMenu();
if (googleAuthSession?.email || newsroomRole) {
  void hydrateAdminSession({ quiet: true });
}
if (hasNewsroomAccess()) {
  scheduleIdleTask(() => {
    prefetchAdminRoutes();
  });
}
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
window.addEventListener("load", () => {
  scheduleIdleTask(() => {
    void loadSidebar();
    void loadHomeWidgetsModule();
    if (activeSearchQuery) void loadSearchModule();
  });
}, { once: true });
window.addEventListener("storage", (event) => {
  if (
    event.key !== GOOGLE_AUTH_SESSION_STORAGE_KEY
    && event.key !== GOOGLE_AUTH_ID_TOKEN_STORAGE_KEY
    && event.key !== NEWSROOM_ROLE_STORAGE_KEY
  ) return;
  googleAuthSession = readGoogleAuthSession();
  googleAuthIdToken = readGoogleAuthIdToken();
  newsroomRole = readStoredNewsroomRole();
  if (!googleAuthSession?.email && !googleAuthIdToken) {
    clearAdminSessionVerification();
    setNewsroomRole("");
  }
  syncAuthButton();
  syncAdminMenu();
  if (googleAuthSession?.email || newsroomRole) {
    void hydrateAdminSession({ quiet: true });
  }
});
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
  await loadStories(currentPage, true);
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
