const axios = require('axios');
const prisma = require('../config/database');
const {
  fetchPublisherArticle,
  parseRssFeed,
  resolveGoogleNewsUrl,
} = require('../utils/rssParser');
const { logEvent } = require('../utils/logger');
const { validateSourceArticle } = require('./contentQuality');
const { classifyCategory, normalizeTitle } = require('../utils/articleUtils');
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

function getSourceConfig() {
  return [
    
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
      category: "tech"
    },
    {
      name: "The Verge",
      type: "rss",
      url: "https://www.theverge.com/rss/index.xml",
      category: "tech",
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
    }
  ];
}

function normalizeArticle(article = {}) {
  return {
    title: normalizeTitle(article.title || 'Untitled'),
    content: article.content || article.summary || article.snippet || '',
    summary: article.summary || article.snippet || '',
    image_url: article.image_url || '',
    category: article.category || classifyCategory(article),
    source: article.source || 'Unknown',
    source_url: article.source_url || article.link || '',
    published_at: article.published_at || new Date().toISOString(),
    views: Number(article.views || 0),
    shares: Number(article.shares || 0),
    word_count: Number(article.word_count || article.article_word_count || 0),
    raw_source_payload: article.raw_source_payload || null,
  };
}


async function fetchFullArticle(url) {
  try {
    const article = await scrapeArticle(url);
    return {
      content: String(article.content || '').slice(0, 3000),
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
    let content = feedContent;
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

    if (!source.preferPublisherScrape && content.length < 800 && item.link) {
      const scrapedArticle = await fetchFullArticle(item.link);

      if (scrapedArticle.content.length > content.length) {
        content = scrapedArticle.content;
      }
      if (!imageUrl && scrapedArticle.image_url) {
        imageUrl = scrapedArticle.image_url;
      }
    }

    if (!content || content.length <= 120) {
      return null;
    }

    return normalizeArticle({
      title: item.title,
      summary: item.contentSnippet || item.summary || item.description,
      content,
      image_url: imageUrl,
      source: source.name,
      source_url: item.link,
      published_at: item.isoDate || item.pubDate || new Date().toISOString(),
      raw_source_payload: item,
    });
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

      return normalizeArticle({
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
  const rawArticles = results.flatMap((result) => result.articles);

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
  ingestNewsSources,
  pipelineState,
  getSourceConfig,
  getStatusCounts,
};
