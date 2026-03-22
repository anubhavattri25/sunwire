const axios = require('axios');
const prisma = require('../config/database');
const {
  fetchPublisherArticle,
  parseRssFeed,
  resolveGoogleNewsUrl,
  scrapeHomepageFeed,
} = require('../utils/rssParser');
const { logEvent } = require('../utils/logger');
const { validateSourceArticle } = require('./contentQuality');
const { normalizeTitle } = require('../utils/articleUtils');
const { scrapeArticle } = require('../utils/articleScraper');
const { cleanText, domainFromUrl } = require('../../lib/article/shared');

const pipelineState = {
  lastFetchAt: null,
  lastProcessAt: null,
  lastTrendingUpdateAt: null,
  sourcesOnline: [],
  sourcesFailed: [],
  pendingRawArticles: [],
};
const DEFAULT_RSS_SOURCE_ITEM_LIMIT = 10;
const RSS_SOURCE_ITEM_LIMIT = Math.max(5, Number.parseInt(process.env.SUNWIRE_RSS_ITEM_LIMIT || String(DEFAULT_RSS_SOURCE_ITEM_LIMIT), 10) || DEFAULT_RSS_SOURCE_ITEM_LIMIT);
const MIN_VALID_ARTICLE_CONTENT_LENGTH = 900;
const SHORT_RSS_CONTENT_THRESHOLD = 1500;
const SOURCE_FETCH_RETRIES = Math.max(0, Number.parseInt(process.env.SUNWIRE_SOURCE_RETRIES || '2', 10) || 2);
const SOURCE_FETCH_CONCURRENCY = Math.max(1, Number.parseInt(process.env.SUNWIRE_SOURCE_FETCH_CONCURRENCY || '6', 10) || 6);
const ARTICLE_HYDRATION_CONCURRENCY = Math.max(1, Number.parseInt(process.env.SUNWIRE_ARTICLE_HYDRATION_CONCURRENCY || '3', 10) || 3);
const SCRAPE_FALLBACK_MULTIPLIER = 3;
const CATEGORY_FILTER_BYPASS = new Set(['all', 'latest', 'random']);
const AI_KEYWORDS = [
  /\b(ai|a\.i\.|artificial intelligence|machine learning|generative ai|genai|llm|chatgpt|openai|anthropic|copilot|gemini|deepfake)\b/i,
];
const TECH_KEYWORDS = [
  /\b(tech|technology|app|apps|software|hardware|smartphone|iphone|android|laptop|tablet|chip|chips|chipset|semiconductor|browser|internet|cloud|server|microsoft|google|apple|meta|amazon|openai|anthropic|ai|artificial intelligence|gadget|gadgets|wearable|device|devices|gaming)\b/i,
];
const POLITICS_KEYWORDS = [
  /\b(election|elections|poll|polls|assembly|parliament|politics|political|government|cabinet|minister|bjp|congress|aap|lok sabha|rajya sabha|chief minister|prime minister|ordinance|bill)\b/i,
];
const JOBS_KEYWORDS = [
  /\b(job|jobs|recruitment|vacancy|vacancies|notification|apply online|walk-?in|admit card|exam date|result|sarkari|government jobs|govt jobs|freshers)\b/i,
];
const IMAGE_PATH_HINT = /\.(avif|bmp|cms|gif|jpe?g|png|webp)(\?|$)|\/(wp-content|uploads|images?|img|photo|photos|media|static|assets|alternates)\//i;
const IMAGE_HOST_HINT = /(blogger\.googleusercontent|cloudfront|cdn|gstatic|img|image|media|pinimg|static|th-i\.thgim|toiimg|twimg|wp\.com|wordpress)/i;
const IMAGE_QUERY_HINT = /(^|[?&])(fm|format|h|height|img|image|q|w|width)=/i;

function normalizeSourceCategory(value = 'general') {
  return String(value || 'general').trim().toLowerCase() || 'general';
}

function normalizeSourceLanguage(value = 'en') {
  return String(value || 'en').trim().toLowerCase() || 'en';
}

function parseCsvEnvSet(value = '') {
  return new Set(
    String(value || '')
      .split(',')
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeRequestedCategorySet(value = '') {
  const parsed = parseCsvEnvSet(value);
  if (!parsed.size) return parsed;
  if ([...parsed].some((entry) => CATEGORY_FILTER_BYPASS.has(entry))) {
    return new Set();
  }
  return parsed;
}

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function runWithConcurrency(items = [], worker, concurrency = SOURCE_FETCH_CONCURRENCY) {
  const input = Array.isArray(items) ? items : [];
  const safeConcurrency = Math.max(1, Number(concurrency) || 1);
  const results = new Array(input.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < input.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(input[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, Math.max(1, input.length)) }, () => consume())
  );

  return results;
}

function filterSourcesByRuntimeConfig(sources = []) {
  const categoryFilter = normalizeRequestedCategorySet(
    process.env.SUNWIRE_SOURCE_CATEGORIES || process.env.SUNWIRE_INGEST_CATEGORIES || ''
  );
  const sourceNameFilter = parseCsvEnvSet(process.env.SUNWIRE_SOURCE_NAMES || '');

  return sources.filter((source) => {
    const sourceCategory = normalizeSourceCategory(source.category || 'general');
    const sourceName = String(source.name || '').trim().toLowerCase();

    if (categoryFilter.size > 0 && !categoryFilter.has(sourceCategory)) {
      return false;
    }

    if (sourceNameFilter.size > 0 && !sourceNameFilter.has(sourceName)) {
      return false;
    }

    return true;
  });
}

function isIndianSource(source = {}) {
  return String(source.country || '').trim().toLowerCase() === 'india';
}

function parsePublishedAt(value = '') {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isValidArticle(article = {}) {
  const cleanedContent = cleanText(article.content || '');
  return Boolean(
    article.title
    && cleanedContent
    && cleanedContent.length > MIN_VALID_ARTICLE_CONTENT_LENGTH
    && normalizeSourceLanguage(article.language) === 'en'
  );
}

function sortSourcesByPriority(sources = []) {
  return [...sources].sort((left, right) => {
    const countryDelta = Number(isIndianSource(right)) - Number(isIndianSource(left));
    if (countryDelta !== 0) return countryDelta;
    return String(left.name || '').localeCompare(String(right.name || ''));
  });
}

function prioritizeArticles(articles = []) {
  return [...articles].sort((left, right) => {
    const countryDelta = Number(isIndianSource(right)) - Number(isIndianSource(left));
    if (countryDelta !== 0) return countryDelta;

    const contentDelta = cleanText(right.content || '').length - cleanText(left.content || '').length;
    if (contentDelta !== 0) return contentDelta;

    return parsePublishedAt(right.published_at) - parsePublishedAt(left.published_at);
  });
}

function dedupeRawArticles(articles = []) {
  const seenSourceUrls = new Set();
  const seenTitleKeys = new Set();

  return (Array.isArray(articles) ? articles : []).filter((article) => {
    const sourceUrlKey = String(article?.source_url || '').trim().toLowerCase();
    const titleKey = [
      normalizeTitle(article?.title || '').toLowerCase(),
      normalizeSourceCategory(article?.category || ''),
      String(article?.source || '').trim().toLowerCase(),
    ].filter(Boolean).join('|');

    if (sourceUrlKey && seenSourceUrls.has(sourceUrlKey)) return false;
    if (titleKey && seenTitleKeys.has(titleKey)) return false;

    if (sourceUrlKey) seenSourceUrls.add(sourceUrlKey);
    if (titleKey) seenTitleKeys.add(titleKey);
    return true;
  });
}

function matchesSourcePattern(value = '', pattern) {
  if (!pattern) return false;
  if (pattern instanceof RegExp) return pattern.test(value);
  return cleanText(value).toLowerCase().includes(cleanText(pattern).toLowerCase());
}

function matchesSourceFilters(value = '', source = {}) {
  const haystack = cleanText(value);
  const includePatterns = Array.isArray(source.includeKeywords) ? source.includeKeywords : [];
  const excludePatterns = Array.isArray(source.excludeKeywords) ? source.excludeKeywords : [];

  if (includePatterns.length > 0 && !includePatterns.some((pattern) => matchesSourcePattern(haystack, pattern))) {
    return false;
  }

  if (excludePatterns.length > 0 && excludePatterns.some((pattern) => matchesSourcePattern(haystack, pattern))) {
    return false;
  }

  return true;
}

function filterSourceEntries(entries = [], source = {}, mapper = (entry) => entry) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const mapped = mapper(entry);
    return matchesSourceFilters(mapped, source);
  });
}

function normalizeImageUrl(value = '', pageUrl = '') {
  const candidate = String(value || '').trim();
  if (!candidate || /\$\{[^}]+\}/.test(candidate) || /%24%7B[^%]+%7D/i.test(candidate)) return '';

  try {
    const resolved = /^https?:\/\//i.test(candidate)
      ? candidate
      : new URL(candidate, pageUrl || undefined).toString();
    const parsed = new URL(resolved);
    const pathname = parsed.pathname.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    const pageHref = String(pageUrl || '').trim();

    if (!/^https?:$/i.test(parsed.protocol)) return '';
    if (/\.svg(\?|$)/i.test(pathname)) return '';
    if (pageHref && resolved === pageHref) return '';
    if (IMAGE_PATH_HINT.test(pathname)) return resolved;
    if (IMAGE_HOST_HINT.test(host)) return resolved;
    if (IMAGE_QUERY_HINT.test(parsed.search.toLowerCase())) return resolved;
    if (/\b(cover|hero|og-image|poster|thumb|thumbnail)\b/i.test(pathname)) return resolved;
    return '';
  } catch (_) {
    return '';
  }
}

const SOURCE_CATALOG = [
  { name: "Hindustan Times", type: "rss", url: "https://www.hindustantimes.com/feeds/rss/topnews/rssfeed.xml", homepageUrl: "https://www.hindustantimes.com/", category: "general", language: "en", country: "india" },
  { name: "Times of India", type: "rss", url: "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms", homepageUrl: "https://timesofindia.indiatimes.com/", category: "general", language: "en", country: "india" },
  { name: "India Today", type: "rss", url: "https://www.indiatoday.in/rss/home", homepageUrl: "https://www.indiatoday.in/", category: "general", language: "en", country: "india" },
  { name: "The Hindu", type: "rss", url: "https://www.thehindu.com/news/national/feeder/default.rss", homepageUrl: "https://www.thehindu.com/news/national/", category: "general", language: "en", country: "india" },
  { name: "Indian Express", type: "rss", url: "https://indianexpress.com/feed/", homepageUrl: "https://indianexpress.com/latest-news/", category: "general", language: "en", country: "india" },

  { name: "YourStory AI", type: "rss", url: "https://yourstory.com/tag/artificial-intelligence/feed", homepageUrl: "https://yourstory.com/tag/artificial-intelligence", category: "ai", language: "en", country: "india" },
  { name: "The Hindu Sci-Tech AI", type: "rss", url: "https://www.thehindu.com/sci-tech/feeder/default.rss", homepageUrl: "https://www.thehindu.com/sci-tech/", category: "ai", language: "en", country: "india", includeKeywords: AI_KEYWORDS },
  { name: "Indian Express AI", type: "rss", url: "https://indianexpress.com/section/technology/feed/", homepageUrl: "https://indianexpress.com/section/technology/", category: "ai", language: "en", country: "india", includeKeywords: AI_KEYWORDS },
  { name: "The Hindu AI", type: "rss", url: "https://www.thehindu.com/sci-tech/technology/feeder/default.rss", homepageUrl: "https://www.thehindu.com/sci-tech/technology/", category: "ai", language: "en", country: "india", includeKeywords: AI_KEYWORDS },
  { name: "LiveMint AI", type: "rss", url: "https://www.livemint.com/rss/technology", homepageUrl: "https://www.livemint.com/technology", category: "ai", language: "en", country: "india", includeKeywords: AI_KEYWORDS },

  { name: "LiveMint Tech", type: "rss", url: "https://www.livemint.com/rss/technology", homepageUrl: "https://www.livemint.com/technology", category: "tech", language: "en", country: "india", includeKeywords: TECH_KEYWORDS },
  { name: "Indian Express Tech", type: "rss", url: "https://indianexpress.com/section/technology/feed/", homepageUrl: "https://indianexpress.com/section/technology/", category: "tech", language: "en", country: "india", includeKeywords: TECH_KEYWORDS },
  { name: "TechPP", type: "rss", url: "https://techpp.com/feed/", homepageUrl: "https://techpp.com/", category: "tech", language: "en", country: "india", includeKeywords: TECH_KEYWORDS },
  { name: "India Today Technology", type: "rss", url: "https://www.indiatoday.in/rss/1206577", homepageUrl: "https://www.indiatoday.in/technology", category: "tech", language: "en", country: "india", includeKeywords: TECH_KEYWORDS },
  { name: "The Hindu Technology", type: "rss", url: "https://www.thehindu.com/sci-tech/technology/feeder/default.rss", homepageUrl: "https://www.thehindu.com/sci-tech/technology/", category: "tech", language: "en", country: "india", includeKeywords: TECH_KEYWORDS },

  { name: "Bollywood Hungama", type: "rss", url: "https://www.bollywoodhungama.com/feed/", homepageUrl: "https://www.bollywoodhungama.com/news/", category: "entertainment", language: "en", country: "india" },
  { name: "Filmfare", type: "rss", url: "https://www.filmfare.com/rss.xml", homepageUrl: "https://www.filmfare.com/news", category: "entertainment", language: "en", country: "india" },
  { name: "Pinkvilla", type: "rss", url: "https://www.pinkvilla.com/feed", homepageUrl: "https://www.pinkvilla.com/entertainment", category: "entertainment", language: "en", country: "india" },
  { name: "Koimoi", type: "rss", url: "https://www.koimoi.com/feed/", homepageUrl: "https://www.koimoi.com/", category: "entertainment", language: "en", country: "india" },
  { name: "India Today Entertainment", type: "rss", url: "https://www.indiatoday.in/rss/1206578", homepageUrl: "https://www.indiatoday.in/movies", category: "entertainment", language: "en", country: "india" },

  { name: "Hindustan Times Sports", type: "rss", url: "https://www.hindustantimes.com/feeds/rss/sports/rssfeed.xml", homepageUrl: "https://www.hindustantimes.com/sports", category: "sports", language: "en", country: "india" },
  { name: "Times of India Sports", type: "rss", url: "https://timesofindia.indiatimes.com/rssfeeds/4719148.cms", homepageUrl: "https://timesofindia.indiatimes.com/sports", category: "sports", language: "en", country: "india" },
  { name: "India Today Sports", type: "rss", url: "https://www.indiatoday.in/rss/1206550", homepageUrl: "https://www.indiatoday.in/sports", category: "sports", language: "en", country: "india" },
  { name: "The Hindu Sports", type: "rss", url: "https://www.thehindu.com/sport/feeder/default.rss", homepageUrl: "https://www.thehindu.com/sport/", category: "sports", language: "en", country: "india" },
  { name: "Indian Express Sports", type: "rss", url: "https://indianexpress.com/section/sports/feed/", homepageUrl: "https://indianexpress.com/section/sports/", category: "sports", language: "en", country: "india" },

  { name: "Moneycontrol", type: "rss", url: "https://www.moneycontrol.com/rss/business.xml", homepageUrl: "https://www.moneycontrol.com/news/business/", category: "business", language: "en", country: "india" },
  { name: "Economic Times", type: "rss", url: "https://economictimes.indiatimes.com/rssfeedsdefault.cms", homepageUrl: "https://economictimes.indiatimes.com/news", category: "business", language: "en", country: "india" },
  { name: "Hindustan Times Business", type: "rss", url: "https://www.hindustantimes.com/feeds/rss/business/rssfeed.xml", homepageUrl: "https://www.hindustantimes.com/business", category: "business", language: "en", country: "india" },
  { name: "LiveMint", type: "rss", url: "https://www.livemint.com/rss/homepage", homepageUrl: "https://www.livemint.com/", category: "business", language: "en", country: "india" },
  { name: "Financial Express", type: "rss", url: "https://www.financialexpress.com/feed/", homepageUrl: "https://www.financialexpress.com/", category: "business", language: "en", country: "india" },

  { name: "Hindustan Times Politics", type: "rss", url: "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml", homepageUrl: "https://www.hindustantimes.com/india-news", category: "politics", language: "en", country: "india", includeKeywords: POLITICS_KEYWORDS },
  { name: "Times of India Politics", type: "rss", url: "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms", homepageUrl: "https://timesofindia.indiatimes.com/india", category: "politics", language: "en", country: "india", includeKeywords: POLITICS_KEYWORDS },
  { name: "India Today Politics", type: "rss", url: "https://www.indiatoday.in/rss/1206514", homepageUrl: "https://www.indiatoday.in/india/politics", category: "politics", language: "en", country: "india" },
  { name: "The Hindu Politics", type: "rss", url: "https://www.thehindu.com/news/national/feeder/default.rss", homepageUrl: "https://www.thehindu.com/news/national/", category: "politics", language: "en", country: "india", includeKeywords: POLITICS_KEYWORDS },
  { name: "Indian Express Politics", type: "rss", url: "https://indianexpress.com/section/india/feed/", homepageUrl: "https://indianexpress.com/section/india/", category: "politics", language: "en", country: "india", includeKeywords: POLITICS_KEYWORDS },

  { name: "Adda247 Jobs", type: "scrape", homepageUrl: "https://www.adda247.com/jobs/", category: "jobs", language: "en", country: "india", includeKeywords: JOBS_KEYWORDS },
  { name: "CareerPower Jobs", type: "scrape", homepageUrl: "https://www.careerpower.in/blog/", category: "jobs", language: "en", country: "india", includeKeywords: JOBS_KEYWORDS },
  { name: "Jagran Josh Jobs", type: "rss", url: "https://www.jagranjosh.com/rss/jobs.xml", homepageUrl: "https://www.jagranjosh.com/jobs", category: "jobs", language: "en", country: "india" },
  { name: "Govt Jobs Updates", type: "rss", url: "https://www.indgovtjobs.in/feeds/posts/default", homepageUrl: "https://www.indgovtjobs.in/", category: "jobs", language: "en", country: "india" },
  { name: "Testbook Jobs", type: "rss", url: "https://testbook.com/blog/feed/", homepageUrl: "https://testbook.com/blog/category/govt-jobs/", category: "jobs", language: "en", country: "india", includeKeywords: JOBS_KEYWORDS },

  { name: "Hebbars Kitchen", type: "rss", url: "https://hebbarskitchen.com/feed/", homepageUrl: "https://hebbarskitchen.com/", category: "food", language: "en", country: "india" },
  { name: "Spice Up The Curry", type: "rss", url: "https://www.spiceupthecurry.com/feed/", homepageUrl: "https://www.spiceupthecurry.com/", category: "food", language: "en", country: "india" },
  { name: "Veg Recipes of India", type: "rss", url: "https://www.vegrecipesofindia.com/feed/", homepageUrl: "https://www.vegrecipesofindia.com/", category: "food", language: "en", country: "india" },
  { name: "Yummy Tummy", type: "rss", url: "https://www.yummytummyaarthi.com/feed/", homepageUrl: "https://www.yummytummyaarthi.com/", category: "food", language: "en", country: "india" },
  { name: "Indian Healthy Recipes", type: "scrape", homepageUrl: "https://www.indianhealthyrecipes.com/", category: "food", language: "en", country: "india" },
];

function getSourceConfig() {
  return sortSourcesByPriority(filterSourcesByRuntimeConfig(SOURCE_CATALOG));
}

function normalizeArticle(article = {}) {
  return {
    title: normalizeTitle(article.title || 'Untitled'),
    content: article.content || article.summary || article.snippet || '',
    summary: article.summary || article.snippet || '',
    image_url: normalizeImageUrl(article.image_url || '', article.source_url || article.link || ''),
    category: normalizeSourceCategory(article.category || 'general'),
    source: article.source || 'Unknown',
    source_url: article.source_url || article.link || '',
    published_at: article.published_at || new Date().toISOString(),
    language: normalizeSourceLanguage(article.language || 'en'),
    country: String(article.country || '').trim().toLowerCase(),
    views: Number(article.views || 0),
    shares: Number(article.shares || 0),
    word_count: Number(article.word_count || article.article_word_count || cleanText(article.content || '').split(/\s+/).filter(Boolean).length || 0),
    raw_source_payload: article.raw_source_payload || null,
  };
}


async function fetchFullArticle(url) {
  try {
    const article = await scrapeArticle(url);
    return {
      content: String(article.content || '').slice(0, 20000),
      image_url: normalizeImageUrl(String(article.imageUrl || '').trim(), url),
    };
  } catch (err) {
    try {
      const article = await fetchPublisherArticle(url, {});
      return {
        content: String(article.body || article.summary || '').slice(0, 20000),
        image_url: normalizeImageUrl(String(article.imageUrl || '').trim(), url),
      };
    } catch (_) {
      return {
        content: '',
        image_url: '',
      };
    }
  }
}

async function fetchScrapedSource(source) {
  const homepageUrl = source.homepageUrl || source.url;
  const homepageItems = filterSourceEntries(
    await scrapeHomepageFeed(homepageUrl, {
      limit: RSS_SOURCE_ITEM_LIMIT * SCRAPE_FALLBACK_MULTIPLIER,
    }),
    source,
    (item) => [
      item.title,
      item.description,
      item.summary,
      item.link,
    ].filter(Boolean).join(' ')
  );

  const hydrated = await runWithConcurrency(homepageItems, async (item) => {
    let content = String(item.description || item.summary || item.title || '');
    let imageUrl = normalizeImageUrl(String(item.imageUrl || '').trim(), item.link || homepageUrl);

    if (item.link) {
      const scrapedArticle = await fetchFullArticle(item.link);
      if (cleanText(scrapedArticle.content).length > cleanText(content).length) {
        content = scrapedArticle.content;
      }
      if (!imageUrl && scrapedArticle.image_url) {
        imageUrl = scrapedArticle.image_url;
      }
    }

    const normalized = normalizeArticle({
      title: item.title,
      summary: item.description || item.summary || item.title,
      content,
      image_url: imageUrl,
      source: source.name,
      source_url: item.link,
      published_at: item.published_at || new Date().toISOString(),
      category: source.category,
      language: source.language,
      country: source.country,
      raw_source_payload: item,
    });

    return isValidArticle(normalized) ? normalized : null;
  }, ARTICLE_HYDRATION_CONCURRENCY);

  return hydrated.filter(Boolean).slice(0, RSS_SOURCE_ITEM_LIMIT);
}

async function fetchRssSource(source) {
  const feed = await parseRssFeed(source.url);
  const items = filterSourceEntries(
    Array.isArray(feed.items) ? feed.items : [],
    source,
    (item) => [
      item.title,
      item.contentSnippet,
      item.summary,
      item.description,
      item.link,
    ].filter(Boolean).join(' ')
  );
  const limitedItems = items.slice(0, RSS_SOURCE_ITEM_LIMIT);
  const articles = await runWithConcurrency(limitedItems, async (item) => {
    const feedContent =
      item["content:encoded"] ||
      item.content ||
      item.contentSnippet ||
      item.summary ||
      item.description ||
      "";
    let content = String(feedContent || '');
    let imageUrl = normalizeImageUrl(
      item.enclosure?.url ||
      item["media:content"]?.url ||
      item["media:thumbnail"]?.url ||
      "",
      item.link || source.homepageUrl || source.url
    );

    if (source.preferPublisherScrape && item.link) {
      const scrapedArticle = await fetchFullArticle(item.link);
      if (scrapedArticle.content) {
        content = scrapedArticle.content;
      }
      if (scrapedArticle.image_url) {
        imageUrl = scrapedArticle.image_url;
      }
    }

    const needsContentHydration = !source.preferPublisherScrape
      && cleanText(content).length < SHORT_RSS_CONTENT_THRESHOLD
      && item.link;
    const needsImageHydration = !source.preferPublisherScrape && !imageUrl && item.link;

    if (needsContentHydration || needsImageHydration) {
      const scrapedArticle = await fetchFullArticle(item.link);

      if (cleanText(scrapedArticle.content).length > cleanText(content).length) {
        content = scrapedArticle.content;
      }
      if (!imageUrl && scrapedArticle.image_url) {
        imageUrl = scrapedArticle.image_url;
      }
    }

    const normalized = normalizeArticle({
      title: item.title,
      summary: item.contentSnippet || item.summary || item.description,
      content,
      image_url: imageUrl,
      source: source.name,
      source_url: item.link,
      published_at: item.isoDate || item.pubDate || new Date().toISOString(),
      category: source.category,
      language: source.language,
      country: source.country,
      raw_source_payload: item,
    });

    if (!isValidArticle(normalized)) {
      return null;
    }

    return normalized;
  }, ARTICLE_HYDRATION_CONCURRENCY);

  return articles.filter(Boolean);
}

async function fetchGoogleSearchSource(source) {
  const url = `${process.env.GOOGLE_NEWS_RSS_BASE || 'https://news.google.com/rss'}/search?q=${encodeURIComponent(source.query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const feed = await parseRssFeed(url);
  const items = filterSourceEntries(
    Array.isArray(feed.items) ? feed.items : [],
    source,
    (item) => [
      item.title,
      item.contentSnippet,
      item.summary,
      item.description,
      item.link,
    ].filter(Boolean).join(' ')
  );
  const limitedItems = items.slice(0, RSS_SOURCE_ITEM_LIMIT);
  const articles = await runWithConcurrency(limitedItems, async (item) => {
    const snippet = cleanText(item.contentSnippet || item.summary || item.description || '');
    const googleNewsUrl = cleanText(item.link || '');

    try {
      const publisherUrl = await resolveGoogleNewsUrl(googleNewsUrl);
      const scraped = await fetchPublisherArticle(publisherUrl, {
        title: item.title,
      });
      const sourceValidation = validateSourceArticle({
        title: item.title,
        body: scraped.body,
      });

      if (!sourceValidation.ok) {
        logEvent('source.item.rejected', {
          stage: 'google_rss_scrape',
          source: source.name,
          title: item.title,
          googleNewsUrl,
          publisherUrl: scraped.url || publisherUrl,
          reasons: sourceValidation.reasons,
          wordCount: sourceValidation.wordCount,
        });
        return null;
      }

      const normalized = normalizeArticle({
        title: scraped.title || item.title,
        summary: scraped.summary || snippet,
        content: sourceValidation.body,
        image_url: scraped.imageUrl || '',
        source: cleanText(item.creator || item.source || domainFromUrl(scraped.url || publisherUrl) || source.name),
        source_url: scraped.url || publisherUrl,
        published_at: item.isoDate || item.pubDate || new Date().toISOString(),
        category: source.category || '',
        word_count: sourceValidation.wordCount,
        raw_source_payload: {
          google_news_url: googleNewsUrl,
          publisher_url: scraped.url || publisherUrl,
          rss_item: {
            title: item.title,
            isoDate: item.isoDate || null,
            pubDate: item.pubDate || null,
            source: item.source || item.creator || null,
            contentSnippet: snippet,
          },
        },
      });

      if (!isValidArticle(normalized)) {
        logEvent('source.item.rejected', {
          stage: 'google_rss_scrape',
          source: source.name,
          title: item.title,
          googleNewsUrl,
          publisherUrl: scraped.url || publisherUrl,
          reasons: ['article_quality_filter_failed'],
          contentLength: String(normalized.content || '').length,
        });
        return null;
      }

      return normalized;
    } catch (error) {
      logEvent('source.item.error', {
        stage: 'google_rss_scrape',
        source: source.name,
        title: item.title,
        googleNewsUrl,
        message: error.message,
      });
      return null;
    }
  }, ARTICLE_HYDRATION_CONCURRENCY);

  return articles.filter(Boolean);
}

async function fetchHackerNewsSource() {
  const topUrl = process.env.HACKER_NEWS_TOP_URL || 'https://hacker-news.firebaseio.com/v0/topstories.json';
  const itemBase = process.env.HACKER_NEWS_ITEM_URL || 'https://hacker-news.firebaseio.com/v0/item';
  const topIdsResponse = await axios.get(topUrl, { timeout: 10000 });
  const ids = Array.isArray(topIdsResponse.data) ? topIdsResponse.data.slice(0, RSS_SOURCE_ITEM_LIMIT) : [];
  const items = await runWithConcurrency(ids, async (id) => {
    const response = await axios.get(`${itemBase}/${id}.json`, { timeout: 10000 });
    return response.data;
  }, ARTICLE_HYDRATION_CONCURRENCY);

  return items
    .filter(Boolean)
    .map((item) => normalizeArticle({
      title: item.title,
      content: item.text || item.title,
      summary: item.title,
      source: 'Hacker News',
      source_url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      published_at: new Date((item.time || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      shares: Number(item.score || 0),
      views: Number(item.descendants || 0),
      raw_source_payload: item,
    }));
}

async function fetchRedditSource(source) {
  const response = await axios.get(source.url, {
    timeout: 10000,
    headers: { 'User-Agent': 'SunwireBot/1.0' },
  });
  const children = response.data?.data?.children || [];
  return children.map(({ data }) => normalizeArticle({
    title: data.title,
    summary: data.selftext || data.title,
    content: data.selftext || data.title,
    image_url: data.thumbnail && /^https?:\/\//.test(data.thumbnail) ? data.thumbnail : '',
    source: source.name,
    source_url: `https://reddit.com${data.permalink}`,
    published_at: new Date((data.created_utc || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    views: Number(data.num_comments || 0),
    shares: Number(data.score || 0),
    raw_source_payload: data,
  }));
}

async function fetchSourceByType(source) {
  if (source.type === 'rss') return { articles: await fetchRssSource(source), method: 'rss' };
  if (source.type === 'scrape') return { articles: await fetchScrapedSource(source), method: 'scrape' };
  if (source.type === 'google-search') return { articles: await fetchGoogleSearchSource(source), method: 'rss' };
  if (source.type === 'hackernews') return { articles: await fetchHackerNewsSource(), method: 'rss' };
  if (source.type === 'reddit') return { articles: await fetchRedditSource(source), method: 'scrape' };
  return { articles: [], method: source.type || 'unknown' };
}

async function fetchSource(source) {
  logEvent('source.fetch.start', {
    source: source.name,
    category: source.category,
    type: source.type,
  });

  let lastError = null;

  for (let attempt = 1; attempt <= SOURCE_FETCH_RETRIES + 1; attempt += 1) {
    try {
      const { articles, method } = await fetchSourceByType(source);
      if (articles.length > 0) {
        logEvent('source.fetch.end', {
          source: source.name,
          category: source.category,
          method,
          fetched: articles.length,
          ok: true,
          attempt,
        });
        return { source: source.name, category: source.category, articles, ok: true, method, attempt };
      }

      if (source.type === 'rss' && source.homepageUrl) {
        const scrapedArticles = await fetchScrapedSource(source);
        if (scrapedArticles.length > 0) {
          logEvent('source.fetch.end', {
            source: source.name,
            category: source.category,
            method: 'scrape',
            fetched: scrapedArticles.length,
            ok: true,
            attempt,
          });
          return {
            source: source.name,
            category: source.category,
            articles: scrapedArticles,
            ok: true,
            method: 'scrape',
            attempt,
          };
        }
      }

      throw new Error(`No articles fetched via ${source.type}`);
    } catch (error) {
      lastError = error;
      logEvent('source.fetch.retry', {
        source: source.name,
        category: source.category,
        method: source.type,
        attempt,
        ok: false,
        message: error.message,
        status: error.response?.status || null,
      });

      if (attempt > SOURCE_FETCH_RETRIES) break;
      await delay(400 * attempt);
    }
  }

  if (source.type === 'rss' && source.homepageUrl) {
    try {
      const scrapedArticles = await fetchScrapedSource(source);
      if (!scrapedArticles.length) {
        throw new Error('No articles fetched via scrape fallback');
      }
      logEvent('source.fetch.end', {
        source: source.name,
        category: source.category,
        method: 'scrape',
        fetched: scrapedArticles.length,
        ok: true,
        attempt: SOURCE_FETCH_RETRIES + 1,
      });
      return { source: source.name, category: source.category, articles: scrapedArticles, ok: true, method: 'scrape' };
    } catch (scrapeError) {
      lastError = scrapeError;
    }
  }

  logEvent('source.fetch.error', {
    source: source.name,
    category: source.category,
    method: source.type,
    ok: false,
    message: lastError?.message || 'unknown_source_error',
    status: lastError?.response?.status || null,
  });
  return {
    source: source.name,
    category: source.category,
    articles: [],
    ok: false,
    error: lastError?.message || 'unknown_source_error',
    method: source.type,
  };
}

async function ingestNewsSources() {
  logEvent('scheduler.fetch.start');
  const results = await runWithConcurrency(getSourceConfig(), fetchSource, SOURCE_FETCH_CONCURRENCY);
  const online = results.filter((result) => result.ok).map((result) => result.source);
  const failed = results.filter((result) => !result.ok).map((result) => ({ source: result.source, error: result.error }));
  const rawArticles = prioritizeArticles(dedupeRawArticles(results.flatMap((result) => result.articles)));

  pipelineState.lastFetchAt = new Date().toISOString();
  pipelineState.sourcesOnline = online;
  pipelineState.sourcesFailed = failed;
  pipelineState.pendingRawArticles = rawArticles;

  logEvent('news.fetched', {
    totalFetched: rawArticles.length,
    sourcesOnline: online.length,
    sourcesFailed: failed.length,
    methods: results.reduce((acc, result) => {
      const key = result.method || 'unknown';
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {}),
  });

  return rawArticles;
}

async function getStatusCounts() {
  const now = new Date();
  const lastHour = new Date(now.getTime() - 60 * 60 * 1000);
  const last6Hours = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [articlesToday, articlesLastHour, articlesLast6Hours, articlesLast24Hours] = await Promise.all([
    prisma.article.count({ where: { created_at: { gte: today } } }),
    prisma.article.count({ where: { created_at: { gte: lastHour } } }),
    prisma.article.count({ where: { created_at: { gte: last6Hours } } }),
    prisma.article.count({ where: { created_at: { gte: last24Hours } } }),
  ]);

  return { articlesToday, articlesLastHour, articlesLast6Hours, articlesLast24Hours };
}

module.exports = {
  fetchSource,
  ingestNewsSources,
  pipelineState,
  prioritizeArticles,
  getSourceConfig,
  getStatusCounts,
};
