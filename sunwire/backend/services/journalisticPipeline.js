async function runPipeline() {

  console.log("🚀 Sunwire pipeline started")

  console.log("Fetching news...")

  const articles = await fetchNews()

  console.log("Articles fetched:", articles.length)

  for (const article of articles) {

    console.log("Saving article:", article.title)

    await saveArticle(article)
  }

  console.log("✅ Pipeline finished")
}

runPipeline()
const { logEvent } = require("../utils/logger");
const { resolveArticleImage } = require("./imageFetcher");
const { summarizeNews } = require("./summarizeNews");
const {
  countWords,
  validateFinalArticle,
  validatePrePublishCandidate,
  validateSourceArticle,
} = require("./contentQuality");
const {
  buildStoryTags,
  cleanText,
  extractTopicKeywords,
  summaryFromText,
  textSimilarity,
} = require("../../lib/article/shared");
const { buildStructuredArticle } = require("../../lib/article/contentBuilder");
const { slugify } = require("../../lib/seo");

const TRUSTED_PLATFORMS = [];
const MAX_TOPIC_CLUSTERS = 18;
const MAX_COVERAGE_ITEMS = 5;

function normalizeTitle(value = "") {
  return cleanText(String(value || ""))
    .replace(/\s*[|:-]\s*(live updates?|explained|photos?|video|watch|report)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyCategory(article = {}) {
  const haystack = `${article.title || ""} ${article.summary || ""} ${article.source || ""}`.toLowerCase();
  if (/\b(ai|openai|anthropic|gemini|llm|artificial intelligence|machine learning|deepseek|mistral)\b/i.test(haystack)) return "AI";
  if (/\b(cricket|football|soccer|tennis|match|tournament|league|ipl|fifa|nba|olympics)\b/i.test(haystack)) return "Sports";
  if (/\b(movie|film|actor|actress|ott|netflix|prime video|celebrity|music|album|box office|award)\b/i.test(haystack)) return "Entertainment";
  return "Tech";
}

function buildTopicSignature(title = "") {
  return extractTopicKeywords(title, title, 6).join("|");
}

function scoreTopicSimilarity(title = "", otherTitle = "") {
  const normalizedTitle = normalizeTitle(title);
  const normalizedOther = normalizeTitle(otherTitle);
  if (!normalizedTitle || !normalizedOther) return 0;
  return Math.max(
    textSimilarity(normalizedTitle, normalizedOther),
    textSimilarity(buildTopicSignature(normalizedTitle), buildTopicSignature(normalizedOther))
  );
}

function normalizeSeedArticle(article = {}) {
  const content = cleanText(article.content || article.summary || "");
  return {
    ...article,
    title: normalizeTitle(article.title || ""),
    summary: cleanText(article.summary || ""),
    content,
    category: article.category || classifyCategory(article),
    source: cleanText(article.source || "Unknown Source"),
    source_url: cleanText(article.source_url || ""),
    published_at: article.published_at || new Date().toISOString(),
    word_count: Number(article.word_count || countWords(content)),
  };
}

function clusterTopics(rawArticles = []) {
  const clusters = [];

  rawArticles
    .map(normalizeSeedArticle)
    .filter((article) => article.title && article.source_url && article.content)
    .forEach((article) => {
      const articleSignature = buildTopicSignature(article.title);
      const existing = clusters.find((cluster) => (
        cluster.category === article.category
        && (
          scoreTopicSimilarity(cluster.query, article.title) >= 0.56
          || (
            articleSignature
            && buildTopicSignature(cluster.query)
            && buildTopicSignature(cluster.query) === articleSignature
          )
        )
      ));

      if (existing) {
        existing.seeds.push(article);
        if (article.word_count > existing.primaryWordCount) {
          existing.query = article.title;
          existing.primaryWordCount = article.word_count;
        }
        return;
      }

      clusters.push({
        query: article.title,
        category: article.category,
        primaryWordCount: article.word_count,
        seeds: [article],
      });
    });

  return clusters
    .sort((left, right) => (
      right.seeds.length - left.seeds.length
      || right.primaryWordCount - left.primaryWordCount
      || new Date(right.seeds[0]?.published_at || 0).getTime() - new Date(left.seeds[0]?.published_at || 0).getTime()
    ))
    .slice(0, MAX_TOPIC_CLUSTERS);
}

function seedWordCount(seed = {}) {
  return Number(seed.word_count || countWords(seed.content || "")) || 0;
}

function seedPublishedAt(seed = {}) {
  const timestamp = new Date(seed.published_at || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function selectPrimarySeed(seeds = []) {
  return [...seeds]
    .sort((left, right) => (
      seedWordCount(right) - seedWordCount(left)
      || seedPublishedAt(right) - seedPublishedAt(left)
      || (right.title || "").length - (left.title || "").length
    ))[0] || null;
}

function buildStructuredData({ headline = "", subheadline = "", slug = "", category = "Tech", publishedAt = "", image = "" } = {}) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline,
    description: subheadline,
    articleSection: category,
    datePublished: publishedAt || undefined,
    dateModified: publishedAt || undefined,
    image: image ? [image] : undefined,
    mainEntityOfPage: slug ? `/${category.toLowerCase()}/${slug}` : undefined,
  };
}

function buildCoverageItems(seeds = [], primarySeed = {}) {
  const seen = new Set([cleanText(primarySeed.source_url || "").toLowerCase()]);

  return seeds
    .filter((seed) => cleanText(seed.source_url || "") && seed.source_url !== primarySeed.source_url)
    .sort((left, right) => seedPublishedAt(right) - seedPublishedAt(left))
    .filter((seed) => {
      const key = cleanText(seed.source_url || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_COVERAGE_ITEMS)
    .map((seed) => ({
      name: seed.source || "Original Source",
      source: seed.source || "Original Source",
      url: seed.source_url,
      title: seed.title,
      summary: seed.summary || "",
      published_at: seed.published_at,
      wordCount: seedWordCount(seed),
    }));
}

function normalizeRewrittenArticle(text = "") {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n");
}

async function buildJournalisticArticle(topic = {}, options = {}) {
  const primarySeed = selectPrimarySeed(topic.seeds || []);
  if (!primarySeed) return null;

  const title = normalizeTitle(primarySeed.title || topic.query || "Untitled");
  const sourceValidation = validateSourceArticle({
    title,
    body: primarySeed.content,
  });

  if (!sourceValidation.ok) {
    logEvent("article.rejected", {
      stage: "source_validation",
      topic: topic.query || title,
      category: topic.category,
      title,
      source: primarySeed.source,
      url: primarySeed.source_url,
      reasons: sourceValidation.reasons,
      wordCount: sourceValidation.wordCount,
    });
    return null;
  }

  const prePublishValidation = await validatePrePublishCandidate({
    title,
    content: sourceValidation.body,
  }, {
    headlineExists: options.headlineExists,
  });

  if (!prePublishValidation.ok) {
    logEvent("article.rejected", {
      stage: "pre_publish",
      topic: topic.query || title,
      category: topic.category,
      title,
      reasons: prePublishValidation.reasons,
      wordCount: prePublishValidation.wordCount,
    });
    return null;
  }

  let rewritten = "";

  try {
    rewritten = await summarizeNews(sourceValidation.body, {
      topic: title,
      source: primarySeed.source,
      sourceUrl: primarySeed.source_url,
    });
  } catch (error) {
    logEvent("article.ai.failure", {
      stage: "rewrite",
      topic: topic.query || title,
      category: topic.category,
      title,
      source: primarySeed.source,
      url: primarySeed.source_url,
      message: error.message,
    });
    return null;
  }

  const articleContent = normalizeRewrittenArticle(rewritten);
  const finalValidation = validateFinalArticle({
    title,
    content: articleContent,
  });

  if (!finalValidation.ok) {
    logEvent("article.rejected", {
      stage: "post_ai",
      topic: topic.query || title,
      category: topic.category,
      title,
      reasons: finalValidation.reasons,
      wordCount: finalValidation.wordCount,
      sourceWordCount: sourceValidation.wordCount,
    });
    return null;
  }

  const coverage = buildCoverageItems(topic.seeds || [], primarySeed);
  const fallbackSummary = primarySeed.summary || summaryFromText(sourceValidation.body, "");
  const slug = slugify(title);
  const category = topic.category || primarySeed.category || classifyCategory(primarySeed);
  const editorial = buildStructuredArticle([
    {
      kind: "primary",
      source: primarySeed.source || "Original Source",
      title,
      url: primarySeed.source_url,
      summary: fallbackSummary,
      body: articleContent,
    },
    ...coverage.map((item) => ({
      kind: "coverage",
      source: item.name || item.source || "Original Source",
      title: item.title || "",
      url: item.url || "",
      summary: item.summary || "",
      body: "",
    })),
  ], title, fallbackSummary, {
    related: coverage,
    source: primarySeed.source || "Original Source",
    sourceUrl: primarySeed.source_url,
    category: category.toLowerCase(),
    publishedAt: primarySeed.published_at,
    tags: buildStoryTags(title, fallbackSummary, articleContent),
  });

  const subheadline = cleanText(
    editorial.summary
    || summaryFromText(articleContent, fallbackSummary)
    || fallbackSummary
  ).slice(0, 520);
  const tags = Array.isArray(editorial.tags) && editorial.tags.length
    ? editorial.tags.slice(0, 5)
    : buildStoryTags(title, subheadline, articleContent).slice(0, 5);
  const resolvedImage = await resolveArticleImage({
    title,
    summary: subheadline,
    content: articleContent,
    image_url: primarySeed.image_url,
    source_url: primarySeed.source_url,
  }).catch(() => primarySeed.image_url || "");
  const structuredData = buildStructuredData({
    headline: title,
    subheadline,
    slug,
    category,
    publishedAt: primarySeed.published_at,
    image: resolvedImage || primarySeed.image_url,
  });
  const googleNewsUrls = (topic.seeds || [])
    .map((seed) => cleanText(seed.raw_source_payload?.google_news_url || ""))
    .filter(Boolean);
  const metaTitle = cleanText(title).slice(0, 65);
  const metaDescription = cleanText(editorial.metaDescription || subheadline).slice(0, 150);

  return {
    title,
    slug,
    summary: subheadline,
    subheadline,
    content: articleContent,
    keyPoints: Array.isArray(editorial.keyPoints) ? editorial.keyPoints : [],
    tags,
    metaTitle,
    metaDescription,
    structuredData,
    primarySourceUrl: primarySeed.source_url,
    primarySourceName: primarySeed.source || "Original Source",
    trustedSources: coverage,
    category,
    published_at: primarySeed.published_at || new Date().toISOString(),
    word_count: finalValidation.wordCount,
    image_url: resolvedImage || primarySeed.image_url,
    image_storage_url: resolvedImage || primarySeed.image_url,
    source: "SunWire Desk",
    source_url: primarySeed.source_url,
    raw_content: JSON.stringify({
      workflow: "scraped_google_rss_v1",
      topicQuery: topic.query || title,
      sourceWordCount: sourceValidation.wordCount,
      finalWordCount: finalValidation.wordCount,
      wordCount: finalValidation.wordCount,
      primarySourceUrl: primarySeed.source_url,
      primarySourceName: primarySeed.source || "Original Source",
      googleNewsUrls,
      coverage,
      validation: {
        source: sourceValidation,
        prePublish: prePublishValidation,
        final: finalValidation,
      },
      subheadline,
      keyPoints: Array.isArray(editorial.keyPoints) ? editorial.keyPoints : [],
      tags,
      deepDive: Array.isArray(editorial.deepDive) ? editorial.deepDive : [],
      indiaPulse: editorial.indiaPulse || "",
      background: Array.isArray(editorial.background) ? editorial.background : [],
      factSheet: Array.isArray(editorial.factSheet) ? editorial.factSheet : [],
      estimatedReadingTime: editorial.estimatedReadingTime || 0,
      metaTitle,
      metaDescription,
      slug,
      structuredData,
    }),
    shares: Number((topic.seeds || []).reduce((sum, seed) => sum + Number(seed.shares || 0), 0)),
    views: Number((topic.seeds || []).reduce((sum, seed) => sum + Number(seed.views || 0), 0)),
  };
}

async function buildArticlesFromTopics(rawArticles = [], options = {}) {
  const topics = clusterTopics(rawArticles);
  const articles = [];

  for (const topic of topics) {
    try {
      const article = await buildJournalisticArticle(topic, options);
      if (!article) continue;
      articles.push(article);
    } catch (error) {
      logEvent("workflow.topic.error", {
        topic: topic.query,
        category: topic.category,
        message: error.message,
      });
    }
  }

  return articles;
}

module.exports = {
  TRUSTED_PLATFORMS,
  buildArticlesFromTopics,
  buildJournalisticArticle,
  classifyCategory,
  clusterTopics,
  normalizeTitle,
};
async function runPipeline() {
  console.log("Sunwire pipeline started");

  // your pipeline logic
}

runPipeline()
  .then(() => {
    console.log("Pipeline finished");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Pipeline failed:", err);
    process.exit(1);
  });
