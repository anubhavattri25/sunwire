const crypto = require("crypto");
const OpenAI = require("openai");

const OpenAIClient = OpenAI.default || OpenAI;
const SUMMARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const summaryCache = new Map();
let client = null;

function getClient() {
  if (client) return client;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  client = new OpenAIClient({
    apiKey: process.env.OPENAI_API_KEY,
  });
  return client;
}

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
  const source = String(options.source || "").trim();
  if (!normalizedArticle) return "";

  const cached = getCachedSummary(topic, normalizedArticle);
  if (cached) return cached;

  const prompt = `
You are rewriting a scraped source news article into clean newsroom copy.

Write only the article body in 4 or 5 short paragraphs, about 400-560 words total.

Hard rules:
- Use only details that are explicitly present in the source article text below.
- Preserve names, dates, places, prices, percentages, counts, and quoted facts exactly.
- Rewrite in fresh prose; do not copy long passages from the source article.
- Do not add analysis, opinion, speculation, context, or background that is not in the source article.
- Do not mention the source article, the publisher, scraping, or that this is a rewrite.
- No filler phrases such as "this matters because", "experts believe", or "what to watch next".
- No headline, no subheadline, no bullet list, no markdown.
- Separate paragraphs with a blank line.

Topic:
${topic || "News update"}

Source:
${source || "Original publisher"}

Source article text:
${normalizedArticle}
`;

  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  });

  const content = String(response?.choices?.[0]?.message?.content || "").trim();
  return setCachedSummary(topic, normalizedArticle, content);
}

module.exports = {
  summarizeNews,
};
