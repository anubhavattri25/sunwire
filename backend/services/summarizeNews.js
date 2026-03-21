const crypto = require("crypto");
const { rewriteArticleLocally } = require("./localAiRewrite");

const SUMMARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const summaryCache = new Map();

function cacheKeyForArticle(topic = "", articleText = "") {
  return crypto
    .createHash("sha256")
    .update(`${String(topic || "").trim()}\n${String(articleText || "").trim()}`)
    .digest("hex");
}

function getCachedSummary(topic = "", articleText = "") {
  const key = cacheKeyForArticle(topic, articleText);
  const cached = summaryCache.get(key);
  if (!cached) return null;
  if ((Date.now() - cached.createdAt) > SUMMARY_CACHE_TTL_MS) {
    summaryCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedSummary(topic = "", articleText = "", value = "") {
  if (!value) return value;
  summaryCache.set(cacheKeyForArticle(topic, articleText), {
    value,
    createdAt: Date.now(),
  });
  return value;
}

async function summarizeNews(articleText = "", options = {}) {
  const normalizedArticle = String(articleText || "").trim();
  const topic = String(options.topic || "").trim();
  if (!normalizedArticle) return "";

  const cached = getCachedSummary(topic, normalizedArticle);
  if (cached) return cached;

  const content = await rewriteArticleLocally(normalizedArticle, options);
  return setCachedSummary(topic, normalizedArticle, String(content || "").trim());
}

module.exports = {
  summarizeNews,
};
