const {
  cleanText,
  containsBannedGenerationPhrase,
} = require("../../lib/article/shared");

const MIN_SOURCE_BODY_WORDS = 350;
const MIN_FINAL_ARTICLE_WORDS = 400;
const PLACEHOLDER_OR_FILLER_PATTERNS = [
  /\bplaceholder\b/i,
  /\blorem ipsum\b/i,
  /\btbd\b/i,
  /\bto be updated\b/i,
  /\bcoming soon\b/i,
  /\bmore details (?:to follow|soon)\b/i,
  /\bupdate pending\b/i,
  /\bunder construction\b/i,
  /\bno additional verified details available\b/i,
  /\bstill being verified\b/i,
  /\bread the full story on sunwire\b/i,
  /\bloading\b/i,
  /\bfetching\b/i,
];

function countWords(text = "") {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function normalizeHeadlineForComparison(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitParagraphs(text = "") {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((paragraph) => cleanText(paragraph))
    .filter(Boolean);
}

function containsPlaceholderOrFiller(text = "") {
  const value = String(text || "");
  if (!value.trim()) return false;
  if (containsBannedGenerationPhrase(value)) return true;
  return PLACEHOLDER_OR_FILLER_PATTERNS.some((pattern) => pattern.test(value));
}

function validateSourceArticle(article = {}) {
  const headline = cleanText(article.title || "");
  const body = cleanText(article.body || article.content || article.summary || "");
  const reasons = [];
  const wordCount = countWords(body);

  if (!body) reasons.push("article_content_missing");
  if (body && wordCount < MIN_SOURCE_BODY_WORDS) reasons.push("body_word_count_below_350");

  return {
    ok: reasons.length === 0,
    headline,
    body,
    wordCount,
    reasons,
  };
}

async function validatePrePublishCandidate(article = {}, options = {}) {
  const headline = cleanText(article.title || article.headline || "");
  const body = cleanText(article.body || article.content || article.summary || "");
  const reasons = [];
  const wordCount = countWords(body);

  if (!body) reasons.push("article_content_missing");
  if (body && wordCount < MIN_SOURCE_BODY_WORDS) reasons.push("body_word_count_below_350");

  if (typeof options.headlineExists === "function" && headline) {
    const exists = await options.headlineExists(headline);
    if (exists) reasons.push("duplicate_headline_in_database");
  }

  return {
    ok: reasons.length === 0,
    headline,
    body,
    wordCount,
    reasons,
  };
}

function validateFinalArticle(article = {}) {
  const content = String(article.content || article.body || "").replace(/\r/g, "").trim();
  const paragraphs = splitParagraphs(content);
  const wordCount = countWords(content);
  const reasons = [];

  if (!content) reasons.push("article_content_missing");
  if (content && wordCount < MIN_FINAL_ARTICLE_WORDS) reasons.push("final_word_count_below_400");
  if (!paragraphs.length || paragraphs.length < 2) reasons.push("paragraphs_missing");
  if (containsPlaceholderOrFiller(content)) reasons.push("placeholder_or_filler_text");

  return {
    ok: reasons.length === 0,
    content,
    wordCount,
    paragraphCount: paragraphs.length,
    reasons,
  };
}

module.exports = {
  MIN_FINAL_ARTICLE_WORDS,
  MIN_SOURCE_BODY_WORDS,
  containsPlaceholderOrFiller,
  countWords,
  normalizeHeadlineForComparison,
  splitParagraphs,
  validateFinalArticle,
  validatePrePublishCandidate,
  validateSourceArticle,
};
