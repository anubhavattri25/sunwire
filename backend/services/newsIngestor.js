const axios = require('axios');
const prisma = require('../config/database');
const {
  fetchPublisherArticle,
  parseRssFeed,
  resolveGoogleNewsUrl,
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
const RSS_SOURCE_ITEM_LIMIT = Math.max(1, Number.parseInt(process.env.SUNWIRE_RSS_ITEM_LIMIT || '6', 10) || 6);
const MIN_VALID_ARTICLE_CONTENT_LENGTH = 1500;
const SHORT_RSS_CONTENT_THRESHOLD = 1500;

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

function filterSourcesByRuntimeConfig(sources = []) {
  const categoryFilter = parseCsvEnvSet(
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

function getSourceConfig() {
  return sortSourcesByPriority(filterSourcesByRuntimeConfig([
    {
      name: "BBC",
      type: "rss",
      url: "https://feeds.bbci.co.uk/news/rss.xml",
      category: "general"
    },
    {
      name: "Reuters",
      type: "rss",
      url: "https://www.reuters.com/world/rss",
      category: "general"
    },
    {
      name: "TechCrunch",
      type: "rss",
      url: "https://techcrunch.com/feed/",
      category: "tech",
      language: "en"
    },
    {
      name: "The Verge",
      type: "rss",
      url: "https://www.theverge.com/rss/index.xml",
      category: "tech",
      language: "en",
      preferPublisherScrape: true,
    },
    {
      name: "ESPN",
      type: "rss",
      url: "https://www.espn.com/espn/rss/news",
      category: "sports"
    },
    {
      name: "Hollywood Reporter",
      type: "rss",
      url: "https://www.hollywoodreporter.com/feed/",
      category: "entertainment"
    },
    {
      name: "Hindustan Times",
      type: "rss",
      url: "https://www.hindustantimes.com/feeds/rss/topnews/rssfeed.xml",
      category: "general",
      language: "en",
      country: "india"
    },
    {
      name: "Times of India",
      type: "rss",
      url: "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms",
      category: "general",
      language: "en",
      country: "india"
    },
    {
      name: "India Today",
      type: "rss",
      url: "https://www.indiatoday.in/rss/home",
      category: "general",
      language: "en",
      country: "india"
    },
    {
      name: "News18",
      type: "rss",
      url: "https://www.news18.com/rss/india.xml",
      category: "general",
      language: "en",
      country: "india"
    },
    {
      name: "The Print",
      type: "rss",
      url: "https://theprint.in/feed/",
      category: "general",
      language: "en",
      country: "india"
    },
    {
      name: "Analytics India Magazine",
      type: "rss",
      url: "https://analyticsindiamag.com/feed/",
      category: "ai",
      language: "en",
      country: "india"
    },
    {
      name: "AI News",
      type: "rss",
      url: "https://artificialintelligence-news.com/feed/",
      category: "ai",
      language: "en"
    },
    {
      name: "VentureBeat AI",
      type: "rss",
      url: "https://venturebeat.com/category/ai/feed/",
      category: "ai",
      language: "en"
    },
    {
      name: "MIT Tech Review",
      type: "rss",
      url: "https://www.technologyreview.com/feed/",
      category: "ai",
      language: "en"
    },
    {
      name: "Towards Data Science",
      type: "rss",
      url: "https://towardsdatascience.com/feed",
      category: "ai",
      language: "en"
    },
    {
      name: "Wired",
      type: "rss",
      url: "https://www.wired.com/feed/rss",
      category: "tech",
      language: "en"
    },
    {
      name: "Gadgets 360",
      type: "rss",
      url: "https://feeds.feedburner.com/gadgets360-latest",
      category: "tech",
      language: "en",
      country: "india"
    },
    {
      name: "YourStory",
      type: "rss",
      url: "https://yourstory.com/feed",
      category: "tech",
      language: "en",
      country: "india"
    },
    {
      name: "Bollywood Hungama",
      type: "rss",
      url: "https://www.bollywoodhungama.com/feed/",
      category: "entertainment",
      language: "en",
      country: "india"
    },
    {
      name: "Filmfare",
      type: "rss",
      url: "https://www.filmfare.com/rss.xml",
      category: "entertainment",
      language: "en",
      country: "india"
    },
    {
      name: "Pinkvilla",
      type: "rss",
      url: "https://www.pinkvilla.com/feed",
      category: "entertainment",
      language: "en",
      country: "india"
    },
    {
      name: "Koimoi",
      type: "rss",
      url: "https://www.koimoi.com/feed/",
      category: "entertainment",
      language: "en",
      country: "india"
    },
    {
      name: "India Today Entertainment",
      type: "rss",
      url: "https://www.indiatoday.in/rss/1206578",
      category: "entertainment",
      language: "en",
      country: "india"
    },
    {
      name: "ESPN Cricinfo",
      type: "rss",
      url: "https://www.espncricinfo.com/rss/content/story/feeds/0.xml",
      category: "sports",
      language: "en",
      country: "india"
    },
    {
      name: "Sportskeeda",
      type: "rss",
      url: "https://www.sportskeeda.com/rss",
      category: "sports",
      language: "en",
      country: "india"
    },
    {
      name: "Cricbuzz",
      type: "rss",
      url: "https://www.cricbuzz.com/rss-feeds/news",
      category: "sports",
      language: "en",
      country: "india"
    },
    {
      name: "The Hindu Sports",
      type: "rss",
      url: "https://www.thehindu.com/sport/?service=rss",
      category: "sports",
      language: "en",
      country: "india"
    },
    {
      name: "Indian Express Sports",
      type: "rss",
      url: "https://indianexpress.com/section/sports/feed/",
      category: "sports",
      language: "en",
      country: "india"
    },
    {
      name: "Moneycontrol",
      type: "rss",
      url: "https://www.moneycontrol.com/rss/business.xml",
      category: "business",
      language: "en",
      country: "india"
    },
    {
      name: "Economic Times",
      type: "rss",
      url: "https://economictimes.indiatimes.com/rssfeedsdefault.cms",
      category: "business",
      language: "en",
      country: "india"
    },
    {
      name: "Business Standard",
      type: "rss",
      url: "https://www.business-standard.com/rss/home_page_top_stories.rss",
      category: "business",
      language: "en",
      country: "india"
    },
    {
      name: "LiveMint",
      type: "rss",
      url: "https://www.livemint.com/rss/homepage",
      category: "business",
      language: "en",
      country: "india"
    },
    {
      name: "Financial Express",
      type: "rss",
      url: "https://www.financialexpress.com/feed/",
      category: "business",
      language: "en",
      country: "india"
    },
    {
      name: "The Wire",
      type: "rss",
      url: "https://thewire.in/rss",
      category: "politics",
      language: "en",
      country: "india"
    },
    {
      name: "Scroll",
      type: "rss",
      url: "https://scroll.in/feeds/all.rss",
      category: "politics",
      language: "en",
      country: "india"
    },
    {
      name: "NDTV Politics",
      type: "rss",
      url: "https://feeds.feedburner.com/ndtvnews-politics",
      category: "politics",
      language: "en",
      country: "india"
    },
    {
      name: "India Today Politics",
      type: "rss",
      url: "https://www.indiatoday.in/rss/1206514",
      category: "politics",
      language: "en",
      country: "india"
    },
    {
      name: "The Hindu Politics",
      type: "rss",
      url: "https://www.thehindu.com/news/national/?service=rss",
      category: "politics",
      language: "en",
      country: "india"
    },
    {
      name: "Sarkari Result",
      type: "rss",
      url: "https://www.sarkariresult.com/rss.xml",
      category: "jobs",
      language: "en",
      country: "india"
    },
    {
      name: "FreeJobAlert",
      type: "rss",
      url: "https://www.freejobalert.com/rss.xml",
      category: "jobs",
      language: "en",
      country: "india"
    },
    {
      name: "Jagran Josh",
      type: "rss",
      url: "https://www.jagranjosh.com/rss/jobs.xml",
      category: "jobs",
      language: "en",
      country: "india"
    },
    {
      name: "FreshersLive",
      type: "rss",
      url: "https://www.fresherslive.com/rss",
      category: "jobs",
      language: "en",
      country: "india"
    },
    {
      name: "Govt Jobs Updates",
      type: "rss",
      url: "https://www.indgovtjobs.in/feeds/posts/default",
      category: "jobs",
      language: "en",
      country: "india"
    },
    {
      name: "Sanjeev Kapoor",
      type: "rss",
      url: "https://www.sanjeevkapoor.com/Recipe/rss",
      category: "food",
      language: "en",
      country: "india"
    },
    {
      name: "Archana's Kitchen",
      type: "rss",
      url: "https://www.archanaskitchen.com/rss",
      category: "food",
      language: "en",
      country: "india"
    },
    {
      name: "Veg Recipes of India",
      type: "rss",
      url: "https://www.vegrecipesofindia.com/feed/",
      category: "food",
      language: "en",
      country: "india"
    },
    {
      name: "NDTV Food",
      type: "rss",
      url: "https://feeds.feedburner.com/ndtvfood",
      category: "food",
      language: "en",
      country: "india"
    },
    {
      name: "Indian Healthy Recipes",
      type: "rss",
      url: "https://www.indianhealthyrecipes.com/feed/",
      category: "food",
      language: "en",
      country: "india"
    }
  ]));
}

function normalizeArticle(article = {}) {
  return {
    title: normalizeTitle(article.title || 'Untitled'),
    content: article.content || article.summary || article.snippet || '',
    summary: article.summary || article.snippet || '',
    image_url: article.image_url || '',
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
      image_url: String(article.imageUrl || '').trim(),
    };
  } catch (err) {
    return {
      content: '',
      image_url: '',
    };
  }
}
async function fetchRssSource(source) {
  const feed = await parseRssFeed(source.url);
  const items = Array.isArray(feed.items) ? feed.items : [];
  const limitedItems = items.slice(0, RSS_SOURCE_ITEM_LIMIT);
  const articles = await Promise.all(limitedItems.map(async (item) => {
    const feedContent =
      item["content:encoded"] ||
      item.content ||
      item.contentSnippet ||
      item.summary ||
      item.description ||
      "";
    let content = String(feedContent || '');
    let imageUrl =
      item.enclosure?.url ||
      item["media:content"]?.url ||
      item["media:thumbnail"]?.url ||
      "";

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
  }));

  return articles.filter(Boolean);
}

async function fetchGoogleSearchSource(source) {
  const url = `${process.env.GOOGLE_NEWS_RSS_BASE || 'https://news.google.com/rss'}/search?q=${encodeURIComponent(source.query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const feed = await parseRssFeed(url);
  const items = Array.isArray(feed.items) ? feed.items : [];
  const articles = await Promise.all(items.map(async (item) => {
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
  }));

  return articles.filter(Boolean);
}

async function fetchHackerNewsSource() {
  const topUrl = process.env.HACKER_NEWS_TOP_URL || 'https://hacker-news.firebaseio.com/v0/topstories.json';
  const itemBase = process.env.HACKER_NEWS_ITEM_URL || 'https://hacker-news.firebaseio.com/v0/item';
  const topIdsResponse = await axios.get(topUrl, { timeout: 10000 });
  const ids = Array.isArray(topIdsResponse.data) ? topIdsResponse.data.slice(0, 20) : [];
  const items = await Promise.all(ids.map(async (id) => {
    const response = await axios.get(`${itemBase}/${id}.json`, { timeout: 10000 });
    return response.data;
  }));

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

async function fetchSource(source) {
  logEvent('source.fetch.start', { source: source.name });
  try {
    let articles = [];
    if (source.type === 'rss') articles = await fetchRssSource(source);
    if (source.type === 'google-search') articles = await fetchGoogleSearchSource(source);
    if (source.type === 'hackernews') articles = await fetchHackerNewsSource();
    if (source.type === 'reddit') articles = await fetchRedditSource(source);

    logEvent('source.fetch.end', { source: source.name, fetched: articles.length });
    return { source: source.name, articles, ok: true };
  } catch (error) {
    logEvent('source.fetch.error', {
      source: source.name,
      message: error.message,
      status: error.response?.status || null,
    });
    return { source: source.name, articles: [], ok: false, error: error.message };
  }
}

async function ingestNewsSources() {
  logEvent('scheduler.fetch.start');
  const results = await Promise.all(getSourceConfig().map(fetchSource));
  const online = results.filter((result) => result.ok).map((result) => result.source);
  const failed = results.filter((result) => !result.ok).map((result) => ({ source: result.source, error: result.error }));
  const rawArticles = prioritizeArticles(results.flatMap((result) => result.articles));

  pipelineState.lastFetchAt = new Date().toISOString();
  pipelineState.sourcesOnline = online;
  pipelineState.sourcesFailed = failed;
  pipelineState.pendingRawArticles = rawArticles;

  logEvent('news.fetched', {
    totalFetched: rawArticles.length,
    sourcesOnline: online.length,
    sourcesFailed: failed.length,
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
