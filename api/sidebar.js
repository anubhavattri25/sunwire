function cleanText(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/happy reading/gi, "")
    .replace(/read more/gi, "")
    .replace(/click here/gi, "")
    .replace(/subscribe now/gi, "")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const prisma = require("../backend/config/database");
const { articleSelect, toApiArticle } = require("../backend/models/Article");
const {
  getDatabaseBusyMessage,
  isDatabaseCoolingDown,
  markDatabasePressure,
} = require("../backend/utils/databaseAvailability");

const SIDEBAR_CACHE_TTL_MS = 30 * 60 * 1000;
const SIDEBAR_FALLBACK_CACHE_TTL_MS = 2 * 60 * 1000;
const sidebarBaseCache = globalThis.__SUNWIRE_SIDEBAR_CACHE__ || {
  payload: null,
  expiresAt: 0,
  peopleReadingPayload: null,
  peopleReadingExpiresAt: 0,
};
globalThis.__SUNWIRE_SIDEBAR_CACHE__ = sidebarBaseCache;
const marketBoardHistory = new Map();

async function fetchJsonNoCache(url) {
  const sep = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${sep}_ts=${Date.now()}`, {
    cache: "no-store",
    headers: {
      "User-Agent": "SunwireBot/1.0 (+https://sunwire.in)",
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`Fetch failed: ${url}`);
  return response.json();
}

async function fetchTextNoCache(url) {
  const sep = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${sep}_ts=${Date.now()}`, {
    cache: "no-store",
    headers: {
      "User-Agent": "SunwireBot/1.0 (+https://sunwire.in)",
    },
  });
  if (!response.ok) throw new Error(`Fetch failed: ${url}`);
  return response.text();
}

const NICHE_TOOLS = [
  {
    tool: "Langflow",
    use: "Visual builder for LLM chains and agent pipelines.",
    link: "https://www.langflow.org/",
  },
  {
    tool: "Continue.dev",
    use: "Open-source coding assistant you run inside your IDE.",
    link: "https://www.continue.dev/",
  },
];

const MAINSTREAM_TOOL_WORDS = [
  "chatgpt", "gemini", "copilot", "perplexity", "claude", "openai", "google", "microsoft"
];

const STARTUP_FALLBACKS = [
  { company: "Synthesia", funding: "$90M", category: "AI Video", link: "https://www.synthesia.io/" },
  { company: "Mistral AI", funding: "$640M", category: "Foundation Models", link: "https://mistral.ai/" },
  { company: "Perplexity", funding: "$73.6M", category: "AI Search", link: "https://www.perplexity.ai/" },
  { company: "Runway", funding: "$141M", category: "Generative Video", link: "https://runwayml.com/" },
  { company: "ElevenLabs", funding: "$80M", category: "AI Voice", link: "https://elevenlabs.io/" },
];

const EVENTS_FALLBACKS = [
  { name: "Web Summit", date: "Nov 11", about: "Startup, product, and market trends in global tech.", link: "https://websummit.com/" },
  { name: "Nvidia GTC", date: "Mar 20", about: "GPU, AI infrastructure, and model performance updates.", link: "https://www.nvidia.com/gtc/" },
  { name: "OpenAI Dev Day", date: "Apr 3", about: "New model APIs, product launches, and developer tools.", link: "https://openai.com" },
];

const MARKET_BOARD_FALLBACK = {
  asOf: "2026-03-25T19:00:00+05:30",
  meta: "Mar 25, 2026",
  items: [
    {
      name: "Gold",
      market: "India, 24K / 10g",
      today: "Rs. 1,46,670",
      yesterday: "Rs. 1,42,910",
      change: "+3,760",
      deltaDirection: "up",
    },
    {
      name: "Silver",
      market: "India / kg",
      today: "Rs. 2,50,000",
      yesterday: "Rs. 2,35,000",
      change: "+15,000",
      deltaDirection: "up",
    },
    {
      name: "NIFTY",
      market: "NSE Index",
      today: "Rs. 22,590",
      yesterday: "Rs. 22,380",
      change: "+210",
      deltaDirection: "up",
    },
  ],
  sources: [
    { label: "GoodReturns", url: "https://www.goodreturns.in/" },
    { label: "NSE India", url: "https://www.nseindia.com/" },
  ],
};

function buildArticleHref(article = {}) {
  const slug = cleanText(article.slug || article.title || article.id || "story")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!slug) return "/";

  const params = new URLSearchParams();
  if (article.id) params.set("id", String(article.id || "").trim());
  if (article.source_url || article.sourceUrl || article.url) {
    params.set("u", String(article.source_url || article.sourceUrl || article.url || "").trim());
  }
  if (article.title) params.set("t", cleanText(article.title || ""));
  if (article.category) params.set("c", cleanText(article.category || ""));
  params.set("sw", "2");
  return `/article/${slug}?${params.toString()}`;
}

function fallbackReaderCount(article = {}, index = 0) {
  const viewCount = Number(article.views || 0);
  const shareCount = Number(article.shares || 0);
  const seededFloor = Math.max(48, 120 - (index * 14));
  return Math.max(seededFloor, viewCount, shareCount * 12);
}

function normalizeSidebarPayload(payload = {}, fallback = {}) {
  const fallbackTool = fallback.tool || { ...pickDailyNicheTool() };
  const fallbackEvents = Array.isArray(fallback.events) && fallback.events.length
    ? fallback.events
    : pickDailyThree(EVENTS_FALLBACKS);
  const fallbackMarketBoard = fallback.marketBoard?.items?.length
    ? fallback.marketBoard
    : MARKET_BOARD_FALLBACK;

  const tool = payload?.tool && (payload.tool.tool || payload.tool.use || payload.tool.link)
    ? payload.tool
    : fallbackTool;
  const events = Array.isArray(payload?.events) && payload.events.length
    ? pickDailyThree(payload.events.filter((event) => cleanText(event?.name || "")))
    : fallbackEvents;
  const marketItems = Array.isArray(payload?.marketBoard?.items)
    ? payload.marketBoard.items.filter((item) => cleanText(item?.name || ""))
    : [];
  const marketBoard = marketItems.length
    ? {
      ...fallbackMarketBoard,
      ...(payload.marketBoard || {}),
      items: marketItems.slice(0, 3),
    }
    : fallbackMarketBoard;

  return {
    generatedAt: payload?.generatedAt || new Date().toISOString(),
    startup: payload?.startup || fallback.startup || pickDailyOne(STARTUP_FALLBACKS),
    events,
    tool,
    marketBoard,
    peopleReading: Array.isArray(payload?.peopleReading) ? payload.peopleReading : [],
    peopleReadingDegraded: Boolean(payload?.peopleReadingDegraded),
    peopleReadingMessage: cleanText(payload?.peopleReadingMessage || ""),
  };
}

function normalizeText(text = "") {
  return cleanText(String(text).replace(/&nbsp;/gi, " "));
}

function parseAmountToNumber(value = "") {
  const normalized = String(value).replace(/[^\d.-]/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function formatInr(amount, decimals = 0) {
  return `Rs. ${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatNumber(amount, decimals = 2) {
  return Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatChange(amount, decimals = 0) {
  const prefix = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${prefix}${formatInr(Math.abs(amount), decimals)}`;
}

function formatNumberChange(amount, decimals = 2) {
  const prefix = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${prefix}${formatNumber(Math.abs(amount), decimals)}`;
}

function deltaDirection(amount = 0) {
  if (amount > 0) return "up";
  if (amount < 0) return "down";
  return "flat";
}

function lastFiniteNumber(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const amount = Number(values[index]);
    if (Number.isFinite(amount)) return amount;
  }
  return 0;
}

function toIstDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function shiftDateKey(dateKey = "", deltaDays = 0) {
  const [year, month, day] = String(dateKey).split("-").map((part) => Number(part));
  if (!year || !month || !day) return "";
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return date.toISOString().slice(0, 10);
}

function titleDateToIso(label = "") {
  const parsed = Date.parse(String(label).replace(/^As of\s+/i, "").trim());
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
}

function rememberMarketBoard(board = {}) {
  const lpgEntry = Array.isArray(board.items) ? board.items.find((item) => item.name === "LPG") : null;
  const lpgValue = parseAmountToNumber(lpgEntry?.today || "");
  const dateKey = board.dateKey || toIstDateKey(board.asOf ? new Date(board.asOf) : new Date());
  if (lpgValue > 0 && dateKey) {
    marketBoardHistory.set(dateKey, { lpg: lpgValue });
  }

  const keepKeys = [...marketBoardHistory.keys()].sort().slice(-7);
  const keepSet = new Set(keepKeys);
  [...marketBoardHistory.keys()].forEach((key) => {
    if (!keepSet.has(key)) marketBoardHistory.delete(key);
  });
}

function backfillHistoryFromCachedPayload() {
  if (!sidebarBaseCache.payload?.marketBoard) return;
  rememberMarketBoard(sidebarBaseCache.payload.marketBoard);
}

function parseGoldBoard(html = "") {
  const text = normalizeText(html);
  const match = text.match(/Gold Rate in India for Last 10 Days \(1 gram\)\s+Date 24K 22K\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})\s+\D*([\d,]+)\s+\([^)]+\)\s+\D*[\d,]+\s+\([^)]+\)\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})\s+\D*([\d,]+)\s+\([^)]+\)\s+\D*[\d,]+\s+\([^)]+\)/i);
  if (!match) throw new Error("Unable to parse gold rates");

  const todayPerGram = parseAmountToNumber(match[2]);
  const yesterdayPerGram = parseAmountToNumber(match[4]);
  const today = todayPerGram * 10;
  const yesterday = yesterdayPerGram * 10;
  const change = today - yesterday;

  return {
    todayLabel: match[1],
    yesterdayLabel: match[3],
    item: {
      name: "Gold",
      market: "India, 24K / 10g",
      today: formatInr(today, 0),
      yesterday: formatInr(yesterday, 0),
      change: formatChange(change, 0),
      deltaDirection: deltaDirection(change),
    },
  };
}

function parseSilverBoard(html = "") {
  const text = normalizeText(html);
  const match = text.match(/Silver Rate in India for Last 10 Days\s+Date 10 gram 100 gram 1 Kg\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})\s+\D*[\d,]+\s+\D*[\d,]+\s+\D*([\d,]+)\s+\([^)]+\)\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})\s+\D*[\d,]+\s+\D*[\d,]+\s+\D*([\d,]+)\s+\([^)]+\)/i);
  if (!match) throw new Error("Unable to parse silver rates");

  const today = parseAmountToNumber(match[2]);
  const yesterday = parseAmountToNumber(match[4]);
  const change = today - yesterday;

  return {
    todayLabel: match[1],
    yesterdayLabel: match[3],
    item: {
      name: "Silver",
      market: "India / kg",
      today: formatInr(today, 0),
      yesterday: formatInr(yesterday, 0),
      change: formatChange(change, 0),
      deltaDirection: deltaDirection(change),
    },
  };
}

function parseLpgBoard(html = "") {
  const text = normalizeText(html);
  const match = text.match(/As of(?:\s+[A-Za-z]+)?\,?\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\,?\s+the domestic LPG price in New Delhi,\s*Delhi is \D*([\d,.]+) for a 14\.2 kg cylinder/i)
    || text.match(/As of\s+[A-Za-z]+,\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}),\s+the domestic LPG price in New Delhi,\s*Delhi is \D*([\d,.]+) for a 14\.2 kg cylinder/i)
    || text.match(/How much does a 14\.2 kg cylinder of LPG cost in Delhi today\?\s+As of\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}),\s+the price of a 14\.2 kg cylinder of LPG in New Delhi,\s*Delhi is \D*([\d,.]+)/i);
  if (!match) throw new Error("Unable to parse LPG rates");

  const today = parseAmountToNumber(match[2]);
  const lpgIso = titleDateToIso(match[1]) || new Date().toISOString();
  const todayKey = toIstDateKey(new Date(lpgIso));
  const yesterdayKey = shiftDateKey(todayKey, -1);
  // Domestic LPG pages expose the current city rate but not a direct yesterday column.
  const previous = marketBoardHistory.get(yesterdayKey)?.lpg;
  const yesterday = previous > 0 ? previous : today;
  const change = today - yesterday;

  return {
    todayLabel: match[1],
    item: {
      name: "LPG",
      market: "New Delhi, 14.2 kg",
      today: formatInr(today, 2),
      yesterday: formatInr(yesterday, 2),
      change: formatChange(change, 2),
      deltaDirection: deltaDirection(change),
    },
    dateKey: todayKey,
    asOf: lpgIso,
  };
}

async function fetchMarketBoard() {
  const [goldHtml, silverHtml, niftyPayload] = await Promise.all([
    fetchTextNoCache("https://www.goodreturns.in/gold-rates/"),
    fetchTextNoCache("https://www.goodreturns.in/silver-rates/"),
    fetchJsonNoCache("https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=5d"),
  ]);

  const gold = parseGoldBoard(goldHtml);
  const silver = parseSilverBoard(silverHtml);
  const nifty = parseNiftyBoard(niftyPayload);
  const marketBoard = {
    asOf: nifty.asOf || new Date().toISOString(),
    dateKey: toIstDateKey(new Date(nifty.asOf || Date.now())),
    meta: `${gold.yesterdayLabel} vs ${gold.todayLabel}. Gold and silver are India retail rates. Nifty tracks the NSE benchmark index.`,
    items: [gold.item, silver.item, nifty.item],
    sources: [
      { label: "Gold", url: "https://www.goodreturns.in/gold-rates/" },
      { label: "Silver", url: "https://www.goodreturns.in/silver-rates/" },
      { label: "Nifty 50", url: "https://finance.yahoo.com/quote/%5ENSEI/" },
    ],
  };
  return marketBoard;
}

function parseNiftyBoard(payload = {}) {
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta || {};
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const today = Number.isFinite(Number(meta.regularMarketPrice))
    ? Number(meta.regularMarketPrice)
    : lastFiniteNumber(closes);
  const yesterday = Number.isFinite(Number(meta.previousClose)) && Number(meta.previousClose) > 0
    ? Number(meta.previousClose)
    : lastFiniteNumber(closes.slice(0, -1)) || today;

  if (!(today > 0)) throw new Error("Unable to parse Nifty rates");

  const change = today - yesterday;
  const lastTimestamp = lastFiniteNumber(timestamps);

  return {
    asOf: lastTimestamp ? new Date(lastTimestamp * 1000).toISOString() : new Date().toISOString(),
    item: {
      name: "Nifty 50",
      market: "NSE Index",
      today: formatNumber(today, 2),
      yesterday: formatNumber(yesterday, 2),
      change: formatNumberChange(change, 2),
      deltaDirection: deltaDirection(change),
    },
  };
}

function parseFunding(title = "") {
  const m = title.match(/(\$[\d,.]+[MBK]?)/i);
  if (m) return m[1];
  if (/series\s+[a-z]/i.test(title)) {
    return (title.match(/series\s+[a-z]/i) || ["Series round"])[0];
  }
  return "Undisclosed";
}

function inferCompany(title = "") {
  const cleaned = cleanText(title);
  const split = cleaned.split(/raises|raise|launches|launch|announces|builds|introduces|hits/i);
  const candidate = (split[0] || cleaned).trim();
  return candidate.slice(0, 80) || "AI Startup";
}

function inferCategory(text = "") {
  const t = text.toLowerCase();
  if (t.includes("video")) return "AI Video";
  if (t.includes("voice")) return "AI Voice";
  if (t.includes("coding") || t.includes("developer")) return "AI Dev Tools";
  if (t.includes("search")) return "AI Search";
  if (t.includes("robot")) return "Robotics";
  if (t.includes("chip") || t.includes("gpu")) return "AI Infrastructure";
  return "Applied AI";
}

function eventDateFromTitle(title, fallbackIso) {
  const text = cleanText(title);
  const dateMatch = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i);
  if (dateMatch) return dateMatch[0];
  const d = new Date(fallbackIso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function inferEventAbout(text = "") {
  const t = cleanText(text).toLowerCase();
  if (t.includes("gtc") || t.includes("nvidia") || t.includes("gpu")) {
    return "Focus on GPUs, infrastructure, and AI performance.";
  }
  if (t.includes("openai") || t.includes("dev day")) {
    return "Covers model updates, APIs, and developer features.";
  }
  if (t.includes("google") || t.includes("i/o") || t.includes("io")) {
    return "Highlights product launches across search, cloud, and mobile AI.";
  }
  if (t.includes("microsoft") || t.includes("build")) {
    return "Tracks Copilot, Azure AI, and enterprise development tools.";
  }
  if (t.includes("aws") || t.includes("re:invent") || t.includes("reinvent")) {
    return "Cloud architecture, data platforms, and AI operations updates.";
  }
  if (t.includes("summit") || t.includes("conference") || t.includes("workshop")) {
    return "Talks, demos, and practical implementation case studies.";
  }
  return "Latest sessions and practical AI implementation insights.";
}

function pickDailyNicheTool() {
  const dayKey = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  return NICHE_TOOLS[dayKey % NICHE_TOOLS.length];
}

function dayKey() {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
}

function pickDailyOne(items = []) {
  if (!items.length) return null;
  return items[dayKey() % items.length];
}

function pickDailyThree(items = []) {
  if (!items.length) return [];
  if (items.length <= 3) return items.slice(0, 3);
  const start = dayKey() % items.length;
  const picked = [];
  for (let i = 0; i < 3; i += 1) {
    picked.push(items[(start + i) % items.length]);
  }
  return picked;
}

async function fetchPeopleReading() {
  const cachedPeopleReading = sidebarBaseCache.peopleReadingPayload
    && sidebarBaseCache.peopleReadingExpiresAt > Date.now()
    ? sidebarBaseCache.peopleReadingPayload
    : null;

  if (isDatabaseCoolingDown()) {
    return {
      items: cachedPeopleReading || [],
      degraded: true,
      message: cachedPeopleReading?.length ? "" : getDatabaseBusyMessage(),
    };
  }

  try {
    const records = await prisma.article.findMany({
      where: { manual_upload: true },
      select: articleSelect,
      orderBy: [{ created_at: "desc" }],
      take: 80,
    });

    const articles = records
      .map((record) => toApiArticle(record))
      .filter(Boolean);
    const prioritized = articles
      .filter((article) => Number(article.syntheticViews || 0) > 0)
      .sort((left, right) => {
        const readerDiff = Number(right.syntheticViews || 0) - Number(left.syntheticViews || 0);
        if (readerDiff !== 0) return readerDiff;
        return new Date(right.created_at || right.published_at || 0).getTime()
          - new Date(left.created_at || left.published_at || 0).getTime();
      });
    const items = prioritized
      .slice(0, 4)
      .map((article) => ({
        id: article.id,
        title: article.title,
        summary: article.summary || article.subheadline || "",
        image_url: article.image_url || "",
        visitors: Number(article.syntheticViews || 0),
        href: buildArticleHref(article),
      }));

    if (items.length) {
      sidebarBaseCache.peopleReadingPayload = items;
      sidebarBaseCache.peopleReadingExpiresAt = Date.now() + SIDEBAR_CACHE_TTL_MS;
    }

    return {
      items,
      degraded: false,
      message: "",
    };
  } catch (error) {
    markDatabasePressure(error);
    return {
      items: cachedPeopleReading || [],
      degraded: true,
      message: cachedPeopleReading?.length ? "" : getDatabaseBusyMessage(),
    };
  }
}

async function fetchStartupSpotlight() {
  const endpoint = "https://hn.algolia.com/api/v1/search_by_date?query=ai startup raises funding&tags=story&hitsPerPage=30&page=0";
  const payload = await fetchJsonNoCache(endpoint);
  const hits = payload.hits || [];
  const pool = hits.filter((h) => h.title && h.url);
  const best = pickDailyOne(pool) || pool[0];
  if (!best) throw new Error("No startup story");

  const title = cleanText(best.title || best.story_title || "AI Startup Update");
  return {
    company: inferCompany(title),
    funding: parseFunding(title),
    category: inferCategory(title),
    link: best.url || `https://news.ycombinator.com/item?id=${best.objectID}`,
  };
}

async function fetchToolOfDay() {
  const endpoint = "https://hn.algolia.com/api/v1/search_by_date?query=open-source ai tool OR self-hosted llm tool OR ai developer tool github&tags=story&hitsPerPage=50&page=0";
  const payload = await fetchJsonNoCache(endpoint);
  const hits = payload.hits || [];
  const nichePool = hits.filter((h) => {
    if (!h?.title || !h?.url) return false;
    const t = cleanText(h.title).toLowerCase();
    return !MAINSTREAM_TOOL_WORDS.some((word) => t.includes(word));
  });

  const best = pickDailyOne(nichePool);
  if (!best) return pickDailyNicheTool();

  const title = cleanText(best.title || "AI Tool");
  return {
    tool: title.slice(0, 80),
    use: `Useful for ${inferCategory(title).toLowerCase()} workflows in smaller teams and indie projects.`,
    link: best.url || `https://news.ycombinator.com/item?id=${best.objectID}`,
  };
}

async function fetchUpcomingEvents() {
  const endpoint = "https://www.reddit.com/r/MachineLearning/search.json?q=conference%20OR%20summit%20OR%20dev%20day%20OR%20workshop&restrict_sr=on&sort=new&t=year&limit=20";
  const payload = await fetchJsonNoCache(endpoint);
  const children = payload.data?.children || [];
  const events = children
    .map((c) => c.data)
    .filter((p) => p?.title)
    .map((p) => ({
      name: cleanText(p.title).slice(0, 90),
      date: eventDateFromTitle(p.title, new Date((p.created_utc || 0) * 1000).toISOString()),
      about: inferEventAbout(p.title),
      link: p.url_overridden_by_dest || p.url || "https://www.reddit.com/r/MachineLearning/",
    }));

  if (!events.length) throw new Error("No events");
  return pickDailyThree(events);
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const fallback = {
    startup: pickDailyOne(STARTUP_FALLBACKS),
    events: pickDailyThree(EVENTS_FALLBACKS),
    tool: {
      ...pickDailyNicheTool(),
    },
    marketBoard: MARKET_BOARD_FALLBACK,
  };

  let eventsUsedFallback = false;
  let cachedBasePayload = null;
  if (sidebarBaseCache.payload && sidebarBaseCache.expiresAt > Date.now()) {
    cachedBasePayload = sidebarBaseCache.payload;
  } else {
    const [startup, events, tool, marketBoard] = await Promise.all([
      fetchStartupSpotlight().catch(() => fallback.startup),
      fetchUpcomingEvents().catch(() => {
        eventsUsedFallback = true;
        return fallback.events;
      }),
      fetchToolOfDay().catch(() => fallback.tool),
      fetchMarketBoard().catch(() => fallback.marketBoard),
    ]);

    sidebarBaseCache.payload = normalizeSidebarPayload({
      generatedAt: new Date().toISOString(),
      startup,
      events,
      tool,
      marketBoard,
      peopleReading: [],
      peopleReadingDegraded: false,
      peopleReadingMessage: "",
    }, fallback);
    sidebarBaseCache.expiresAt = Date.now() + (eventsUsedFallback ? SIDEBAR_FALLBACK_CACHE_TTL_MS : SIDEBAR_CACHE_TTL_MS);
    cachedBasePayload = sidebarBaseCache.payload;
  }

  const peopleReading = await fetchPeopleReading();
  const responsePayload = normalizeSidebarPayload({
    ...(cachedBasePayload || {}),
    generatedAt: new Date().toISOString(),
    peopleReading: peopleReading.items,
    peopleReadingDegraded: Boolean(peopleReading.degraded),
    peopleReadingMessage: cleanText(peopleReading.message || ""),
  }, fallback);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(200).json(responsePayload);
};
