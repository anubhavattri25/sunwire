const DEFAULT_LIMIT = 1000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_PAGE = 1;
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const STORY_IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_IMAGE_CACHE_SIZE = 5000;
const MAX_UNSPLASH_ENRICH_PER_RESPONSE = 28;
const MAX_ARTICLE_DB_SIZE = 50000;
const MIN_CATEGORY_STORIES = 24;
const ALL_CATEGORIES = ["ai", "tech", "entertainment", "sports"];
const FETCH_TIMEOUT_MS = 12000;
const FETCH_RETRIES = 2;
const CDN_NEWS_CACHE_SECONDS = 5 * 60;
const CDN_NEWS_STALE_SECONDS = 10 * 60;
const FRESH_ALERT_WINDOW_MS = 2 * 60 * 60 * 1000;
const GOOGLE_TRENDS_IN_RSS_URL = "https://trends.google.com/trending/rss?geo=IN";

const MIN_SCORE_BY_CATEGORY = {
  ai: 28,
  tech: 28,
  entertainment: 34,
  sports: 34,
};

const CATEGORY_KEYWORDS = {
  ai: [
    "ai", "artificial intelligence", "llm", "model", "agent", "openai", "anthropic", "gemini",
    "chatgpt", "copilot", "machine learning", "neural", "inference", "prompt", "foundation model",
    "robotics", "deepseek", "llama", "multimodal", "reasoning model",
  ],
  tech: [
    "technology", "software", "cloud", "cybersecurity", "chip", "semiconductor", "gpu",
    "developer", "api", "automation", "startup", "data", "platform", "operating system",
    "browser", "app", "infrastructure", "saas", "security", "device", "database",
  ],
  entertainment: [
    "movie", "film", "series", "show", "streaming", "netflix", "prime video", "disney+",
    "ott", "hollywood", "bollywood", "music", "album", "artist", "celebrity", "actor",
    "actress", "box office", "trailer", "award", "relationship", "breakup", "creator",
    "influencer", "teaser", "premiere", "soundtrack",
  ],
  sports: [
    "football", "soccer", "nba", "nfl", "mlb", "nhl", "ipl", "cricket", "tennis",
    "fifa", "uefa", "goal", "match", "tournament", "championship", "race", "olympic",
    "india", "virat kohli", "rohit sharma", "dhoni", "messi", "ronaldo", "champions league",
    "injury", "transfer", "record", "medal",
  ],
};

const PRIORITY_TOPICS = {
  ai: [
    "openai", "anthropic", "gemini", "chatgpt", "deepseek", "llama", "nvidia", "ai agent",
    "copilot", "robotics", "ai chip", "reasoning model", "multimodal", "foundation model",
  ],
  tech: [
    "apple", "google", "microsoft", "amazon", "meta", "nvidia", "startup funding",
    "developer platform", "cloud", "cybersecurity", "chip", "semiconductor", "api launch",
    "database", "browser", "device",
  ],
  entertainment: [
    "bollywood", "hollywood", "celebrity", "actor", "actress", "ott", "netflix", "prime video",
    "jiohotstar", "disney+", "box office", "trailer", "award", "relationship", "breakup",
    "controversy", "influencer", "creator", "youtube creator", "instagram creator", "viral",
    "movie announcement", "ott release", "film launch", "soundtrack",
  ],
  sports: [
    "india", "indian", "cricket", "ipl", "icc", "asia cup", "virat kohli", "rohit sharma",
    "dhoni", "bumrah", "shubman gill", "messi", "ronaldo", "champions league", "premier league",
    "olympics", "medal", "transfer", "injury", "record", "final",
  ],
};

const SOCIAL_SIGNAL_TERMS = {
  ai: [
    "launches", "release", "funding", "benchmark", "breakthrough", "adoption", "developer workflow",
    "enterprise", "viral", "demo", "open source",
  ],
  tech: [
    "launches", "funding", "security alert", "breach", "rollout", "developer", "platform",
    "viral", "record", "controversy", "trend",
  ],
  entertainment: [
    "viral", "controversy", "breakup", "relationship", "trailer", "box office", "ott release",
    "fans", "teaser", "award", "debut", "comeback", "creator", "instagram", "youtube",
  ],
  sports: [
    "win", "loss", "final", "semifinal", "highlight", "controversy", "injury", "transfer",
    "record", "viral", "comeback", "knockout", "match result", "medal",
  ],
};

const ENTERTAINMENT_ENTITIES = [
  "shah rukh khan", "salman khan", "aamir khan", "alia bhatt", "deepika padukone", "ranbir kapoor",
  "priyanka chopra", "hrithik roshan", "allu arjun", "rajinikanth", "vijay", "diljit dosanjh",
  "taylor swift", "zendaya", "timothee chalamet", "dua lipa", "billie eilish", "selena gomez",
  "ariana grande", "bts", "blackpink", "netflix", "prime video", "jiohotstar", "disney+",
];

const SPORTS_ENTITIES = [
  "virat kohli", "rohit sharma", "ms dhoni", "dhoni", "jasprit bumrah", "shubman gill",
  "hardik pandya", "messi", "ronaldo", "mbappe", "haaland", "neymar", "champions league",
  "premier league", "ipl", "icc", "olympics", "india", "indian team", "novak djokovic",
  "carlos alcaraz", "f1", "formula 1",
];

const ENTERTAINMENT_CORE_TERMS = [
  "celebrity", "actor", "actress", "movie", "film", "series", "show", "trailer", "teaser",
  "premiere", "box office", "award", "relationship", "breakup", "album", "song", "music",
  "ott", "netflix", "prime video", "jiohotstar", "disney+", "hollywood", "bollywood",
  "influencer", "youtube creator", "instagram creator", "creator controversy", "soundtrack",
];

const ENTERTAINMENT_CREATOR_TERMS = ["creator", "influencer", "youtube", "instagram", "tiktok", "streamer", "podcast"];

const ENTERTAINMENT_BLOCK_TERMS = [
  "game", "gaming", "gamer", "indie game", "xbox", "playstation", "ps5", "nintendo", "switch",
  "steam", "esports", "dlc", "studio funding", "social media ban", "policy", "regulation",
  "antitrust", "privacy law", "under 16", "roblox", "government", "copyright rules", "bill", "law",
  "franchise", "studio",
];

const ENTERTAINMENT_HIGH_CONFIDENCE_TERMS = [
  "celebrity", "actor", "actress", "movie", "film", "series", "box office", "award",
  "relationship", "breakup", "album", "song", "music", "hollywood", "bollywood",
  "soundtrack", "premiere",
];

const HEADLINE_POWER_TERMS = [
  "biggest", "viral", "changes", "watch", "means", "explained", "why", "how", "record",
  "controversy", "breakthrough", "shock", "comeback", "release", "launch", "wins",
  "breaking", "everyone is talking", "viral video", "shocking update",
];

const BUSINESS_KEYWORDS = [
  "funding", "fundraise", "raised", "raises", "valuation", "startup", "earnings", "revenue",
  "profit", "loss", "ipo", "market", "markets", "stock", "stocks", "shares", "finance",
  "financial", "investor", "investment", "acquisition", "acquire", "merger", "layoff",
  "layoffs", "deal", "deals", "economy", "economic", "bank", "banking", "tariff", "trade",
];

const BUSINESS_COMPANY_TERMS = [
  "apple", "google", "alphabet", "microsoft", "amazon", "meta", "nvidia", "tesla", "openai",
  "anthropic", "netflix", "uber", "airbnb", "stripe", "oracle", "salesforce", "intel", "amd",
  "tsmc", "samsung", "jpmorgan", "goldman sachs", "bytedance", "tiktok",
];

const INDIA_AUDIENCE_PRIORITY_TERMS = [
  "india", "indian", "delhi", "mumbai", "nepal", "pakistan", "china", "bangladesh", "sri lanka",
  "prime minister", "pm", "cabinet", "parliament", "budget", "supreme court", "ceasefire",
  "war", "missile", "border", "oil", "rupee", "inflation", "train", "flight", "weather",
  "earthquake", "cyclone", "army", "defence", "defense", "upi", "aadhaar", "income tax",
];

const IMPORTANT_WORLD_SIGNAL_TERMS = [
  "war", "iran", "israel", "ukraine", "russia", "ceasefire", "missile", "airstrike", "border",
  "prime minister", "president", "cabinet", "earthquake", "cyclone", "market crash", "oil",
  "terror", "visa", "tariff",
];

const GOOGLE_TRENDS_BLOCK_TERMS = [
  "lottery", "satta", "matka", "written update", "episode", "serial", "spoiler", "dream11",
  "fantasy", "coupon", "promo code", "horoscope", "panchang",
];

const SEARCH_TREND_STOPWORDS = new Set([
  "news", "latest", "today", "live", "update", "updates", "share", "price", "video", "photos",
  "result", "results", "vs", "new", "india", "indian",
]);

const SOURCE_CATEGORY_HINTS = {
  "VentureBeat AI": "ai",
  "Google News AI": "ai",
  "Google News Tech": "tech",
  "Google News Entertainment": "entertainment",
  "Google News Sports": "sports",
  ESPN: "sports",
  "BBC Sport": "sports",
  "Sky Sports": "sports",
  Variety: "entertainment",
  "The Hollywood Reporter": "entertainment",
  Billboard: "entertainment",
};

const SOURCE_BASE_PRIORITY = {
  "Hacker News": 44,
  "Google News AI": 96,
  "Google News Tech": 88,
  "Google News Entertainment": 98,
  "Google News Sports": 98,
  "Google News India Public Interest": 124,
  "Google News India Economy": 118,
  "Google Trends India": 140,
  "X Trends India": 132,
  "YouTube India": 124,
  "Reddit India": 110,
  NDTV: 124,
  "Times of India": 122,
  "Indian Express": 124,
  "The Economic Times": 126,
  TechCrunch: 54,
  "The Verge": 50,
  Wired: 46,
  "Ars Technica": 48,
  Engadget: 42,
  "VentureBeat AI": 60,
  "MIT Tech Review": 56,
  "HackerNoon AI": 40,
  "DEV Community": 32,
  Reddit: 30,
  Variety: 82,
  "The Hollywood Reporter": 84,
  Billboard: 78,
  ESPN: 88,
  "BBC Sport": 84,
  "Sky Sports": 82,
  "SunWire Archive": 8,
};

const CURATED_FALLBACK_INPUTS = [
  {
    id: "ent-archive-20260309-01",
    category: "entertainment",
    source: "SunWire Archive",
    url: "https://sunwire.in/archive/ent-archive-20260309-01",
    title: "OTT release calendars are driving the next fight between Netflix, Prime Video, and JioHotstar",
    rawText: "Streaming platforms are tightening release windows and leaning on franchise drops, surprise cameos, and regional hits to win weekend watch time.",
    published_at: "2026-03-09T09:20:00.000Z",
  },
  {
    id: "ent-archive-20260309-02",
    category: "entertainment",
    source: "SunWire Archive",
    url: "https://sunwire.in/archive/ent-archive-20260309-02",
    title: "Bollywood trailer drops and creator reactions are deciding which films go viral before release day",
    rawText: "Studios are watching social edits, influencer clips, and first-hour comment velocity to understand whether a trailer is becoming the internet's next big obsession.",
    published_at: "2026-03-09T08:40:00.000Z",
  },
  {
    id: "ent-archive-20260309-03",
    category: "entertainment",
    source: "SunWire Archive",
    url: "https://sunwire.in/archive/ent-archive-20260309-03",
    title: "Box office momentum is back on mid-budget films that feel event-sized on social media",
    rawText: "Studios are seeing breakout momentum when strong word of mouth, memeable scenes, and creator reviews turn smaller films into high-conversation releases.",
    published_at: "2026-03-09T08:00:00.000Z",
  },
  {
    id: "sports-archive-20260309-01",
    category: "sports",
    source: "SunWire Archive",
    url: "https://sunwire.in/archive/sports-archive-20260309-01",
    title: "India match talking points now move faster when Virat Kohli or Rohit Sharma trends after the first innings",
    rawText: "Modern cricket coverage is being shaped by instant fan reaction, powerplay momentum, and selection debates that spill across every major platform.",
    published_at: "2026-03-09T09:10:00.000Z",
  },
  {
    id: "sports-archive-20260309-02",
    category: "sports",
    source: "SunWire Archive",
    url: "https://sunwire.in/archive/sports-archive-20260309-02",
    title: "Champions League knockout nights are resetting transfer talk before the season is even over",
    rawText: "Performance swings in the biggest European matches are changing how clubs, agents, and fans frame the next transfer window.",
    published_at: "2026-03-09T08:25:00.000Z",
  },
  {
    id: "sports-archive-20260309-03",
    category: "sports",
    source: "SunWire Archive",
    url: "https://sunwire.in/archive/sports-archive-20260309-03",
    title: "Injury scares, record chases, and late comebacks are dominating this week's biggest sports conversations",
    rawText: "Across cricket and football, the stories getting the most traction combine star power, knockout pressure, and genuinely high-stakes moments.",
    published_at: "2026-03-09T07:50:00.000Z",
  },
  {
    id: "business-archive-20260309-01",
    category: "business",
    source: "SunWire Archive",
    url: "https://sunwire.in/archive/business-archive-20260309-01",
    title: "Startup funding is concentrating around AI infrastructure, chip supply, and workflow automation",
    rawText: "Investors are rewarding companies with direct revenue paths, strong enterprise adoption, and clear cost-saving stories instead of broad consumer hype.",
    published_at: "2026-03-09T09:05:00.000Z",
  },
  {
    id: "business-archive-20260309-02",
    category: "business",
    source: "SunWire Archive",
    url: "https://sunwire.in/archive/business-archive-20260309-02",
    title: "Big Tech earnings calls are becoming the fastest way to spot the next AI spending wave",
    rawText: "Cloud demand, GPU supply, hiring discipline, and capex commentary are shaping how markets price the next year of platform growth.",
    published_at: "2026-03-09T08:30:00.000Z",
  },
  {
    id: "business-archive-20260309-03",
    category: "business",
    source: "SunWire Archive",
    url: "https://sunwire.in/archive/business-archive-20260309-03",
    title: "Layoffs, acquisitions, and market-share fights are resetting which tech companies look strongest",
    rawText: "Boards and investors are pushing for tighter margins, faster product focus, and deals that lock in distribution before the next cycle turns.",
    published_at: "2026-03-09T07:55:00.000Z",
  },
];

module.exports = {
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
};
