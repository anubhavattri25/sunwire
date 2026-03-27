const {
  cleanText,
  containsBannedGenerationPhrase,
  countWords,
  domainFromUrl,
} = require("./shared");

const MIN_PUBLISHER_WORDS = 500;
const MIN_PUBLISHER_SUMMARY_WORDS = 20;
const MIN_PUBLISHER_PARAGRAPHS = 4;
const MIN_KEY_POINTS = 3;
const MIN_DEEP_DIVE = 3;
const MIN_BACKGROUND = 2;
const MIN_FACT_SHEET = 4;
const MAX_SOURCE_OVERLAP_RATIO = 0.85;

const COMMUNITY_SOURCE_PATTERNS = [
  /reddit/i,
  /hacker news/i,
  /news\.ycombinator\.com/i,
  /dev community/i,
];

const FILLER_PATTERNS = [
  /\bno verified summary available\b/i,
  /\bno additional verified details available\b/i,
  /\bstories (?:are|is) loading\b/i,
  /\bupdates (?:are|is) loading\b/i,
  /\bcoming soon\b/i,
  /\bloading\b/i,
  /\bfetching\b/i,
];

function parseRawContentMetadata(value = "") {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function normalizeArray(values = []) {
  return Array.isArray(values)
    ? values.map((entry) => cleanText(entry)).filter(Boolean)
    : [];
}

function splitParagraphs(text = "") {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((paragraph) => cleanText(paragraph))
    .filter(Boolean);
}

function buildTokenSet(text = "") {
  return new Set(
    cleanText(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => token.length >= 4)
      .filter((token) => ![
        "this",
        "that",
        "with",
        "from",
        "have",
        "will",
        "their",
        "about",
        "after",
        "before",
        "there",
        "which",
        "while",
        "where",
        "when",
        "what",
        "said",
        "also",
        "into",
      ].includes(token))
  );
}

function computeSourceOverlapRatio(body = "", sourceBody = "") {
  const bodyTokens = buildTokenSet(body);
  const sourceTokens = buildTokenSet(sourceBody);
  if (!bodyTokens.size || !sourceTokens.size) return 0;

  let shared = 0;
  for (const token of bodyTokens) {
    if (sourceTokens.has(token)) shared += 1;
  }

  return shared / Math.max(1, Math.min(bodyTokens.size, sourceTokens.size));
}

function normalizeReviewSourceUrl(input = {}, metadata = {}) {
  return cleanText(
    input.primarySourceUrl
    || input.sourceUrl
    || input.source_url
    || input.url
    || metadata.primarySourceUrl
    || ""
  );
}

function normalizeReviewSourceName(input = {}, metadata = {}) {
  return cleanText(
    input.primarySourceName
    || input.source
    || metadata.primarySourceName
    || ""
  );
}

function buildPublisherReview(input = {}, options = {}) {
  const metadata = options.metadata || parseRawContentMetadata(input.raw_content || "");
  const title = cleanText(input.title || metadata.title || "");
  const summary = cleanText(input.summary || input.subheadline || metadata.summary || metadata.sourceSummary || "");
  const body = cleanText(input.body || input.content || metadata.body || "");
  const paragraphs = splitParagraphs(input.body || input.content || metadata.body || "");
  const keyPoints = normalizeArray(input.keyPoints || metadata.keyPoints);
  const deepDive = normalizeArray(input.deepDive || metadata.deepDive);
  const background = Array.isArray(input.background || metadata.background)
    ? (input.background || metadata.background).filter((entry) => cleanText(entry?.title || entry?.context || "")).slice(0, 6)
    : [];
  const factSheet = Array.isArray(input.factSheet || metadata.factSheet)
    ? (input.factSheet || metadata.factSheet).filter((entry) => cleanText(entry?.label || "") && cleanText(entry?.value || "")).slice(0, 8)
    : [];
  const manualUpload = Boolean(input.manual_upload || input.manualUpload || metadata.manual_upload);
  const aiRewritten = Boolean(input.ai_rewritten || input.aiRewritten || metadata.ai_rewritten);
  const rewriteStatus = cleanText(input.rewriteStatus || input.rewrite_status || metadata.rewriteStatus || "");
  const sourceUrl = normalizeReviewSourceUrl(input, metadata);
  const sourceName = normalizeReviewSourceName(input, metadata);
  const sourceBody = cleanText(metadata.sourceBody || metadata.originalContent || "");
  const sourceOverlapRatio = sourceBody ? computeSourceOverlapRatio(body, sourceBody) : 0;
  const wordCount = Number(input.word_count || input.wordCount || metadata.wordCount || countWords(body) || 0);
  const summaryWordCount = countWords(summary);
  const blockedCommunitySource = COMMUNITY_SOURCE_PATTERNS.some((pattern) =>
    pattern.test(`${sourceName} ${sourceUrl} ${domainFromUrl(sourceUrl)}`)
  );
  const reasons = [];

  if (manualUpload) {
    return {
      eligibleForPublisherNetwork: true,
      showInPublicListings: true,
      allowArticleAccess: true,
      allowAds: true,
      shouldIndex: true,
      manualUpload,
      aiRewritten,
      rewriteStatus,
      wordCount,
      summaryWordCount,
      paragraphCount: paragraphs.length,
      keyPointCount: keyPoints.length,
      deepDiveCount: deepDive.length,
      backgroundCount: background.length,
      factSheetCount: factSheet.length,
      sourceUrl,
      sourceName,
      sourceOverlapRatio: Number(sourceOverlapRatio.toFixed(4)),
      reasons: [],
      publicVisibilityReasons: [],
    };
  }

  if (!title) reasons.push("missing_title");
  if (!body) reasons.push("missing_body");
  if (body && wordCount < MIN_PUBLISHER_WORDS) reasons.push(`body_word_count_below_${MIN_PUBLISHER_WORDS}`);
  if (summary && summaryWordCount < MIN_PUBLISHER_SUMMARY_WORDS) reasons.push(`summary_word_count_below_${MIN_PUBLISHER_SUMMARY_WORDS}`);
  if (!summary) reasons.push("missing_summary");
  if (paragraphs.length < MIN_PUBLISHER_PARAGRAPHS) reasons.push(`paragraph_count_below_${MIN_PUBLISHER_PARAGRAPHS}`);
  if (containsBannedGenerationPhrase(body) || FILLER_PATTERNS.some((pattern) => pattern.test(`${summary} ${body}`))) {
    reasons.push("placeholder_or_generated_filler");
  }
  if (keyPoints.length < MIN_KEY_POINTS) reasons.push(`key_points_below_${MIN_KEY_POINTS}`);
  if (deepDive.length < MIN_DEEP_DIVE) reasons.push(`deep_dive_below_${MIN_DEEP_DIVE}`);
  if (background.length < MIN_BACKGROUND) reasons.push(`background_items_below_${MIN_BACKGROUND}`);
  if (factSheet.length < MIN_FACT_SHEET) reasons.push(`fact_sheet_rows_below_${MIN_FACT_SHEET}`);
  if (!aiRewritten) reasons.push("auto_story_not_ai_rewritten");
  if (rewriteStatus !== "ai_rewritten") reasons.push("fallback_rewrite_blocked");
  if (!/^https?:\/\//i.test(sourceUrl)) reasons.push("missing_primary_source_url");
  if (blockedCommunitySource) reasons.push("community_source_blocked");
  if (sourceBody && sourceOverlapRatio >= MAX_SOURCE_OVERLAP_RATIO) {
    reasons.push(`source_overlap_ratio_${sourceOverlapRatio.toFixed(2)}`);
  }

  const publicVisibilityReasons = reasons.filter((reason) =>
    ![
      'auto_story_not_ai_rewritten',
      'fallback_rewrite_blocked',
    ].includes(reason)
  );

  return {
    eligibleForPublisherNetwork: reasons.length === 0,
    showInPublicListings: publicVisibilityReasons.length === 0,
    allowArticleAccess: publicVisibilityReasons.length === 0,
    allowAds: reasons.length === 0,
    shouldIndex: reasons.length === 0,
    manualUpload,
    aiRewritten,
    rewriteStatus,
    wordCount,
    summaryWordCount,
    paragraphCount: paragraphs.length,
    keyPointCount: keyPoints.length,
    deepDiveCount: deepDive.length,
    backgroundCount: background.length,
    factSheetCount: factSheet.length,
    sourceUrl,
    sourceName,
    sourceOverlapRatio: Number(sourceOverlapRatio.toFixed(4)),
    reasons,
    publicVisibilityReasons,
  };
}

function isPublisherEligible(input = {}, options = {}) {
  return buildPublisherReview(input, options).eligibleForPublisherNetwork;
}

module.exports = {
  buildPublisherReview,
  isPublisherEligible,
  parseRawContentMetadata,
};
