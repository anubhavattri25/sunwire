const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { getBackendCompatiblePayload, getLastBackendCompatError } = require("../lib/server/backendCompat");
const {
  ALL_CATEGORIES,
  BUSINESS_COMPANY_TERMS,
  BUSINESS_KEYWORDS,
  CATEGORY_KEYWORDS,
  CDN_NEWS_CACHE_SECONDS,
  CDN_NEWS_STALE_SECONDS,
  CURATED_FALLBACK_INPUTS,
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  ENTERTAINMENT_BLOCK_TERMS,
  ENTERTAINMENT_CORE_TERMS,
  ENTERTAINMENT_CREATOR_TERMS,
  ENTERTAINMENT_ENTITIES,
  ENTERTAINMENT_HIGH_CONFIDENCE_TERMS,
  FETCH_RETRIES,
  FETCH_TIMEOUT_MS,
  FRESH_ALERT_WINDOW_MS,
  GOOGLE_TRENDS_BLOCK_TERMS,
  GOOGLE_TRENDS_IN_RSS_URL,
  HEADLINE_POWER_TERMS,
  IMPORTANT_WORLD_SIGNAL_TERMS,
  INDIA_AUDIENCE_PRIORITY_TERMS,
  MAX_ARTICLE_DB_SIZE,
  MAX_IMAGE_CACHE_SIZE,
  MAX_UNSPLASH_ENRICH_PER_RESPONSE,
  MIN_CATEGORY_STORIES,
  MIN_SCORE_BY_CATEGORY,
  PRIORITY_TOPICS,
  SEARCH_TREND_STOPWORDS,
  SNAPSHOT_TTL_MS,
  SOCIAL_SIGNAL_TERMS,
  SOURCE_BASE_PRIORITY,
  SOURCE_CATEGORY_HINTS,
  SPORTS_ENTITIES,
  STORY_IMAGE_CACHE_TTL_MS,
} = require("../lib/server/newsConfig");

const articleTimestampDb = new Map();
const articleStateDb = new Map();
const storyImageCache = new Map();
const unsplashQueryCache = new Map();
const SNAPSHOT_CACHE_FILE = path.join(os.tmpdir(), "sunwire-snapshot-cache.json");
let googleTrendsState = {
  generatedAt: "",
  topics: [],
};
const pipelineState = {
  lastRunId: "",
  lastAttemptAt: "",
  lastSuccessAt: "",
  lastDurationMs: 0,
  lastError: "",
  lastCacheInvalidationAt: "",
  cache: {
    generatedAt: "",
    expiresAt: 0,
    lastServedAt: "",
    hitCount: 0,
    missCount: 0,
  },
  sourceRuns: {},
  categoryRuns: {},
  recentRuns: [],
};
const INDIA_NEWS_TERMS = [
  "government", "cabinet", "minister", "prime minister", "parliament", "supreme court",
  "policy", "bill", "budget", "tax", "rbi", "rupee", "railway", "train", "flight",
  "delhi", "mumbai", "bengaluru", "hyderabad", "kolkata", "chennai", "weather",
  "cyclone", "earthquake", "army", "border", "defence", "defense", "election",
];
const VIRAL_INTERNET_TERMS = [
  "viral", "video", "meme", "reel", "reels", "hashtag", "creator", "influencer",
  "youtube", "instagram", "reddit", "twitter", "x", "internet", "social media",
  "trend", "trending", "backlash", "outrage", "feud", "clip",
];
const TOPIC_SECTION_LABELS = {
  ai: "AI / Tech",
  tech: "AI / Tech",
  sports: "Sports",
  entertainment: "Entertainment",
  "india-news": "India News",
  "viral-internet": "Viral / Internet",
};
const COMMON_KEYWORD_STOPWORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "why", "everyone", "talking",
  "about", "over", "into", "from", "with", "watch", "update", "breaking", "taking",
]);

function summarizeError(error) {
  if (!error) return "";
  return cleanText(error.message || String(error)).slice(0, 300);
}

function trimImageCaches() {
  const now = Date.now();

  for (const [key, value] of storyImageCache.entries()) {
    if (!value?.expiresAt || value.expiresAt <= now) storyImageCache.delete(key);
  }
  for (const [key, value] of unsplashQueryCache.entries()) {
    if (!value?.expiresAt || value.expiresAt <= now) unsplashQueryCache.delete(key);
  }

  while (storyImageCache.size > MAX_IMAGE_CACHE_SIZE) {
    const firstKey = storyImageCache.keys().next().value;
    if (!firstKey) break;
    storyImageCache.delete(firstKey);
  }
  while (unsplashQueryCache.size > MAX_IMAGE_CACHE_SIZE) {
    const firstKey = unsplashQueryCache.keys().next().value;
    if (!firstKey) break;
    unsplashQueryCache.delete(firstKey);
  }
}

function logEvent(event = "", details = {}) {
  console.log(JSON.stringify({
    scope: "sunwire.news",
    event,
    time: new Date().toISOString(),
    ...details,
  }));
}

function cleanText(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalUrlKey(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    parsed.hash = "";
    const removeParams = [
      "_ts", "oc", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "src", "guccounter", "guce_referrer", "guce_referrer_sig"
    ];
    removeParams.forEach((key) => parsed.searchParams.delete(key));
    const sorted = [...parsed.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    parsed.search = "";
    sorted.forEach(([key, val]) => parsed.searchParams.append(key, val));
    return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch (_) {
    return String(value || "").trim().toLowerCase();
  }
}

function fingerprintStory({ title = "", source = "", publishedAt = "" } = {}) {
  const day = normalizeIsoTimestamp(publishedAt || "").slice(0, 10);
  return normalizeForCompare(`${source} ${title} ${day}`);
}

function trimArticleStateDb() {
  if (articleStateDb.size <= MAX_ARTICLE_DB_SIZE) return;
  const keep = [...articleStateDb.entries()]
    .sort((a, b) => Date.parse(b[1].last_seen_at || b[1].injected_at || "") - Date.parse(a[1].last_seen_at || a[1].injected_at || ""))
    .slice(0, MAX_ARTICLE_DB_SIZE);
  articleStateDb.clear();
  keep.forEach(([storyId, state]) => articleStateDb.set(storyId, state));
}

function recordRunHistory(runSummary = {}) {
  pipelineState.recentRuns.unshift(runSummary);
  pipelineState.recentRuns = pipelineState.recentRuns.slice(0, 20);
}

function countFreshArticles(windowMs = 60 * 60 * 1000, category = "") {
  const now = Date.now();
  let count = 0;
  for (const state of articleStateDb.values()) {
    const injectedMs = Date.parse(state.injected_at || "");
    if (!injectedMs || (now - injectedMs) > windowMs) continue;
    if (category && state.category !== category) continue;
    count += 1;
  }
  return count;
}

function getPublicPipelineState() {
  const now = Date.now();
  const failingSources = Object.entries(pipelineState.sourceRuns)
    .filter(([, source]) => source.lastStatus !== "ok")
    .map(([name, source]) => ({
      source: name,
      status: source.lastStatus,
      error: source.lastError || "",
      lastAttemptAt: source.lastAttemptAt || "",
    }));

  const categories = {};
  ALL_CATEGORIES.forEach((category) => {
    const categoryState = pipelineState.categoryRuns[category] || {};
    categories[category] = {
      lastSuccessAt: categoryState.lastSuccessAt || "",
      totalReturnedLastRun: categoryState.totalReturnedLastRun || 0,
      insertedLastRun: categoryState.insertedLastRun || 0,
      freshLast1h: countFreshArticles(60 * 60 * 1000, category),
      freshLast6h: countFreshArticles(6 * 60 * 60 * 1000, category),
      freshLast24h: countFreshArticles(24 * 60 * 60 * 1000, category),
      alert: !categoryState.lastSuccessAt || ((now - Date.parse(categoryState.lastSuccessAt || 0)) > FRESH_ALERT_WINDOW_MS)
        ? "no_fresh_ingestion_recently"
        : "",
    };
  });

  return {
    lastRunId: pipelineState.lastRunId,
    lastAttemptAt: pipelineState.lastAttemptAt,
    lastSuccessAt: pipelineState.lastSuccessAt,
    lastDurationMs: pipelineState.lastDurationMs,
    lastError: pipelineState.lastError,
    cache: {
      generatedAt: pipelineState.cache.generatedAt,
      expiresAt: pipelineState.cache.expiresAt ? new Date(pipelineState.cache.expiresAt).toISOString() : "",
      lastServedAt: pipelineState.cache.lastServedAt,
      hitCount: pipelineState.cache.hitCount,
      missCount: pipelineState.cache.missCount,
      lastCacheInvalidationAt: pipelineState.lastCacheInvalidationAt,
    },
    freshArticles: {
      last1h: countFreshArticles(60 * 60 * 1000),
      last6h: countFreshArticles(6 * 60 * 60 * 1000),
      last24h: countFreshArticles(24 * 60 * 60 * 1000),
    },
    categories,
    failingSources,
    env: {
      OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim()),
    },
    recentRuns: pipelineState.recentRuns,
  };
}

function hashString(input = "") {
  let hash = 0;
  const str = String(input);
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return `s${Math.abs(hash)}`;
}

function extractFirstImage(text = "") {
  const input = String(text);
  const imgMatch = input.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) return imgMatch[1];
  const urlMatch = input.match(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif)/i);
  if (urlMatch?.[0]) return urlMatch[0];
  return "";
}

function normalizeForCompare(text = "") {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeadline(title = "") {
  return normalizeForCompare(title);
}

function toDisplayCase(text = "") {
  return cleanText(text).replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseApproxTraffic(value = "") {
  const normalized = cleanText(value).replace(/,/g, "").toUpperCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([KMB])?\+?/);
  if (!match) return 0;

  const amount = Number(match[1] || 0);
  const multiplier = match[2] === "M"
    ? 1000000
    : match[2] === "B"
      ? 1000000000
      : match[2] === "K"
        ? 1000
        : 1;
  return Math.round(amount * multiplier);
}

function buildTrendKeywords(topic = "") {
  return [...new Set(
    normalizeForCompare(topic)
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => word.length >= 3)
      .filter((word) => !SEARCH_TREND_STOPWORDS.has(word))
  )];
}

function isBlockedTrendTopic(topic = "", relatedTitles = []) {
  const combined = normalizeForCompare(`${topic} ${relatedTitles.join(" ")}`);
  if (GOOGLE_TRENDS_BLOCK_TERMS.some((term) => combined.includes(normalizeForCompare(term)))) return true;
  if (
    /(divorce|breakup|dating|wedding|husband|wife|girlfriend|boyfriend)/i.test(combined)
    && /(actor|actress|celebrity|bollywood|hollywood|star)/i.test(combined)
  ) {
    return true;
  }
  return false;
}

function isUsefulIndiaTrend(topic = "", relatedTitles = [], category = "tech") {
  const combined = normalizeForCompare(`${topic} ${relatedTitles.join(" ")}`);
  if (isBlockedTrendTopic(topic, relatedTitles)) return false;
  if (computeIndiaAudienceRelevance(combined) >= 18) return true;
  if (category === "sports") {
    return /india|indian|cricket|ipl|icc|rohit|virat|dhoni|football|soccer|ranking|match|world cup/i.test(combined);
  }
  if (category === "entertainment") {
    return /movie|film|box office|trailer|teaser|ott|netflix|prime video|release|album|song/i.test(combined);
  }
  if (category === "ai") {
    return /ai|openai|anthropic|gemini|llm|model|agent|chip|robot|startup/i.test(combined);
  }
  if (category === "tech") {
    return /iphone|apple|google|microsoft|startup|software|device|app|market|stock|share|finance|bank|oil|economy|tariff|rupee|budget/i.test(combined);
  }
  return false;
}

function computeIndiaAudienceRelevance(text = "") {
  const normalized = normalizeForCompare(text);
  const indiaMatches = uniqueMatches(normalized, INDIA_AUDIENCE_PRIORITY_TERMS).length;
  const importantWorldMatches = uniqueMatches(normalized, IMPORTANT_WORLD_SIGNAL_TERMS).length;
  return Math.min(100, (indiaMatches * 14) + (importantWorldMatches * 10));
}

function computeSearchTrendSignals(text = "", category = "tech") {
  const normalized = normalizeForCompare(text);
  if (!normalized || !googleTrendsState.topics.length) {
    return {
      searchTrendScore: 0,
      searchTrendTopic: "",
      searchTrendTraffic: 0,
      indiaAudienceRelevance: computeIndiaAudienceRelevance(text),
    };
  }

  let bestMatch = null;

  googleTrendsState.topics.forEach((trend) => {
    const exactTopic = Boolean(trend.normalizedTopic) && normalized.includes(trend.normalizedTopic);
    const keywordHits = (trend.keywords || []).filter((keyword) => normalized.includes(keyword)).length;
    if (
      !exactTopic
      && (
        !trend.normalizedTopic
        || !trend.keywords.length
        || keywordHits < Math.min(2, Math.max(1, trend.keywords.length))
        || trend.category !== category
      )
    ) return;

    const score = Math.min(
      100,
      (exactTopic ? 28 : 0)
      + (keywordHits * 10)
      + trend.trafficScore
      + (trend.category === category ? 8 : 0)
      + (trend.indiaPriority ? 10 : 0)
    );

    if (!bestMatch || score > bestMatch.searchTrendScore) {
      bestMatch = {
        searchTrendScore: score,
        searchTrendTopic: trend.topic,
        searchTrendTraffic: trend.traffic,
        indiaAudienceRelevance: Math.max(
          computeIndiaAudienceRelevance(text),
          trend.indiaPriority ? 26 : 0
        ),
      };
    }
  });

  return bestMatch || {
    searchTrendScore: 0,
    searchTrendTopic: "",
    searchTrendTraffic: 0,
    indiaAudienceRelevance: computeIndiaAudienceRelevance(text),
  };
}

function cleanTitle(title = "", source = "") {
  let value = cleanText(title)
    .replace(/\s*:\s*practical update\s*#\d+\b/gi, "")
    .replace(/\s*practical update\s*#\d+\b/gi, "")
    .replace(/\s*update\s*#\d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (String(source).startsWith("Google News")) {
    value = value.replace(/\s+-\s+[^-]{2,60}$/g, "").trim();
  }

  return value;
}

function classifyCategory(text = "") {
  const lower = cleanText(text).toLowerCase();
  const score = {
    ai: 0,
    tech: 0,
    entertainment: 0,
    sports: 0,
  };

  ALL_CATEGORIES.forEach((category) => {
    (CATEGORY_KEYWORDS[category] || []).forEach((keyword) => {
      if (lower.includes(keyword)) score[category] += 1;
    });
  });

  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!ranked[0] || ranked[0][1] === 0) return "tech";
  return ranked[0][0];
}

function classifyTopicSection(text = "", category = "tech") {
  const normalized = normalizeForCompare(text);
  const indiaMatches = uniqueMatches(normalized, INDIA_NEWS_TERMS).length;
  const viralMatches = uniqueMatches(normalized, VIRAL_INTERNET_TERMS).length;
  const indiaAudienceRelevance = computeIndiaAudienceRelevance(normalized);

  if (indiaAudienceRelevance >= 28) return "india-news";
  if (indiaAudienceRelevance >= 20 && indiaMatches >= 1) return "india-news";
  if (viralMatches >= 2) return "viral-internet";
  if (category === "sports") return "sports";
  if (category === "entertainment") return "entertainment";
  return "ai";
}

function normalizeTrendTopic(topic = "") {
  const value = cleanText(topic)
    .replace(/^#+/g, "")
    .replace(/\s+\|\s+.*$/g, "")
    .replace(/\b(?:trending|trend|latest|today)\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s*[kmb]?\+?\s*(?:posts?|videos?|views?)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!value || value.length < 3) return "";
  if (/^[0-9]/.test(value) && !/\s/.test(value)) return "";
  if (/^[a-f0-9]{6,}$/i.test(value)) return "";
  if (value.length <= 3 && /^[a-z]+$/.test(value)) return "";
  if (/^([a-z])\1{2,}$/i.test(value)) return "";
  if (/^(home|menu|india|trends24|timeline|latest|photos|videos|stories|explore)$/i.test(value)) return "";
  return value;
}

function decodeJsonText(value = "") {
  return cleanText(
    String(value || "")
      .replace(/\\"/g, "\"")
      .replace(/\\u0026/g, "&")
      .replace(/\\u003d/g, "=")
      .replace(/\\u002f/g, "/")
      .replace(/\\u2019/g, "'")
      .replace(/\\u201c|\\u201d/g, "\"")
      .replace(/\\n/g, " ")
      .replace(/\\\\/g, "\\")
  );
}

function dedupeTopics(topics = [], limit = 12) {
  const seen = new Set();
  const output = [];

  topics.forEach((topic) => {
    const normalized = normalizeForCompare(normalizeTrendTopic(topic));
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalizeTrendTopic(topic));
  });

  return output.slice(0, limit);
}

function slugFragment(text = "") {
  return normalizeForCompare(text).replace(/\s+/g, "-").slice(0, 80);
}

function isMostlyEnglish(text = "") {
  const sample = cleanText(text).slice(0, 220);
  if (!sample) return false;
  const nonLatin = (sample.match(/[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g) || []).length;
  if (nonLatin > 3) return false;
  const asciiish = (sample.match(/[A-Za-z0-9\s.,:;!?()'"\-]/g) || []).length;
  if ((asciiish / sample.length) < 0.82) return false;
  const lower = sample.toLowerCase();
  const commonWords = ["the", "and", "for", "with", "from", "this", "that", "is", "in"];
  return commonWords.some((word) => lower.includes(` ${word} `) || lower.startsWith(`${word} `));
}

function uniqueMatches(text = "", terms = []) {
  const normalized = normalizeForCompare(text);
  const matches = new Set();
  terms.forEach((term) => {
    if (normalized.includes(normalizeForCompare(term))) matches.add(term);
  });
  return [...matches];
}

function escapeRegex(text = "") {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function strictTermMatches(text = "", terms = []) {
  const normalized = normalizeForCompare(text);
  const matches = new Set();
  terms.forEach((term) => {
    const normalizedTerm = normalizeForCompare(term);
    if (!normalizedTerm) return;
    const pattern = new RegExp(`(^|\\s)${normalizedTerm.split(/\s+/).map(escapeRegex).join("\\s+")}(?=\\s|$)`, "i");
    if (pattern.test(normalized)) matches.add(term);
  });
  return [...matches];
}

function isUsableRemoteImage(url = "") {
  const value = cleanText(url);
  if (!/^https?:\/\//i.test(value)) return false;
  if (/\.svg(\?|$)/i.test(value)) return false;
  return true;
}

function imageCacheKeyForStory(story = {}) {
  return canonicalUrlKey(story.sourceUrl || story.url || "")
    || normalizeHeadline(story.title || "")
    || String(story.id || "");
}

function hashToIndex(seed = "", length = 1) {
  if (!length) return 0;
  const normalized = String(seed || "");
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % length;
}

function compactQueryText(text = "", maxWords = 8) {
  return cleanText(text)
    .replace(/\b(exclusive|revealed|closing numbers|advance booking report|full story|latest|collection day \d+|day \d+|report|live updates?)\b/gi, " ")
    .replace(/[|:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, maxWords)
    .join(" ");
}

function buildUnsplashQuery(story = {}) {
  const title = cleanTitle(story.title || "", story.source || "");
  const combined = `${title} ${story.summary || ""} ${story.category || ""}`;
  const category = story.category || classifyCategory(combined);

  if (category === "entertainment") {
    const entity = firstEntity(combined, ENTERTAINMENT_ENTITIES);
    const focus = compactQueryText(entity || title, 6);
    if (/award|oscar|bafta|grammy|festival/i.test(combined)) return `${focus} red carpet awards`;
    if (/box office|movie|film|trailer|cinema/i.test(combined)) return `${focus} movie cinema`;
    return `${focus} entertainment celebrity`;
  }

  if (category === "sports") {
    const entity = firstEntity(combined, SPORTS_ENTITIES);
    const focus = compactQueryText(entity || title, 6);
    if (/cricket|ipl|icc|virat|rohit|dhoni/i.test(combined)) return `${focus} cricket stadium action`;
    if (/football|soccer|champions league|messi|ronaldo/i.test(combined)) return `${focus} football stadium action`;
    return `${focus} sports action`;
  }

  if (category === "ai") {
    return `${compactQueryText(title, 7)} artificial intelligence technology`;
  }

  if (category === "business") {
    return `${compactQueryText(title, 7)} business finance market`;
  }

  return `${compactQueryText(title, 7)} technology innovation`;
}

function withUnsplashImageParams(url = "", width = 1400) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("auto", "format");
    parsed.searchParams.set("fit", "crop");
    parsed.searchParams.set("w", String(width));
    parsed.searchParams.set("q", "80");
    return parsed.toString();
  } catch (_) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}auto=format&fit=crop&w=${width}&q=80`;
  }
}

async function fetchUnsplashCandidates(query = "") {
  const accessKey = String(process.env.UNSPLASH_ACCESS_KEY || "").trim();
  const normalizedQuery = normalizeForCompare(query);
  if (!accessKey || !normalizedQuery) return [];

  trimImageCaches();
  const cached = unsplashQueryCache.get(normalizedQuery);
  if (cached?.expiresAt > Date.now() && Array.isArray(cached.results)) {
    return cached.results;
  }

  try {
    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", query);
    url.searchParams.set("page", "1");
    url.searchParams.set("per_page", "6");
    url.searchParams.set("orientation", "landscape");
    url.searchParams.set("content_filter", "high");

    const response = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        "Accept-Version": "v1",
      },
    });

    if (!response.ok) {
      throw new Error(`Unsplash returned ${response.status}`);
    }

    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results.map((item) => ({
      image: withUnsplashImageParams(item?.urls?.regular || item?.urls?.full || "", 1400),
      thumb: withUnsplashImageParams(item?.urls?.small || item?.urls?.thumb || "", 600),
    })).filter((item) => isUsableRemoteImage(item.image)) : [];

    unsplashQueryCache.set(normalizedQuery, {
      expiresAt: Date.now() + STORY_IMAGE_CACHE_TTL_MS,
      results,
    });
    trimImageCaches();
    return results;
  } catch (error) {
    logEvent("image.unsplash.error", { query, error: summarizeError(error) });
    return [];
  }
}

async function resolveStoryImage(story = {}) {
  if (isUsableRemoteImage(story.image || story.image_url)) return story;

  const cacheKey = imageCacheKeyForStory(story);
  trimImageCaches();

  if (cacheKey) {
    const cached = storyImageCache.get(cacheKey);
    if (cached?.expiresAt > Date.now()) {
      return {
        ...story,
        image: cached.image,
      };
    }
  }

  const fallbackQueries = [
    buildUnsplashQuery(story),
    `${compactQueryText(story.title || "", 5)} ${story.category || "news"}`.trim(),
    `${story.category || "news"} feature`.trim(),
  ].filter(Boolean);

  let candidates = [];
  for (const query of [...new Set(fallbackQueries)]) {
    candidates = await fetchUnsplashCandidates(query);
    if (candidates.length) break;
  }
  if (!candidates.length) return story;

  const selected = candidates[hashToIndex(story.id || story.title || cacheKey, candidates.length)] || candidates[0];
  if (!selected?.image) return story;

  if (cacheKey) {
    storyImageCache.set(cacheKey, {
      image: selected.image,
      expiresAt: Date.now() + STORY_IMAGE_CACHE_TTL_MS,
    });
    trimImageCaches();
  }

  return {
    ...story,
    image: selected.image,
  };
}

async function enrichVisibleStoriesWithImages(stories = []) {
  if (!Array.isArray(stories) || !stories.length) return stories;
  if (!String(process.env.UNSPLASH_ACCESS_KEY || "").trim()) return stories;

  const picks = new Map();
  const mark = (story) => {
    const key = imageCacheKeyForStory(story);
    if (!key || picks.has(key)) return;
    picks.set(key, story);
  };

  stories.slice(0, 16).forEach(mark);
  [...stories].sort(sortByTrendThenTime).slice(0, 12).forEach(mark);

  const targetStories = [...picks.values()]
    .filter((story) => !isUsableRemoteImage(story.image || story.image_url))
    .slice(0, MAX_UNSPLASH_ENRICH_PER_RESPONSE);

  if (!targetStories.length) return stories;

  const enrichedByKey = new Map(
    await Promise.all(targetStories.map(async (story) => {
      const enriched = await resolveStoryImage(story);
      return [imageCacheKeyForStory(story), enriched];
    }))
  );

  return stories.map((story) => {
    const key = imageCacheKeyForStory(story);
    return enrichedByKey.get(key) || story;
  });
}

function isBusinessStory(story = {}) {
  if (story.category === "business") return true;

  const combined = [
    story.title,
    story.summary,
    story.rawText,
    story.fullDescription,
    story.source,
  ].filter(Boolean).join(" ");

  if (!cleanText(combined)) return false;

  const keywordMatches = uniqueMatches(combined, BUSINESS_KEYWORDS).length;
  const companyMatches = uniqueMatches(combined, BUSINESS_COMPANY_TERMS).length;

  if (keywordMatches >= 2) return true;
  if (keywordMatches >= 1 && companyMatches >= 1) return true;
  if (/\b(startup funding|series [abcde]|earnings|quarterly results|share price|market share|ipo|acquisition|merger)\b/i.test(combined)) {
    return true;
  }

  return false;
}

function relevanceScore(text = "", category = "tech") {
  return uniqueMatches(text, CATEGORY_KEYWORDS[category] || CATEGORY_KEYWORDS.tech).length;
}

function countHeadlineHooks(title = "") {
  const normalized = normalizeForCompare(title);
  return HEADLINE_POWER_TERMS.reduce((count, term) => count + (normalized.includes(term) ? 1 : 0), 0);
}

function computeHeadlineStrength(title = "") {
  const cleaned = cleanText(title);
  if (!cleaned) return 0;

  let score = 20;
  if (cleaned.length >= 40 && cleaned.length <= 110) score += 18;
  if (/\d/.test(cleaned)) score += 10;
  if (/[:\-]/.test(cleaned)) score += 8;
  if (/^(how|why|what|who|when)\b/i.test(cleaned)) score += 8;
  score += Math.min(24, countHeadlineHooks(cleaned) * 6);

  return Math.min(100, score);
}

function computeKeywordPopularity(text = "", category = "tech") {
  const categoryMatches = uniqueMatches(text, CATEGORY_KEYWORDS[category] || []).length * 7;
  const priorityMatches = uniqueMatches(text, PRIORITY_TOPICS[category] || []).length * 12;
  return Math.min(100, categoryMatches + priorityMatches);
}

function computeSocialMentions(text = "", sourceEngagement = 0, category = "tech") {
  const normalizedEngagement = Math.min(70, Math.log10(toNumber(sourceEngagement, 0) + 1) * 24);
  const signalMatches = uniqueMatches(text, SOCIAL_SIGNAL_TERMS[category] || []).length * 8;
  return Math.min(100, normalizedEngagement + signalMatches);
}

function computeCelebrityPresence(text = "") {
  const entityMatches = uniqueMatches(text, ENTERTAINMENT_ENTITIES).length * 18;
  const termMatches = uniqueMatches(text, ["celebrity", "actor", "actress", "influencer", "creator", "relationship", "breakup"]).length * 10;
  return Math.min(100, entityMatches + termMatches);
}

function computeSportsPlayerPresence(text = "") {
  const entityMatches = uniqueMatches(text, SPORTS_ENTITIES).length * 18;
  const termMatches = uniqueMatches(text, ["match", "win", "goal", "injury", "transfer", "record", "medal", "final"]).length * 10;
  return Math.min(100, entityMatches + termMatches);
}

function computeEntertainmentFocus(text = "") {
  const coreMatches = strictTermMatches(text, ENTERTAINMENT_CORE_TERMS).length * 16;
  const creatorMatches = strictTermMatches(text, ENTERTAINMENT_CREATOR_TERMS).length * 8;
  const entityMatches = strictTermMatches(text, ENTERTAINMENT_ENTITIES).length * 20;
  const blockMatches = strictTermMatches(text, ENTERTAINMENT_BLOCK_TERMS).length * 18;
  const rawScore = coreMatches + creatorMatches + entityMatches - blockMatches;
  return Math.max(0, Math.min(100, rawScore));
}

function hasEntertainmentIntent(text = "") {
  const normalized = normalizeForCompare(text);
  const coreMatches = strictTermMatches(normalized, ENTERTAINMENT_CORE_TERMS).length;
  const creatorMatches = strictTermMatches(normalized, ENTERTAINMENT_CREATOR_TERMS).length;
  const entityMatches = strictTermMatches(normalized, ENTERTAINMENT_ENTITIES).length;
  const blockMatches = strictTermMatches(normalized, ENTERTAINMENT_BLOCK_TERMS).length;
  const highConfidenceMatches = strictTermMatches(normalized, ENTERTAINMENT_HIGH_CONFIDENCE_TERMS).length;
  const strongStoryHook = /box office|trailer|teaser|premiere|award|relationship|breakup|celebrity|actor|actress|ott|movie|film|album|soundtrack/.test(normalized);

  if (blockMatches >= 1 && highConfidenceMatches === 0) return false;
  if (blockMatches >= 2 && coreMatches < 2 && entityMatches === 0) return false;
  if (coreMatches >= 2) return true;
  if (strongStoryHook && blockMatches === 0) return true;
  if (entityMatches > 0 && blockMatches === 0) return true;
  if (coreMatches >= 1 && creatorMatches >= 1 && blockMatches === 0) return true;
  return false;
}

function isEntertainmentSourceFit(story = {}) {
  if (story.category !== "entertainment") return true;
  if (story.source !== "Engadget") return true;

  const combined = `${story.title} ${story.rawText} ${story.fullDescription}`;
  const hasStreamingOrScreenSignal = /streaming|netflix|prime video|jiohotstar|disney\+|movie|film|series|actor|actress|celebrity|box office|award|ott/i.test(combined);
  const hasGamingNoise = /game|gaming|gamer|xbox|playstation|ps5|nintendo|switch|steam|esports|franchise|studio/i.test(combined);
  const hasPolicyNoise = /government|ban|policy|regulation|law|rules|copyright/i.test(combined);

  if (hasGamingNoise && !/movie|film|series|streaming|netflix|prime video|jiohotstar|disney\+|actor|actress|celebrity/i.test(combined)) {
    return false;
  }

  if (hasPolicyNoise && !/actor|actress|celebrity|movie|film|music|artist|album|song|streaming|netflix|prime video/i.test(combined)) {
    return false;
  }

  return hasStreamingOrScreenSignal;
}

function computeCategoryPresence(text = "", category = "tech") {
  if (category === "entertainment") return Math.max(computeCelebrityPresence(text), computeEntertainmentFocus(text));
  if (category === "sports") return computeSportsPlayerPresence(text);
  return Math.min(100, uniqueMatches(text, PRIORITY_TOPICS[category] || []).length * 15);
}

function computeEngagementSignals({
  title = "",
  rawText = "",
  fullDescription = "",
  category = "tech",
  sourceEngagement = 0,
}) {
  const combined = `${title} ${rawText} ${fullDescription}`;
  const keywordPopularity = computeKeywordPopularity(combined, category);
  const socialMentions = computeSocialMentions(combined, sourceEngagement, category);
  const headlineStrength = computeHeadlineStrength(title);
  const categoryPresence = computeCategoryPresence(combined, category);
  const trendSignals = computeSearchTrendSignals(`${title} ${combined}`, category);
  const celebrityPresence = category === "entertainment" ? categoryPresence : 0;
  const sportsPlayerPresence = category === "sports" ? categoryPresence : 0;
  const total = Math.round(
    (keywordPopularity * 0.24)
    + (socialMentions * 0.22)
    + (categoryPresence * 0.14)
    + (headlineStrength * 0.14)
    + (trendSignals.searchTrendScore * 0.18)
    + (trendSignals.indiaAudienceRelevance * 0.08)
  );

  return {
    keywordPopularity,
    socialMentions,
    headlineStrength,
    celebrityPresence,
    sportsPlayerPresence,
    searchTrendScore: trendSignals.searchTrendScore,
    searchTrendTopic: trendSignals.searchTrendTopic,
    searchTrendTraffic: trendSignals.searchTrendTraffic,
    indiaAudienceRelevance: trendSignals.indiaAudienceRelevance,
    total,
  };
}

function firstEntity(text = "", entities = []) {
  const normalized = normalizeForCompare(text);
  return entities.find((entity) => normalized.includes(normalizeForCompare(entity))) || "";
}

function headlineLooksStrong(title = "", category = "tech") {
  const strength = computeHeadlineStrength(title);
  if (strength >= 62) return true;
  if (category === "entertainment" && /box office|trailer|ott|celebrity|award|relationship|controversy/i.test(title)) return true;
  if (category === "sports" && /ipl|cricket|virat|rohit|dhoni|messi|ronaldo|final|transfer|injury|record/i.test(title)) return true;
  return false;
}

function buildTrendingHeadline(baseTitle = "", {
  topicSection = "",
  rawText = "",
  featured = false,
  socialMentions = 0,
  searchTrendScore = 0,
  indiaAudienceRelevance = 0,
} = {}) {
  const title = cleanText(baseTitle);
  const lower = normalizeForCompare(`${title} ${rawText}`);
  if (!title) return "";
  if (/^(breaking|shocking update about|why everyone is talking about|this viral video is taking over the internet)/i.test(title)) {
    return title;
  }
  if (topicSection === "viral-internet" && /video|clip|reel|meme/i.test(lower)) {
    return `This Viral Video Is Taking Over The Internet: ${title}`;
  }
  if (topicSection === "india-news" && (featured || indiaAudienceRelevance >= 34)) {
    return `Breaking: ${title}`;
  }
  if ((featured || socialMentions >= 28 || searchTrendScore >= 26) && /controversy|backlash|outrage|row|feud|slam|accus/i.test(lower)) {
    return `Shocking Update About ${title}`;
  }
  if (featured || socialMentions >= 32 || searchTrendScore >= 28) {
    return `Why Everyone Is Talking About ${title}`;
  }
  return "";
}

function buildStoryKeywords(title = "", {
  category = "tech",
  topicSection = "",
  searchTrendTopic = "",
} = {}) {
  const tokens = [
    ...buildTrendKeywords(title),
    ...buildTrendKeywords(searchTrendTopic),
    ...(PRIORITY_TOPICS[category] || []).slice(0, 4),
  ];
  if (topicSection === "india-news") tokens.push("india news", "government update");
  if (topicSection === "viral-internet") tokens.push("viral story", "internet trend");
  return [...new Set(
    tokens
      .map((token) => cleanText(token).toLowerCase())
      .filter(Boolean)
      .filter((token) => !COMMON_KEYWORD_STOPWORDS.has(token))
  )].slice(0, 8);
}

function rewriteHeadline(title = "", {
  category = "tech",
  rawText = "",
  searchTrendTopic = "",
  topicSection = "",
  featured = false,
  socialMentions = 0,
  searchTrendScore = 0,
  indiaAudienceRelevance = 0,
} = {}) {
  const baseTitle = cleanText(title);
  if (!baseTitle) return baseTitle;
  if (headlineLooksStrong(baseTitle, category)) return baseTitle;

  const lower = `${baseTitle} ${rawText}`.toLowerCase();
  const entertainmentEntity = firstEntity(`${baseTitle} ${rawText}`, ENTERTAINMENT_ENTITIES);
  const sportsEntity = firstEntity(`${baseTitle} ${rawText}`, SPORTS_ENTITIES);
  const trendHeadline = buildTrendingHeadline(baseTitle, {
    topicSection,
    rawText,
    featured,
    socialMentions,
    searchTrendScore,
    indiaAudienceRelevance,
  });
  if (trendHeadline) return trendHeadline;

  if (category === "entertainment") {
    if (/box office/i.test(lower)) return `Box Office Watch: ${baseTitle}`;
    if (/trailer|teaser/i.test(lower)) return `Trailer Buzz: ${baseTitle}`;
    if (/ott|netflix|prime video|jiohotstar|disney\+/i.test(lower)) return `OTT Watch: ${baseTitle}`;
    if (/relationship|breakup|controversy|viral/i.test(lower)) return `Celebrity Buzz: ${baseTitle}`;
    if (entertainmentEntity) return `${entertainmentEntity.replace(/\b\w/g, (c) => c.toUpperCase())} Update: ${baseTitle}`;
  }

  if (category === "sports") {
    if (/transfer/i.test(lower)) return `Transfer Watch: ${baseTitle}`;
    if (/injury/i.test(lower)) return `Injury Watch: ${baseTitle}`;
    if (/final|semifinal|knockout|tournament/i.test(lower)) return `Tournament Watch: ${baseTitle}`;
    if (/ipl|cricket|virat|rohit|dhoni|icc/i.test(lower)) return `Cricket Watch: ${baseTitle}`;
    if (/messi|ronaldo|champions league|premier league|football|soccer/i.test(lower)) return `Football Watch: ${baseTitle}`;
    if (sportsEntity) return `${sportsEntity.replace(/\b\w/g, (c) => c.toUpperCase())} Watch: ${baseTitle}`;
  }

  if (category === "ai" && /agent|llm|model|openai|anthropic|gemini|deepseek/i.test(lower)) {
    return `AI Watch: ${baseTitle}`;
  }

  if (category === "tech" && /cloud|cybersecurity|chip|gpu|developer|api|startup/i.test(lower)) {
    return `Tech Watch: ${baseTitle}`;
  }

  if (searchTrendTopic) {
    return `${toDisplayCase(searchTrendTopic)}: ${baseTitle}`;
  }

  return baseTitle;
}

function squeezeRepeatedChunks(text = "") {
  let out = cleanText(text);
  const repeatChunk = /(\b(?:\w+\s+){5,}\w+\b)(?:\s+\1)+/gi;
  out = out.replace(repeatChunk, "$1");
  return out;
}

function sentenceToAction(sentence = "") {
  const value = cleanText(sentence).replace(/[.]+$/g, "");
  if (!value) return "";
  if (/^(teams|readers|fans|viewers)\s+should\s+/i.test(value)) {
    return value.replace(/^(teams|readers|fans|viewers)\s+should\s+/i, "");
  }
  if (/^(should|must|need to)\s+/i.test(value)) {
    return value.replace(/^(should|must|need to)\s+/i, "");
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function summarizeParagraph(title = "", text = "", category = "tech") {
  const cleaned = squeezeRepeatedChunks(text);
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20)
    .filter((sentence) => !/this matters because|experts believe|it highlights the importance|a practical next step|watch for follow-through|trending in india:|approx search traffic|platform performance|engineering velocity|traffic potential/i.test(sentence));

  const unique = [];
  const seen = new Set();
  sentences.forEach((sentence) => {
    const key = normalizeForCompare(sentence);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(sentence);
    }
  });

  const ranked = unique
    .map((sentence, index) => ({
      sentence,
      score: relevanceScore(sentence, category) + (/\d|%|\$|million|billion|record|milestone|release|weekend|match/i.test(sentence) ? 2 : 0) - Math.min(index, 4),
    }))
    .sort((left, right) => right.score - left.score);

  const chosen = [];
  for (const entry of ranked) {
    if (chosen.length >= 2) break;
    if (chosen.some((sentence) => normalizeForCompare(sentence) === normalizeForCompare(entry.sentence))) continue;
    chosen.push(entry.sentence);
  }

  if (chosen.length) {
    return chosen.map((sentence) => sentence.slice(0, 190)).join(" ").trim();
  }

  return cleanText(title || "").slice(0, 190);
}
function normalizeIsoTimestamp(value = "") {
  const ms = Date.parse(value || "");
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toISOString();
}

function toMillis(isoString) {
  const value = Date.parse(isoString || "");
  return Number.isNaN(value) ? 0 : value;
}

function trimTimestampDb() {
  if (articleTimestampDb.size <= MAX_ARTICLE_DB_SIZE) return;
  const keep = [...articleTimestampDb.entries()]
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
    .slice(0, MAX_ARTICLE_DB_SIZE);
  articleTimestampDb.clear();
  keep.forEach(([storyId, publishedAt]) => articleTimestampDb.set(storyId, publishedAt));
}

function getStoredPublishedAt(storyId = "", incomingPublishedAt = "") {
  const safeId = String(storyId || "");
  const normalizedIncoming = normalizeIsoTimestamp(incomingPublishedAt);
  if (!safeId) return normalizedIncoming || "";
  if (articleTimestampDb.has(safeId)) return articleTimestampDb.get(safeId);
  if (!normalizedIncoming) return "";

  articleTimestampDb.set(safeId, normalizedIncoming);
  trimTimestampDb();
  return normalizedIncoming;
}

function getStoryTimeline({
  storyId = "",
  sourceUrl = "",
  title = "",
  source = "",
  category = "tech",
  incomingPublishedAt = "",
}) {
  const safeId = String(storyId || "");
  const sourcePublishedAt = getStoredPublishedAt(safeId, incomingPublishedAt);
  const nowIso = new Date().toISOString();
  const urlKey = canonicalUrlKey(sourceUrl);
  const fingerprint = fingerprintStory({ title, source, publishedAt: sourcePublishedAt });
  const existing = articleStateDb.get(safeId);

  if (existing) {
    const nextState = {
      ...existing,
      last_seen_at: nowIso,
      source_published_at: sourcePublishedAt || existing.source_published_at || "",
      category: category || existing.category || "tech",
      url_key: urlKey || existing.url_key || "",
      fingerprint: fingerprint || existing.fingerprint || "",
      source: source || existing.source || "",
    };
    articleStateDb.set(safeId, nextState);
    trimArticleStateDb();
    return {
      sourcePublishedAt: nextState.source_published_at || "",
      injectedAt: nextState.injected_at || sourcePublishedAt || nowIso,
    };
  }

  articleStateDb.set(safeId, {
    id: safeId,
    source,
    category,
    url_key: urlKey,
    fingerprint,
    source_published_at: sourcePublishedAt || "",
    injected_at: nowIso,
    last_seen_at: nowIso,
  });
  trimArticleStateDb();

  return {
    sourcePublishedAt: sourcePublishedAt || "",
    injectedAt: nowIso,
  };
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function storySortTimestamp(story = {}) {
  return story.source_published_at || story.published_at || story.publishedAt || story.injected_at || "";
}

function getSourceBasePriority(source = "") {
  const normalized = cleanText(source);
  if (!normalized) return 60;
  if (SOURCE_BASE_PRIORITY[normalized] != null) return SOURCE_BASE_PRIORITY[normalized];
  if (normalized.startsWith("Google News India Public Interest")) return SOURCE_BASE_PRIORITY["Google News India Public Interest"];
  if (normalized.startsWith("Google News India Economy")) return SOURCE_BASE_PRIORITY["Google News India Economy"];
  if (normalized.startsWith("Google Trends India")) return SOURCE_BASE_PRIORITY["Google Trends India"];
  if (normalized.startsWith("Google News")) return SOURCE_BASE_PRIORITY["Google News Tech"];
  if (normalized.startsWith("Hacker News")) return SOURCE_BASE_PRIORITY["Hacker News"];
  if (normalized.startsWith("Reddit")) return SOURCE_BASE_PRIORITY.Reddit;
  return 60;
}

function computePriority({
  source = "",
  category = "tech",
  publishedAt = "",
  engagementSignals = {},
  explicitPriority = 0,
  featured = false,
}) {
  const base = getSourceBasePriority(source);
  const explicit = toNumber(explicitPriority, 0);
  const ageHours = Math.max(0, (Date.now() - (Date.parse(publishedAt || "") || Date.now())) / (1000 * 60 * 60));
  const freshness = Math.max(0, 28 - (ageHours * 1.1));
  const engagementBoost = toNumber(engagementSignals.total, 0) * 0.7;
  const presenceBoost = Math.max(
    toNumber(engagementSignals.celebrityPresence, 0),
    toNumber(engagementSignals.sportsPlayerPresence, 0),
    toNumber(engagementSignals.keywordPopularity, 0) * 0.4
  ) * 0.15;
  const searchTrendBoost = toNumber(engagementSignals.searchTrendScore, 0) * 0.85;
  const indiaBoost = toNumber(engagementSignals.indiaAudienceRelevance, 0) * 0.28;
  const categoryBoost = category === "entertainment" || category === "sports" ? 6 : 4;
  const featuredBoost = featured ? 16 : 0;

  return Math.round(base + explicit + freshness + engagementBoost + presenceBoost + searchTrendBoost + indiaBoost + categoryBoost + featuredBoost);
}

function computeTrendingScore({
  priority = 0,
  engagementSignals = {},
  publishedAt = "",
  featured = false,
}) {
  const ageHours = Math.max(0, (Date.now() - (Date.parse(publishedAt || "") || Date.now())) / (1000 * 60 * 60));
  const recencyBoost = Math.max(0, 36 - (ageHours * 1.25));
  const socialBoost = toNumber(engagementSignals.socialMentions, 0) * 0.55;
  const keywordBoost = toNumber(engagementSignals.keywordPopularity, 0) * 0.35;
  const headlineBoost = toNumber(engagementSignals.headlineStrength, 0) * 0.2;
  const searchTrendBoost = toNumber(engagementSignals.searchTrendScore, 0) * 0.9;
  const indiaBoost = toNumber(engagementSignals.indiaAudienceRelevance, 0) * 0.22;
  const featuredBoost = featured ? 22 : 0;

  return Math.round(toNumber(priority, 0) + recencyBoost + socialBoost + keywordBoost + headlineBoost + searchTrendBoost + indiaBoost + featuredBoost);
}

function normalizeStory(item) {
  const source = item.source || "Unknown";
  const sourceTitle = cleanTitle(item.title || "Untitled", source);
  const rawText = cleanText(item.rawText || item.summary || "");
  const fullDescription = cleanText(item.fullDescription || item.rawText || item.summary || "");
  const sourceUrl = item.url || "";
  const id = item.id || hashString(`${sourceTitle}|${sourceUrl}`);
  const hintedCategory = item.category || SOURCE_CATEGORY_HINTS[source] || "";
  let category = hintedCategory || classifyCategory(`${sourceTitle} ${rawText} ${fullDescription}`);
  const categoryLocked = Boolean(hintedCategory);
  const provisionalTopicSection = classifyTopicSection(`${sourceTitle} ${rawText} ${fullDescription}`, category);
  const directCategoryMatches = uniqueMatches(`${sourceTitle} ${rawText} ${fullDescription}`, CATEGORY_KEYWORDS[category] || []).length;
  if (!categoryLocked && source === "Google Trends India" && provisionalTopicSection === "india-news") {
    if (/cricket|ipl|icc|football|soccer|tennis|match|tournament|virat|rohit|dhoni/i.test(`${sourceTitle} ${rawText} ${fullDescription}`)) {
      category = "sports";
    } else if (/movie|film|actor|actress|celebrity|box office|ott|trailer|teaser|music|album/i.test(`${sourceTitle} ${rawText} ${fullDescription}`)) {
      category = "entertainment";
    } else {
      category = "tech";
    }
  } else if (!categoryLocked && provisionalTopicSection === "india-news" && directCategoryMatches === 0) {
    category = "tech";
  } else if (!categoryLocked && provisionalTopicSection === "viral-internet" && category === "ai" && directCategoryMatches === 0) {
    category = "entertainment";
  }
  const engagementSignals = computeEngagementSignals({
    title: sourceTitle,
    rawText,
    fullDescription,
    category,
    sourceEngagement: item.engagementScore,
  });
  const topicSection = classifyTopicSection(`${sourceTitle} ${rawText} ${fullDescription}`, category);
  const featured = Boolean(item.featured) || engagementSignals.total >= (MIN_SCORE_BY_CATEGORY[category] + 18);
  const title = rewriteHeadline(sourceTitle, {
    category,
    rawText: `${rawText} ${fullDescription}`,
    searchTrendTopic: engagementSignals.searchTrendTopic,
    topicSection,
    featured,
    socialMentions: engagementSignals.socialMentions,
    searchTrendScore: engagementSignals.searchTrendScore,
    indiaAudienceRelevance: engagementSignals.indiaAudienceRelevance,
  });
  const summary = summarizeParagraph(title, `${rawText} ${fullDescription}`, category);
  const timeline = getStoryTimeline({
    storyId: id,
    sourceUrl,
    title: sourceTitle,
    source,
    category,
    incomingPublishedAt: item.published_at || item.publishedAt || "",
  });
  const publishedAt = timeline.sourcePublishedAt;
  const injectedAt = timeline.injectedAt;
  const image = item.image || extractFirstImage(item.rawHtml || item.fullDescription || item.rawText || "");
  const priority = computePriority({
    source,
    category,
    publishedAt: publishedAt || injectedAt,
    engagementSignals,
    explicitPriority: item.priority,
    featured,
  });
  const trendingScore = computeTrendingScore({
    priority,
    engagementSignals,
    publishedAt: publishedAt || injectedAt,
    featured,
  });
  const keywords = buildStoryKeywords(title, {
    category,
    topicSection,
    searchTrendTopic: engagementSignals.searchTrendTopic,
  });

  return {
    id,
    title,
    rawText,
    fullDescription,
    summary,
    url: sourceUrl,
    sourceUrl,
    image,
    source,
    category,
    topicSection,
    topicSectionLabel: TOPIC_SECTION_LABELS[topicSection] || TOPIC_SECTION_LABELS[category] || "AI / Tech",
    categoryLocked,
    featured,
    engagementScore: engagementSignals.total,
    priority,
    trendingScore,
    published_at: publishedAt,
    source_published_at: publishedAt,
    injected_at: injectedAt,
    keywordPopularity: engagementSignals.keywordPopularity,
    socialMentions: engagementSignals.socialMentions,
    headlineStrength: engagementSignals.headlineStrength,
    celebrityPresence: engagementSignals.celebrityPresence,
    sportsPlayerPresence: engagementSignals.sportsPlayerPresence,
    searchTrendScore: engagementSignals.searchTrendScore,
    searchTrendTopic: engagementSignals.searchTrendTopic,
    searchTrendTraffic: engagementSignals.searchTrendTraffic,
    indiaAudienceRelevance: engagementSignals.indiaAudienceRelevance,
    keywords,
    metaTitle: `${title} | Sunwire`,
    metaDescription: summary.slice(0, 155),
  };
}

function toPublicStory(story = {}) {
  const publishedAt = normalizeIsoTimestamp(story.published_at || story.publishedAt || "") || "";
  const sourcePublishedAt = normalizeIsoTimestamp(story.source_published_at || publishedAt) || publishedAt;
  const injectedAt = normalizeIsoTimestamp(story.injected_at || "") || publishedAt;
  return {
    id: story.id || "",
    title: story.title || "Untitled",
    summary: story.summary || "",
    url: story.url || "",
    sourceUrl: story.sourceUrl || story.url || "",
    image: story.image || "",
    source: story.source || "Unknown",
    category: story.category || "tech",
    topicSection: story.topicSection || "",
    topicSectionLabel: story.topicSectionLabel || "",
    featured: Boolean(story.featured),
    engagementScore: toNumber(story.engagementScore, 0),
    priority: toNumber(story.priority, 0),
    trendingScore: toNumber(story.trendingScore, 0),
    searchTrendScore: toNumber(story.searchTrendScore, 0),
    searchTrendTopic: story.searchTrendTopic || "",
    searchTrendTraffic: toNumber(story.searchTrendTraffic, 0),
    indiaAudienceRelevance: toNumber(story.indiaAudienceRelevance, 0),
    published_at: publishedAt,
    source_published_at: sourcePublishedAt,
    injected_at: injectedAt,
    publishedAt,
    keywords: Array.isArray(story.keywords) ? story.keywords.slice(0, 8) : [],
    metaTitle: story.metaTitle || `${story.title || "Untitled"} | Sunwire`,
    metaDescription: story.metaDescription || cleanText(story.summary || "").slice(0, 155),
  };
}

function dedupe(stories) {
  const seen = new Set();
  return stories.filter((story) => {
    const urlKey = canonicalUrlKey(story.sourceUrl || story.url || "");
    const sourcePublishedAt = normalizeIsoTimestamp(story.source_published_at || story.published_at || story.publishedAt || "");
    const fingerprint = fingerprintStory({
      title: story.title || "",
      source: story.source || "",
      publishedAt: sourcePublishedAt,
    });
    const key = urlKey || fingerprint;
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isUsefulStory(story) {
  const combined = `${story.title} ${story.rawText} ${story.fullDescription}`;
  const sourcePublishedMs = toMillis(story.source_published_at || story.published_at);
  const ageDays = sourcePublishedMs ? ((Date.now() - sourcePublishedMs) / (1000 * 60 * 60 * 24)) : 0;
  if (cleanText(story.title).length < 12) return false;
  if (cleanText(story.rawText || story.fullDescription).length < 30) return false;
  if ((story.summary || "").split(" ").length < 60) return false;
  if (story.source !== "SunWire Archive" && sourcePublishedMs && ageDays > 21) return false;
  if (story.category === "entertainment" && story.source === "Engadget") {
    if (/(game|gaming|gamer|indie|nintendo|switch|xbox|playstation|ps5|steam|esports|studio|franchise|government|policy|regulation|law|rules|copyright|ban)/i.test(combined)) {
      return false;
    }
    if (!/(streaming|netflix|prime video|jiohotstar|disney\+|movie|film|series|actor|actress|celebrity|award|box office|music|album|song)/i.test(combined)) {
      return false;
    }
  }
  if (story.category === "entertainment" && !isEntertainmentSourceFit(story)) return false;
  if (story.category === "entertainment" && !hasEntertainmentIntent(combined)) return false;
  if (story.category === "entertainment" && uniqueMatches(combined, PRIORITY_TOPICS.entertainment).length < 1) return false;
  if (story.category === "sports" && uniqueMatches(combined, PRIORITY_TOPICS.sports).length < 1) return false;
  if (story.source === "Google Trends India" && isBlockedTrendTopic(story.searchTrendTopic || story.title, [story.title, story.rawText])) return false;
  if (story.topicSection === "india-news") return computeIndiaAudienceRelevance(combined) >= 18;
  if (story.topicSection === "viral-internet") {
    return /viral|video|reel|meme|creator|influencer|hashtag|trend|trending|backlash|outrage/i.test(combined)
      && (toNumber(story.socialMentions, 0) >= 10 || toNumber(story.searchTrendScore, 0) >= 12 || Boolean(story.featured));
  }
  if (story.categoryLocked) return true;
  return relevanceScore(combined, story.category) >= 1;
}

function sortByTrendThenTime(a, b) {
  const archivePenaltyDiff = Number(a.source === "SunWire Archive") - Number(b.source === "SunWire Archive");
  if (archivePenaltyDiff !== 0) return archivePenaltyDiff;
  const trendingDiff = toNumber(b.trendingScore, 0) - toNumber(a.trendingScore, 0);
  if (trendingDiff !== 0) return trendingDiff;
  const priorityDiff = toNumber(b.priority, 0) - toNumber(a.priority, 0);
  if (priorityDiff !== 0) return priorityDiff;
  const timeDiff = toMillis(storySortTimestamp(b)) - toMillis(storySortTimestamp(a));
  if (timeDiff !== 0) return timeDiff;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function sortByPublishedDesc(a, b) {
  const archivePenaltyDiff = Number(a.source === "SunWire Archive") - Number(b.source === "SunWire Archive");
  if (archivePenaltyDiff !== 0) return archivePenaltyDiff;
  const timeDiff = toMillis(storySortTimestamp(b)) - toMillis(storySortTimestamp(a));
  if (timeDiff !== 0) return timeDiff;
  return sortByTrendThenTime(a, b);
}

function ensureCategoryCoverage(stories) {
  const selected = [];

  ALL_CATEGORIES.forEach((category) => {
    const pool = stories
      .filter((story) => story.category === category)
      .sort(sortByTrendThenTime);

    const strictFloor = MIN_SCORE_BY_CATEGORY[category];
    const relaxedFloor = Math.max(20, strictFloor - 8);
    const chosenIds = new Set();

    const keep = (story) => {
      if (!story || chosenIds.has(story.id)) return;
      chosenIds.add(story.id);
      selected.push(story);
    };

    pool
      .filter((story) => story.featured || story.engagementScore >= strictFloor)
      .forEach(keep);

    if (chosenIds.size < MIN_CATEGORY_STORIES) {
      pool
        .filter((story) => !chosenIds.has(story.id) && story.engagementScore >= relaxedFloor)
        .forEach(keep);
    }

    if (chosenIds.size < MIN_CATEGORY_STORIES) {
      pool
        .filter((story) => !chosenIds.has(story.id))
        .forEach(keep);
    }
  });

  return dedupe(selected).sort(sortByPublishedDesc);
}

function supplementWithFallback(stories, filter = "all") {
  if (filter === "business") {
    const businessStories = stories.filter((story) => isBusinessStory(story));
    if (businessStories.length >= MIN_CATEGORY_STORIES) return businessStories.sort(sortByPublishedDesc);
    const fallback = CURATED_FALLBACK_STORIES.filter((story) => story.category === "business");
    return dedupe([...businessStories, ...fallback]).sort(sortByPublishedDesc);
  }

  if (filter !== "all") {
    const categoryStories = stories.filter((story) => story.category === filter);
    if (categoryStories.length >= MIN_CATEGORY_STORIES) return stories;
    const fallback = CURATED_FALLBACK_STORIES.filter((story) => story.category === filter);
    return dedupe([...stories, ...fallback]).sort(sortByPublishedDesc);
  }

  let combined = [...stories];
  ALL_CATEGORIES.forEach((category) => {
    const existingCount = combined.filter((story) => story.category === category).length;
    if (existingCount < MIN_CATEGORY_STORIES) {
      const fallback = CURATED_FALLBACK_STORIES.filter((story) => story.category === category);
      combined = dedupe([...combined, ...fallback]);
    }
  });
  return combined.sort(sortByPublishedDesc);
}

function buildGoogleNewsSearchFeed(query = "") {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

async function fetchTextNoCache(url) {
  return fetchWithRetry(url, { responseType: "text" });
}

async function fetchJsonNoCache(url) {
  return fetchWithRetry(url, { responseType: "json" });
}

async function fetchWithRetry(url, { responseType = "json", timeoutMs = FETCH_TIMEOUT_MS, retries = FETCH_RETRIES } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "User-Agent": "SunwireBot/1.0 (+https://sunwire.in)",
          "Accept": "application/json, text/plain, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        },
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return responseType === "text" ? response.text() : response.json();
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error(`Failed fetch: ${url}`);
}

function decodeXmlText(value = "") {
  return cleanText(
    String(value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
  );
}

function matchTag(block = "", tagName = "") {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = String(block).match(pattern);
  return match?.[1] || "";
}

function matchAttr(block = "", tagName = "", attrName = "") {
  const pattern = new RegExp(`<${tagName}[^>]*${attrName}=[\"']([^\"']+)[\"'][^>]*>`, "i");
  const match = String(block).match(pattern);
  return match?.[1] || "";
}

function parseDirectFeed(xml = "", sourceName = "", options = {}) {
  const itemBlocks = String(xml).match(/<item\b[^>]*>[\s\S]*?<\/item>/gi)
    || String(xml).match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi)
    || [];

  const forcedCategory = options.category || SOURCE_CATEGORY_HINTS[sourceName] || "";
  const explicitPriority = toNumber(options.priority, 0);
  const featured = Boolean(options.featured);

  return itemBlocks.map((block) => {
    const title = decodeXmlText(matchTag(block, "title"));
    const link = decodeXmlText(matchTag(block, "link")) || matchAttr(block, "link", "href");
    const description =
      decodeXmlText(matchTag(block, "description"))
      || decodeXmlText(matchTag(block, "content:encoded"))
      || decodeXmlText(matchTag(block, "summary"))
      || decodeXmlText(matchTag(block, "content"));
    const publishedAt =
      decodeXmlText(matchTag(block, "pubDate"))
      || decodeXmlText(matchTag(block, "published"))
      || decodeXmlText(matchTag(block, "updated"));
    const image =
      matchAttr(block, "media:thumbnail", "url")
      || matchAttr(block, "media:content", "url")
      || matchAttr(block, "enclosure", "url");

    return normalizeStory({
      title: title || "Untitled",
      rawText: description,
      fullDescription: description,
      rawHtml: description,
      image,
      url: link,
      source: sourceName,
      category: forcedCategory || undefined,
      priority: explicitPriority,
      featured,
      publishedAt,
    });
  }).filter((story) => story.title && story.url);
}

async function fetchGoogleTrendsIndia() {
  const xml = await fetchTextNoCache(GOOGLE_TRENDS_IN_RSS_URL);
  const itemBlocks = String(xml).match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  const trendTopics = itemBlocks.map((block) => {
    const topic = decodeXmlText(matchTag(block, "title"));
    const approxTrafficText = decodeXmlText(matchTag(block, "ht:approx_traffic"));
    const traffic = parseApproxTraffic(approxTrafficText);
    const pubDate = decodeXmlText(matchTag(block, "pubDate"));
    const picture = decodeXmlText(matchTag(block, "ht:picture"));
    const newsBlocks = String(block).match(/<ht:news_item\b[^>]*>[\s\S]*?<\/ht:news_item>/gi) || [];
    const newsItems = newsBlocks.map((newsBlock) => ({
      title: decodeXmlText(matchTag(newsBlock, "ht:news_item_title")),
      url: decodeXmlText(matchTag(newsBlock, "ht:news_item_url")),
      picture: decodeXmlText(matchTag(newsBlock, "ht:news_item_picture")),
      source: decodeXmlText(matchTag(newsBlock, "ht:news_item_source")),
    })).filter((item) => item.title && item.url);
    const relatedTitles = newsItems.map((item) => item.title);
    const combinedText = `${topic} ${relatedTitles.join(" ")}`;
    const category = classifyCategory(combinedText);
    const trafficScore = Math.min(34, Math.round(Math.log10(Math.max(traffic, 1)) * 10));
    const indiaPriority = computeIndiaAudienceRelevance(combinedText) >= 18;

    return {
      topic,
      normalizedTopic: normalizeForCompare(topic),
      approxTrafficText,
      traffic,
      trafficScore,
      pubDate,
      picture,
      newsItems,
      relatedTitles,
      category,
      keywords: buildTrendKeywords(topic),
      indiaPriority,
    };
  }).filter((trend) =>
    trend.topic
    && trend.newsItems.length
    && isUsefulIndiaTrend(trend.topic, trend.relatedTitles, trend.category)
  );

  googleTrendsState = {
    generatedAt: new Date().toISOString(),
    topics: trendTopics,
  };

  return trendTopics.flatMap((trend, index) =>
    trend.newsItems.map((newsItem, newsIndex) => normalizeStory({
      id: `gt-in-${hashString(`${trend.topic}|${newsItem.url}`)}`,
      title: newsItem.title,
      rawText: `Trending in India: ${trend.topic}. Approx search traffic ${trend.approxTrafficText}.`,
      fullDescription: [
        `Trending in India: ${trend.topic}. Approx search traffic ${trend.approxTrafficText}.`,
        ...trend.relatedTitles.slice(0, 4),
      ].join(" "),
      image: newsItem.picture || trend.picture,
      url: newsItem.url,
      source: "Google Trends India",
      engagementScore: 40 + trend.trafficScore + Math.max(0, 10 - newsIndex),
      priority: 60 + trend.trafficScore + (trend.indiaPriority ? 30 : 16) + Math.max(0, 6 - index),
      featured: trend.traffic >= 200,
      publishedAt: trend.pubDate || new Date().toISOString(),
    }))
  );
}

async function fetchHackerNews(query, pages = [0, 1, 2]) {
  const endpoints = pages.map((page) =>
    `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&page=${page}&hitsPerPage=50`
  );
  const results = await Promise.all(endpoints.map((url) => fetchJsonNoCache(url)));

  return results
    .flatMap((batch) => batch.hits || [])
    .map((hit) => normalizeStory({
      title: hit.title || hit.story_title || "Untitled",
      rawText: hit.story_text || hit.comment_text || "Community-submitted update from Hacker News.",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      source: "Hacker News",
      engagementScore: toNumber(hit.points, 0) + toNumber(hit.num_comments, 0),
      publishedAt: hit.created_at,
    }))
    .filter((story) => story.title && story.url);
}

async function fetchHackerNewsLatest(pages = [0, 1, 2, 3]) {
  const endpoints = pages.map((page) =>
    `https://hn.algolia.com/api/v1/search_by_date?tags=story&page=${page}&hitsPerPage=50`
  );
  const results = await Promise.all(endpoints.map((url) => fetchJsonNoCache(url)));

  return results
    .flatMap((batch) => batch.hits || [])
    .map((hit) => normalizeStory({
      title: hit.title || hit.story_title || "Untitled",
      rawText: hit.story_text || hit.comment_text || "Community-submitted update from Hacker News.",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      source: "Hacker News",
      engagementScore: toNumber(hit.points, 0) + toNumber(hit.num_comments, 0),
      publishedAt: hit.created_at,
    }))
    .filter((story) => story.title && story.url);
}

async function fetchReddit(subreddits = ["artificial", "MachineLearning", "technology"], forcedCategory = "", sort = "new", limit = 80, sourceName = "Reddit") {
  const payload = await fetchJsonNoCache(`https://www.reddit.com/r/${subreddits.join("+")}/${sort}.json?limit=${limit}&t=day`);

  return (payload.data?.children || [])
    .map((item) => item.data)
    .filter((post) => post.title && post.url)
    .map((post) => normalizeStory({
      title: post.title,
      rawText: post.selftext || post.subreddit_name_prefixed || "Top trend from Reddit communities.",
      fullDescription: `${post.selftext || ""} ${post.subreddit_name_prefixed || ""}`,
      url: post.url,
      source: sourceName,
      category: forcedCategory || undefined,
      engagementScore: toNumber(post.score, 0) + toNumber(post.num_comments, 0),
      publishedAt: new Date((post.created_utc || 0) * 1000).toISOString(),
    }));
}

function extractTopicsFromAnchorText(html = "") {
  const anchorMatches = [...String(html).matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
  return dedupeTopics(anchorMatches.map((match) => match?.[1] || ""));
}

async function fetchXTrendsIndia() {
  const html = await fetchTextNoCache("https://trends24.in/india/");
  const hashtagMatches = [...String(html).matchAll(/(?:#|&#35;)([A-Za-z0-9_]{3,60})/g)].map((match) => `#${match[1]}`);
  const topics = dedupeTopics(hashtagMatches, 10);

  return topics.map((topic, index) => normalizeStory({
    id: `x-in-${hashString(topic)}`,
    title: topic,
    rawText: `Trending hashtag on X in India: ${topic}.`,
    fullDescription: `Trending hashtag on X in India: ${topic}. Social conversation in India is accelerating around this topic.`,
    url: `https://news.google.com/search?q=${encodeURIComponent(topic)}&hl=en-IN&gl=IN&ceid=IN:en`,
    source: "X Trends India",
    priority: 8 + Math.max(0, 6 - index),
    engagementScore: Math.max(6, 18 - (index * 2)),
    featured: false,
    publishedAt: new Date().toISOString(),
  }));
}

function extractYouTubeTrendingVideos(html = "") {
  const matches = [...String(html).matchAll(/"videoId":"([^"]+)".{0,1200}?"title":\{"runs":\[\{"text":"([^"]+)"/g)];
  const seen = new Set();
  const items = matches.map((match) => ({
    videoId: match[1],
    title: decodeJsonText(match[2]),
  })).filter((item) => {
    if (!item.videoId || !item.title || seen.has(item.videoId)) return false;
    seen.add(item.videoId);
    return true;
  });

  return items.slice(0, 12);
}

async function fetchYouTubeTrendingIndia() {
  let html = await fetchTextNoCache("https://www.youtube.com/feed/trending?gl=IN");
  let videos = extractYouTubeTrendingVideos(html);

  if (!videos.length) {
    html = await fetchTextNoCache("https://www.youtube.com/feed/explore?gl=IN").catch(() => "");
    videos = extractYouTubeTrendingVideos(html);
  }

  return videos.map((video, index) => normalizeStory({
    id: `yt-in-${video.videoId}`,
    title: video.title,
    rawText: `Trending on YouTube in India: ${video.title}.`,
    fullDescription: `Trending on YouTube in India: ${video.title}. Video-led conversation is accelerating around this topic across creators and viewers.`,
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
    source: "YouTube India",
    priority: 28 + Math.max(0, 10 - index),
    engagementScore: 54 - (index * 2),
    featured: index < 3,
    publishedAt: new Date().toISOString(),
  }));
}

async function fetchDevTo(tags = ["ai", "machinelearning", "technology", "programming"]) {
  const calls = tags.map((tag) => fetchJsonNoCache(`https://dev.to/api/articles?per_page=40&tag=${encodeURIComponent(tag)}`));
  const batches = await Promise.all(calls);

  return batches.flatMap((batch) =>
    (batch || []).map((article) => normalizeStory({
      title: article.title || "Untitled",
      rawText: article.description || article.body_markdown || "",
      fullDescription: article.description || article.body_markdown || "",
      image: article.cover_image || "",
      url: article.url,
      source: "DEV Community",
      engagementScore:
        toNumber(article.public_reactions_count, 0)
        + toNumber(article.positive_reactions_count, 0)
        + toNumber(article.comments_count, 0),
      publishedAt: article.published_at || article.created_at || "",
    }))
  );
}

async function fetchRssViaRss2Json(sourceName, feedUrl, options = {}) {
  try {
    const xml = await fetchTextNoCache(feedUrl);
    const directStories = parseDirectFeed(xml, sourceName, options);
    if (directStories.length) return directStories;
  } catch (_) {
    // Fall back to rss2json when direct XML parsing fails.
  }

  const payload = await fetchJsonNoCache(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}&count=60`);
  if (payload.status !== "ok") throw new Error(`Bad RSS payload for ${sourceName}`);

  const forcedCategory = options.category || SOURCE_CATEGORY_HINTS[sourceName] || "";
  const explicitPriority = toNumber(options.priority, 0);
  const featured = Boolean(options.featured);

  return (payload.items || []).map((item) => normalizeStory({
    title: item.title || "Untitled",
    rawText: item.description || item.content || "",
    fullDescription: item.content || item.description || "",
    rawHtml: item.content || item.description || "",
    image: item.thumbnail || "",
    url: item.link,
    source: sourceName,
    category: forcedCategory || undefined,
    priority: explicitPriority,
    featured,
    publishedAt: item.pubDate || "",
  }));
}

async function fetchGoogleNewsQueries(sourceName, queries = [], options = {}) {
  const category = typeof options === "string" ? options : (options.category || "");
  const explicitPriority = typeof options === "string"
    ? (category === "entertainment" || category === "sports" ? 8 : 5)
    : toNumber(options.priority, category === "entertainment" || category === "sports" ? 8 : 5);
  const results = await Promise.allSettled(
    queries.map((query) =>
      fetchRssViaRss2Json(sourceName, buildGoogleNewsSearchFeed(query), {
        ...(category ? { category } : {}),
        priority: explicitPriority,
      })
    )
  );

  return results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);
}

async function runSourceTask(sourceName, categoryHint, task) {
  const startedAt = Date.now();
  pipelineState.sourceRuns[sourceName] = {
    ...(pipelineState.sourceRuns[sourceName] || {}),
    lastAttemptAt: new Date().toISOString(),
    categoryHint: categoryHint || "",
    lastStatus: "running",
  };
  logEvent("source.fetch.start", { source: sourceName, categoryHint: categoryHint || "" });

  try {
    const items = await task();
    const count = Array.isArray(items) ? items.length : 0;
    pipelineState.sourceRuns[sourceName] = {
      ...(pipelineState.sourceRuns[sourceName] || {}),
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      lastStatus: "ok",
      lastError: "",
      lastCount: count,
      lastDurationMs: Date.now() - startedAt,
      categoryHint: categoryHint || "",
    };
    logEvent("source.fetch.end", {
      source: sourceName,
      categoryHint: categoryHint || "",
      count,
      durationMs: Date.now() - startedAt,
    });
    return Array.isArray(items) ? items : [];
  } catch (error) {
    pipelineState.sourceRuns[sourceName] = {
      ...(pipelineState.sourceRuns[sourceName] || {}),
      lastAttemptAt: new Date().toISOString(),
      lastStatus: "error",
      lastError: summarizeError(error),
      lastCount: 0,
      lastDurationMs: Date.now() - startedAt,
      categoryHint: categoryHint || "",
    };
    logEvent("source.fetch.error", {
      source: sourceName,
      categoryHint: categoryHint || "",
      durationMs: Date.now() - startedAt,
      error: summarizeError(error),
    });
    return [];
  }
}

async function fetchAllSources() {

  googleTrendsState = {
    generatedAt: "",
    topics: [],
  };

  const feedSources = [
    { sourceName: "TechCrunch", feedUrl: "https://techcrunch.com/feed/" },
    { sourceName: "The Verge", feedUrl: "https://www.theverge.com/rss/index.xml" },
    { sourceName: "Wired", feedUrl: "https://www.wired.com/feed/rss" },
    { sourceName: "Ars Technica", feedUrl: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
    { sourceName: "MIT Tech Review", feedUrl: "https://www.technologyreview.com/feed/" },

    { sourceName: "BBC News", feedUrl: "https://feeds.bbci.co.uk/news/rss.xml", options: { priority: 22 } },
    { sourceName: "Reuters Tech", feedUrl: "https://www.reutersagency.com/feed/?best-topics=technology", options: { priority: 22 } },
    { sourceName: "Guardian Tech", feedUrl: "https://www.theguardian.com/uk/technology/rss", options: { priority: 20 } },
    { sourceName: "CNBC", feedUrl: "https://www.cnbc.com/id/100003114/device/rss/rss.html", options: { priority: 20 } },

    { sourceName: "NDTV", feedUrl: "https://feeds.feedburner.com/ndtvnews-top-stories", options: { priority: 22 } },
    { sourceName: "Times of India", feedUrl: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", options: { priority: 22 } },
    { sourceName: "Indian Express", feedUrl: "https://indianexpress.com/section/india/feed/", options: { priority: 22 } },
    { sourceName: "Economic Times", feedUrl: "https://economictimes.indiatimes.com/rssfeedsdefault.cms", options: { priority: 22 } },

    { sourceName: "Variety", feedUrl: "https://variety.com/feed/", options: { category: "entertainment", priority: 8 } },
    { sourceName: "Hollywood Reporter", feedUrl: "https://www.hollywoodreporter.com/feed/", options: { category: "entertainment", priority: 8 } },

    { sourceName: "ESPN", feedUrl: "https://www.espn.com/espn/rss/news", options: { category: "sports", priority: 8 } },
    { sourceName: "BBC Sport", feedUrl: "https://feeds.bbci.co.uk/sport/rss.xml", options: { category: "sports", priority: 7 } },
  ];

  const tasks = [

    { sourceName: "Hacker News AI", categoryHint: "ai",
      task: () => fetchHackerNews(
        "artificial intelligence OR llm OR openai OR machine learning OR ai agents",
        [0,1,2,3]
      )
    },

    { sourceName: "Hacker News Tech", categoryHint: "tech",
      task: () => fetchHackerNews(
        "technology OR software OR cloud OR chips OR cybersecurity",
        [0,1,2,3]
      )
    },

    { sourceName: "Hacker News Latest", categoryHint: "all",
      task: () => fetchHackerNewsLatest([0,1,2,3])
    },

    ...feedSources.map(feed => ({
      sourceName: feed.sourceName,
      categoryHint: feed.options?.category || SOURCE_CATEGORY_HINTS[feed.sourceName] || "",
      task: () => fetchRssViaRss2Json(feed.sourceName, feed.feedUrl, feed.options || {})
    })),

    {
      sourceName: "Google News AI",
      categoryHint: "ai",
      task: () => fetchGoogleNewsQueries(
        "Google News AI",
        [
          "OpenAI OR Anthropic OR Gemini OR AI model",
          "Nvidia AI chip OR generative AI startup OR AI agents"
        ],
        { category: "ai", priority: 10 }
      )
    },

    {
      sourceName: "Google News Tech",
      categoryHint: "tech",
      task: () => fetchGoogleNewsQueries(
        "Google News Tech",
        [
          "software release OR cloud OR cybersecurity",
          "startup funding OR semiconductor OR GPU"
        ],
        { category: "tech", priority: 8 }
      )
    },

    {
      sourceName: "Google News Entertainment",
      categoryHint: "entertainment",
      task: () => fetchGoogleNewsQueries(
        "Google News Entertainment",
        [
          "Bollywood box office OR actor interview OR celebrity controversy",
          "Hollywood movie release OR trailer OR OTT series"
        ],
        { category: "entertainment", priority: 10 }
      )
    },

    {
      sourceName: "Google News Sports",
      categoryHint: "sports",
      task: () => fetchGoogleNewsQueries(
        "Google News Sports",
        [
          "India cricket OR IPL OR Virat Kohli OR Rohit Sharma",
          "football transfer OR Champions League OR Messi OR Ronaldo"
        ],
        { category: "sports", priority: 10 }
      )
    }
  ];

  const googleTrendStories =
    await runSourceTask("Google Trends India","all",() => fetchGoogleTrendsIndia());

  const settled =
    await Promise.all(tasks.map(({sourceName,categoryHint,task}) =>
      runSourceTask(sourceName,categoryHint,task)
    ));

  return [
    ...googleTrendStories,
    ...settled.flatMap(result => result)
  ];
}

const CURATED_FALLBACK_STORIES = CURATED_FALLBACK_INPUTS.map((item) => normalizeStory(item));

let snapshotCache = {
  generatedAt: null,
  expiresAt: 0,
  stories: [],
  stats: {},
};

async function readPersistedSnapshot() {
  try {
    const raw = await fs.readFile(SNAPSHOT_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      generatedAt: String(parsed.generatedAt || ""),
      expiresAt: Number(parsed.expiresAt || 0),
      stories: Array.isArray(parsed.stories) ? parsed.stories : [],
      stats: parsed.stats && typeof parsed.stats === "object" ? parsed.stats : {},
    };
  } catch (_) {
    return null;
  }
}

async function writePersistedSnapshot(snapshot = null) {
  if (!snapshot?.stories?.length) return;

  try {
    await fs.writeFile(SNAPSHOT_CACHE_FILE, JSON.stringify(snapshot), "utf8");
  } catch (_) {
    // Ignore temp cache write failures.
  }
}

async function runIngestion({ limit = DEFAULT_LIMIT, forceRefresh = false, reason = "api" } = {}) {
  const now = Date.now();
  if (!forceRefresh && snapshotCache.stories.length && snapshotCache.expiresAt > now) {
    pipelineState.cache.hitCount += 1;
    pipelineState.cache.lastServedAt = new Date().toISOString();
    logEvent("cache.hit", {
      reason,
      generatedAt: snapshotCache.generatedAt,
      expiresAt: new Date(snapshotCache.expiresAt).toISOString(),
      storyCount: snapshotCache.stories.length,
    });
    return snapshotCache;
  }

  if (!forceRefresh) {
    const persistedSnapshot = await readPersistedSnapshot();
    const canUsePersistedSnapshot = Boolean(
      persistedSnapshot?.stories?.length
      && (
        persistedSnapshot.expiresAt > now
        || process.env.NODE_ENV !== "production"
      )
    );

    if (canUsePersistedSnapshot) {
      snapshotCache = persistedSnapshot;
      pipelineState.cache.hitCount += 1;
      pipelineState.cache.generatedAt = snapshotCache.generatedAt;
      pipelineState.cache.expiresAt = snapshotCache.expiresAt;
      pipelineState.cache.lastServedAt = new Date().toISOString();
      logEvent("cache.disk_hit", {
        reason,
        generatedAt: snapshotCache.generatedAt,
        expiresAt: snapshotCache.expiresAt ? new Date(snapshotCache.expiresAt).toISOString() : "",
        storyCount: snapshotCache.stories.length,
      });
      return snapshotCache;
    }
  }

  pipelineState.cache.missCount += 1;
  pipelineState.lastRunId = `ingest_${now}`;
  pipelineState.lastAttemptAt = new Date().toISOString();
  logEvent("scheduler.start", { runId: pipelineState.lastRunId, reason, forceRefresh });

  const startedAt = Date.now();
  try {
    const fetchedStories = await fetchAllSources();
    const fetchedCount = fetchedStories.length;
    const dedupedStories = dedupe(fetchedStories);
    const duplicateCount = Math.max(0, fetchedCount - dedupedStories.length);
    const englishStories = dedupedStories.filter((story) =>
      story.source === "Google Trends India" || isMostlyEnglish(`${story.title} ${story.rawText}`)
    );
    const englishFilteredCount = dedupedStories.length - englishStories.length;
    const usefulStories = englishStories.filter((story) => isUsefulStory(story));
    const moderationFilteredCount = englishStories.length - usefulStories.length;

    let stories = ensureCategoryCoverage(usefulStories);
    stories = supplementWithFallback(stories, "all");
    stories = dedupe(stories).sort(sortByPublishedDesc);

    const categoryStats = {};
    ALL_CATEGORIES.forEach((category) => {
      const categoryStories = stories.filter((story) => story.category === category);
      const injectedNow = categoryStories.filter((story) => {
        const injectedMs = toMillis(story.injected_at);
        return injectedMs && (Date.now() - injectedMs) <= SNAPSHOT_TTL_MS;
      }).length;
      categoryStats[category] = {
        totalReturnedLastRun: categoryStories.length,
        insertedLastRun: injectedNow,
        lastSuccessAt: categoryStories.length ? new Date().toISOString() : (pipelineState.categoryRuns[category]?.lastSuccessAt || ""),
      };
      pipelineState.categoryRuns[category] = {
        ...(pipelineState.categoryRuns[category] || {}),
        ...categoryStats[category],
      };
      if (!categoryStats[category].lastSuccessAt || ((Date.now() - Date.parse(categoryStats[category].lastSuccessAt || 0)) > FRESH_ALERT_WINDOW_MS)) {
        logEvent("category.alert", { category, alert: "no_fresh_ingestion_recently" });
      }
    });

    snapshotCache = {
      generatedAt: new Date().toISOString(),
      expiresAt: now + SNAPSHOT_TTL_MS,
      stories: stories.slice(0, limit),
      stats: {
        fetchedCount,
        duplicateCount,
        englishFilteredCount,
        moderationFilteredCount,
        returnedCount: stories.length,
        categoryStats,
      },
    };

    await writePersistedSnapshot(snapshotCache);

    pipelineState.lastSuccessAt = snapshotCache.generatedAt;
    pipelineState.lastDurationMs = Date.now() - startedAt;
    pipelineState.lastError = "";
    pipelineState.lastCacheInvalidationAt = snapshotCache.generatedAt;
    pipelineState.cache.generatedAt = snapshotCache.generatedAt;
    pipelineState.cache.expiresAt = snapshotCache.expiresAt;
    pipelineState.cache.lastServedAt = snapshotCache.generatedAt;

    recordRunHistory({
      runId: pipelineState.lastRunId,
      reason,
      generatedAt: snapshotCache.generatedAt,
      fetchedCount,
      duplicateCount,
      englishFilteredCount,
      moderationFilteredCount,
      returnedCount: stories.length,
      durationMs: pipelineState.lastDurationMs,
    });

    logEvent("scheduler.end", {
      runId: pipelineState.lastRunId,
      reason,
      durationMs: pipelineState.lastDurationMs,
      fetchedCount,
      duplicateCount,
      englishFilteredCount,
      moderationFilteredCount,
      returnedCount: stories.length,
    });

    return snapshotCache;
  } catch (error) {
    pipelineState.lastDurationMs = Date.now() - startedAt;
    pipelineState.lastError = summarizeError(error);
    recordRunHistory({
      runId: pipelineState.lastRunId,
      reason,
      generatedAt: new Date().toISOString(),
      error: pipelineState.lastError,
      durationMs: pipelineState.lastDurationMs,
    });
    logEvent("scheduler.error", {
      runId: pipelineState.lastRunId,
      reason,
      durationMs: pipelineState.lastDurationMs,
      error: pipelineState.lastError,
    });
    throw error;
  }
}

async function getSnapshot(limit, options = {}) {
  return runIngestion({ limit, forceRefresh: Boolean(options.forceRefresh), reason: options.reason || "api" });
}

function applyDeskFilter(stories = [], filter = "all") {
  if (filter === "business") return stories.filter((story) => isBusinessStory(story));
  if (ALL_CATEGORIES.includes(filter)) return stories.filter((story) => story.category === filter);
  return stories;
}

const handler = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, DEFAULT_LIMIT);
  const pageSize = Math.max(1, Math.min(Number(req.query.pageSize) || DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE));
  const page = Math.max(1, Number(req.query.page) || DEFAULT_PAGE);
  const filter = String(req.query.filter || "all").toLowerCase();
  const forceRefresh = String(req.query.refresh || req.query.force || "0") === "1";
  const includeDebug = String(req.query.debug || "0") === "1";

  const snapshot = await runIngestion({
  limit: pageSize * page,
  forceRefresh,
  reason: "api"
});

const stories = applyDeskFilter(snapshot.stories, filter);

const start = (page - 1) * pageSize;
const paginated = stories.slice(start, start + pageSize);

res.setHeader(
  "Cache-Control",
  `public, s-maxage=${CDN_NEWS_CACHE_SECONDS}, stale-while-revalidate=${CDN_NEWS_STALE_SECONDS}`
);

res.status(200).json({
  generatedAt: snapshot.generatedAt,
  totalStories: stories.length,
  totalPages: Math.max(1, Math.ceil(stories.length / pageSize)),
  page,
  pageSize,
  filter,
  stories: paginated.map(toPublicStory)
});
    if (backendPayload) {
      res.setHeader("Cache-Control", `public, s-maxage=${CDN_NEWS_CACHE_SECONDS}, stale-while-revalidate=${CDN_NEWS_STALE_SECONDS}`);
      res.status(200).json({
        ...backendPayload,
        ...(includeDebug ? { debug: { sourceMode: backendPayload.sourceMode } } : {}),
      });
      return;
    }
  }

  logEvent("api.response.database_only", {
    filter,
    forceRefresh,
    backendModeError: getLastBackendCompatError(),
  });
  res.setHeader("Cache-Control", `public, s-maxage=${CDN_NEWS_CACHE_SECONDS}, stale-while-revalidate=${CDN_NEWS_STALE_SECONDS}`);
  res.status(200).json({
    generatedAt: new Date().toISOString(),
    totalStories: 0,
    totalPages: 1,
    page,
    pageSize,
    filter,
    stories: [],
    ...(includeDebug ? { debug: { pipeline: getPublicPipelineState(), sourceMode: "database_only", backendModeError: getLastBackendCompatError() } } : {}),
  });
};

handler.runIngestion = runIngestion;
handler.getPublicPipelineState = getPublicPipelineState;
handler.getSnapshot = getSnapshot;

module.exports = handler;
