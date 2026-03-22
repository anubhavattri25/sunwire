const cheerio = require("cheerio");

function cleanText(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BANNED_GENERATION_PATTERNS = [
  /trending in india:/i,
  /approx search traffic/i,
  /this matters because/i,
  /experts believe/i,
  /it highlights the importance/i,
  /a practical next step/i,
  /focus on the signals that matter/i,
  /watch for follow-through/i,
  /what to watch next/i,
  /readers also benefit/i,
  /for indexing purposes/i,
  /no deep summary available/i,
  /platform performance/i,
  /engineering velocity/i,
  /traffic potential/i,
];

const SPECULATION_PATTERNS = [
  /\bmay\b/i,
  /\bmight\b/i,
  /\bcould\b/i,
  /\blikely\b/i,
  /\bperhaps\b/i,
  /\bexpected to\b/i,
  /\bappears to\b/i,
  /\bseems to\b/i,
  /\bwould\b/i,
  /\bshould\b/i,
  /\banalysts?\b/i,
  /\bopinion\b/i,
  /\bforecast\b/i,
  /\bprediction\b/i,
];

const PROMOTIONAL_PATTERNS = [
  /\bread more\b/i,
  /\bwatch\b/i,
  /\blisten\b/i,
  /\bsubscribe\b/i,
  /\bfollow us\b/i,
  /\bsign up\b/i,
  /\bclick here\b/i,
  /\blearn more\b/i,
  /\bdiscover\b/i,
  /\badvertisement\b/i,
];

const TOPIC_STOPWORDS = new Set([
  "this", "that", "with", "from", "have", "will", "into", "after", "their", "about",
  "more", "what", "when", "where", "which", "would", "could", "there", "today", "story",
  "stories", "report", "reports", "says", "said", "latest", "news", "update", "updates",
  "live", "desk", "wire", "sunwire", "india",
]);

function stripHtml(text = "") {
  return String(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function stripMarkdown(markdown = "") {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\{\%\s*youtube\s+[^\%]+\%\}/gi, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>-]/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function stripSourceBoilerplate(text = "") {
  let value = String(text);
  [
    /\bEvents Podcasts Newsletters\b/gi,
    /\bLatest Startups Venture Apple Security AI Apps\b/gi,
    /\bLatest Startups Venture\b/gi,
    /\bSign in\b/gi,
    /\bSubscribe\b/gi,
    /\bNewsletter(?:s)?\b/gi,
    /\bFollow us\b/gi,
    /\bWatch live\b/gi,
    /\bRead more\b/gi,
    /\bSkip to content\b/gi,
    /\bAdvertisement\b/gi,
    /\b\d{1,2}:\d{2}\s*(?:AM|PM)\s*[A-Z]{2,4}\s*[Â·â€¢]?\s*[A-Za-z]+\s+\d{1,2},\s+\d{4}\b/gi,
  ].forEach((pattern) => {
    value = value.replace(pattern, " ");
  });
  return value;
}

function containsBannedGenerationPhrase(text = "") {
  return BANNED_GENERATION_PATTERNS.some((pattern) => pattern.test(String(text || "")));
}

function decodeXml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function safeJsonParse(value = "") {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function decodeParam(value = "") {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function toSentences(text = "") {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35);
}

function countWords(text = "") {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function trimToWordLimit(text = "", maxWords = 30) {
  const words = cleanText(text).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ").trim()}.`;
}

function trimToWordRange(text = "", minWords = 20, maxWords = 30) {
  const words = cleanText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length > maxWords) return trimToWordLimit(words.join(" "), maxWords);
  if (words.length >= minWords) return words.join(" ");
  return words.join(" ");
}

function isLowValueTrendText(text = "") {
  const value = cleanText(text).toLowerCase();
  if (!value) return false;
  return containsBannedGenerationPhrase(value);
}

async function fetchWithoutCache(url, method, init = {}) {
  const separator = url.includes("?") ? "&" : "?";
  const controller = new AbortController();
  const timeoutMs = Number(init.timeoutMs || 0);
  const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(`${url}${separator}_ts=${Date.now()}`, {
      cache: "no-store",
      ...init,
      signal: init.signal || controller.signal,
    });
    if (!response.ok) throw new Error(`Fetch failed: ${url}`);
    return method(response);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function fetchJsonNoCache(url, init = {}) {
  return fetchWithoutCache(url, (response) => response.json(), init);
}

function fetchTextNoCache(url, init = {}) {
  return fetchWithoutCache(url, (response) => response.text(), init);
}

function looksLikeTemplateImageValue(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return true;
  return /\$\{[^}]+\}/.test(normalized) || /\{\{[^}]+\}\}/.test(normalized);
}

function pickImageCandidate($elements) {
  for (let index = 0; index < $elements.length; index += 1) {
    const element = $elements.eq(index);
    const candidate = [
      element.attr("src"),
      element.attr("data-src"),
      element.attr("data-original"),
      element.attr("data-lazy-src"),
      element.attr("data-srcset"),
      element.attr("srcset"),
    ]
      .map((value) => String(value || "").split(",")[0].trim().split(/\s+/)[0])
      .find((value) => value && !looksLikeTemplateImageValue(value));

    if (candidate) return candidate;
  }

  return "";
}

function extractImageFromHtml(html = "") {
  const pageHtml = String(html || "");
  if (!pageHtml.trim()) return "";

  const $ = cheerio.load(pageHtml);
  const metaCandidate =
    $("meta[property='og:image']").attr("content")
    || $("meta[property='og:image:url']").attr("content")
    || $("meta[name='twitter:image']").attr("content")
    || "";

  if (metaCandidate && !looksLikeTemplateImageValue(metaCandidate)) {
    return metaCandidate;
  }

  const selectorGroups = [
    "article img",
    "[itemprop='articleBody'] img",
    ".post-body img",
    ".entry-content img",
    ".article-body img",
    "main img",
    "img",
  ];

  for (const selector of selectorGroups) {
    const candidate = pickImageCandidate($(selector));
    if (candidate) return candidate;
  }

  return "";
}

function extractBodyFromJina(text = "") {
  const cleaned = String(text)
    .replace(/^Title:\s.*$/gim, "")
    .replace(/^URL Source:\s.*$/gim, "")
    .replace(/^Markdown Content:\s*/gim, "")
    .replace(/^Published Time:\s.*$/gim, "")
    .trim();

  const blocks = cleaned
    .split(/\n{2,}/)
    .map((block) => cleanText(block))
    .filter((block) => block.length > 80)
    .filter((block) => !/\[\!\[image/i.test(block))
    .filter((block) => !/profile image/i.test(block))
    .filter((block) => !/media\d*\.dev\.to\/dynamic\/image/i.test(block))
    .filter((block) => !/^https?:\/\//i.test(block));

  return blocks.slice(0, 80).join("\n\n").slice(0, 22000);
}

function cleanDeepBody(text = "") {
  const lines = stripMarkdown(stripSourceBoilerplate(text))
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => line.length > 25)
    .filter((line) => !/^image\s+\d+/i.test(line))
    .filter((line) => !/profile image/i.test(line))
    .filter((line) => !/media\d*\.dev\.to\/dynamic\/image/i.test(line))
    .filter((line) => !/\{\%\s*youtube\s+/i.test(line))
    .filter((line) => !/\[\!\[image/i.test(line))
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => !isLowValueTrendText(line));

  const dedupedLines = [];
  const seen = new Set();
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedLines.push(line);
  }

  return dedupedLines.join("\n\n").slice(0, 22000);
}

function summaryFromText(text = "", fallback = "") {
  const sentences = toSentences(text).filter((sentence) => !isLowValueTrendText(sentence));
  if (sentences.length) return sentences.slice(0, 3).join(" ").slice(0, 520);
  return isLowValueTrendText(fallback) ? "" : cleanText(fallback).slice(0, 520);
}

function detectDominantScript(text = "") {
  const value = String(text);
  const devanagariCount = (value.match(/[\u0900-\u097F]/g) || []).length;
  const bengaliCount = (value.match(/[\u0980-\u09FF]/g) || []).length;
  const latinCount = (value.match(/[A-Za-z]/g) || []).length;

  if (bengaliCount > latinCount && bengaliCount > devanagariCount) return "bengali";
  if (devanagariCount > latinCount && devanagariCount > bengaliCount) return "devanagari";
  return "latin";
}

function sentenceMatchesScript(text = "", script = "latin") {
  const value = String(text);
  if (!value.trim()) return false;
  if (script === "latin") {
    const latinCount = (value.match(/[A-Za-z]/g) || []).length;
    const indicCount = (value.match(/[\u0900-\u097F\u0980-\u09FF]/g) || []).length;
    return latinCount >= Math.max(8, indicCount);
  }
  if (script === "bengali") return /[\u0980-\u09FF]/.test(value);
  if (script === "devanagari") return /[\u0900-\u097F]/.test(value);
  return true;
}

function extractTopicKeywords(title = "", extraText = "", maxItems = 8) {
  const counts = new Map();
  const titleTokens = storyQueryTokens(title).filter((token) => !TOPIC_STOPWORDS.has(token));
  const extraTokens = storyQueryTokens(extraText).filter((token) => !TOPIC_STOPWORDS.has(token));

  titleTokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 3));
  extraTokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .map(([token]) => token)
    .slice(0, maxItems);
}

function countTopicKeywordMatches(text = "", topicKeywords = []) {
  const value = cleanText(text).toLowerCase();
  if (!value) return 0;
  return topicKeywords.filter((keyword) => value.includes(keyword.toLowerCase())).length;
}

function sentenceLooksFactual(sentence = "") {
  const value = cleanText(sentence);
  if (!value || value.length < 35) return false;
  if (containsBannedGenerationPhrase(value)) return false;
  if (SPECULATION_PATTERNS.some((pattern) => pattern.test(value))) return false;
  if (PROMOTIONAL_PATTERNS.some((pattern) => pattern.test(value))) return false;
  if (/\b(you|your|we|our|us)\b/i.test(value)) return false;
  if (/^[\"'“”‘’(]*why\b/i.test(value)) return false;
  if (/\?$/.test(value)) return false;
  return true;
}

function sentenceMatchesTopic(sentence = "", topicKeywords = [], minimumMatches = null) {
  if (!topicKeywords.length) return false;
  const requiredMatches = minimumMatches == null
    ? Math.min(2, Math.max(1, Math.ceil(topicKeywords.length / 4)))
    : minimumMatches;
  return countTopicKeywordMatches(sentence, topicKeywords) >= requiredMatches;
}

function validateTopicCoverage(text = "", topicKeywords = []) {
  const sentences = toSentences(text).filter(sentenceLooksFactual);
  if (!sentences.length || !topicKeywords.length) return false;
  const matchingSentences = sentences.filter((sentence) => sentenceMatchesTopic(sentence, topicKeywords));
  return matchingSentences.length >= Math.min(2, sentences.length)
    && (matchingSentences.length / sentences.length) >= 0.6;
}

function buildStoryTags(...texts) {
  const counts = new Map();
  texts.flatMap((text, index) => storyQueryTokens(text).map((token) => ({ token, weight: index === 0 ? 3 : 1 })))
    .filter(({ token }) => !TOPIC_STOPWORDS.has(token))
    .forEach(({ token, weight }) => {
      counts.set(token, (counts.get(token) || 0) + weight);
    });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .map(([token]) => token)
    .slice(0, 8);
}

function composeEmbeddingText({ title = "", keyPoints = [], summary = "" } = {}) {
  return cleanText([
    title,
    Array.isArray(keyPoints) ? keyPoints.join(" ") : "",
    summary,
  ].filter(Boolean).join(" "));
}

function createTextEmbedding(text = "", dimensions = 64) {
  const vector = new Array(dimensions).fill(0);
  const tokens = storyQueryTokens(text);
  if (!tokens.length) return vector;

  const grams = [
    ...tokens,
    ...tokens.slice(0, -1).map((token, index) => `${token}_${tokens[index + 1]}`),
  ];

  grams.forEach((token) => {
    let hash = 0;
    for (let index = 0; index < token.length; index += 1) {
      hash = ((hash * 31) + token.charCodeAt(index)) >>> 0;
    }
    vector[hash % dimensions] += 1;
  });

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (!magnitude) return vector;
  return vector.map((value) => value / magnitude);
}

function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return 0;
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += (Number(left[index]) || 0) * (Number(right[index]) || 0);
  }
  return sum;
}

function domainFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch (_) {
    return "";
  }
}

function storyQueryTokens(text = "") {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length > 2)
    .filter((token) => ![
      "this", "that", "with", "from", "have", "will", "into", "after", "their", "about",
      "more", "what", "when", "where", "which", "would", "could", "there", "today",
    ].includes(token));
}

function scoreCandidate(candidate = {}, tokens = []) {
  const haystack = cleanText([
    candidate.title,
    candidate.summary,
    candidate.source,
    candidate.category,
  ].filter(Boolean).join(" ")).toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length > 5 ? 3 : 2;
  }
  if (candidate.searchTrendTopic && haystack.includes(cleanText(candidate.searchTrendTopic).toLowerCase())) {
    score += 5;
  }
  if (candidate.sourceUrl || candidate.url) score += 1;
  return score;
}

function scoreRelevanceToTitle(title = "", text = "") {
  const titleTokens = storyQueryTokens(title);
  if (!titleTokens.length) return 0;

  const haystack = cleanText(text).toLowerCase();
  if (!haystack) return 0;

  let score = 0;
  for (const token of titleTokens) {
    if (haystack.includes(token)) score += token.length > 5 ? 3 : 2;
  }
  return score;
}

function compareTitleSimilarity(left = "", right = "") {
  const leftTokens = new Set(storyQueryTokens(left));
  const rightTokens = new Set(storyQueryTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function textSimilarity(left = "", right = "") {
  return compareTitleSimilarity(cleanText(left), cleanText(right));
}

function dedupeBy(items = [], keyBuilder) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyBuilder(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

module.exports = {
  buildStoryTags,
  cleanDeepBody,
  cleanText,
  composeEmbeddingText,
  compareTitleSimilarity,
  containsBannedGenerationPhrase,
  cosineSimilarity,
  countWords,
  countTopicKeywordMatches,
  createTextEmbedding,
  decodeParam,
  decodeXml,
  dedupeBy,
  detectDominantScript,
  domainFromUrl,
  extractTopicKeywords,
  extractBodyFromJina,
  extractImageFromHtml,
  fetchJsonNoCache,
  fetchTextNoCache,
  isLowValueTrendText,
  safeJsonParse,
  scoreCandidate,
  scoreRelevanceToTitle,
  sentenceLooksFactual,
  sentenceMatchesTopic,
  sentenceMatchesScript,
  storyQueryTokens,
  stripHtml,
  stripSourceBoilerplate,
  summaryFromText,
  textSimilarity,
  toSentences,
  trimToWordLimit,
  trimToWordRange,
  validateTopicCoverage,
};
