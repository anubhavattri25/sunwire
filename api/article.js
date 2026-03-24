const {
  cleanText,
  countWords,
  decodeParam,
  extractImageFromHtml,
  fetchTextNoCache,
  scoreRelevanceToTitle,
  stripHtml,
  stripSourceBoilerplate,
  summaryFromText,
} = require("../lib/article/shared");
const { extractPrimaryArticleFromHtml } = require("../lib/article/sourceDiscovery");
const {
  DEFAULT_AUTHOR_NAME,
  MIN_INDEXABLE_ARTICLE_WORDS,
  buildIndexableArticlePayload,
} = require("../lib/article/googleNews");
const { extractArticleFromHtml, isTheVergeUrl } = require("../backend/utils/articleScraper");
const { findStoryByIdentity } = require("../lib/server/backendCompat");
const { buildCacheKey, getCachedJson, setCachedJson } = require("../backend/utils/cache");
const {
  buildStoryPlaceholderImage,
  hasRenderableStoryImage,
  normalizeStoryImageUrl,
} = require("../lib/server/storyImages");

const ARTICLE_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=300";
const ARTICLE_CDN_CACHE_HEADER = "public, s-maxage=300, stale-while-revalidate=600";
const ARTICLE_CACHE_TTL_SECONDS = 300;
const MIN_RICH_BODY_WORDS = 160;
const ENABLE_REQUEST_TIME_SOURCE_RECOVERY = process.env.ENABLE_REQUEST_TIME_SOURCE_RECOVERY !== "0";
const ARTICLE_IN_FLIGHT_REQUESTS = globalThis.__SUNWIRE_ARTICLE_IN_FLIGHT_REQUESTS__ || new Map();
const BODY_JUNK_PATTERNS = [
  /posts from this author will be added to your daily email digest/i,
  /posts from this topic will be added to your daily email digest/i,
  /\bshare\b.*\bgift\b/i,
  /\bclose\b\s+\b[a-z][a-z\s.'-]{1,60}\b/i,
  /will be added to your daily email digest and your homepage feed/i,
  /follow topics and authors from this story/i,
  /most popular/i,
  /top stories/i,
];

globalThis.__SUNWIRE_ARTICLE_IN_FLIGHT_REQUESTS__ = ARTICLE_IN_FLIGHT_REQUESTS;

function parseRequestedArticle(query = {}) {
  return {
    id: decodeParam(query.id || ""),
    slug: decodeParam(query.slug || ""),
    url: decodeParam(query.url || query.u || ""),
    title: decodeParam(query.title || query.t || ""),
    source: decodeParam(query.source || query.s || "Sunwire Desk"),
    publishedAt: decodeParam(query.published_at || query.publishedAt || query.p || ""),
    summary: decodeParam(query.summary || query.m || ""),
    image: decodeParam(query.image || query.i || ""),
    category: decodeParam(query.category || query.c || "latest"),
  };
}

function buildPrimarySource(story = {}, requested = {}) {
  return story.primarySource || {
    name: story.source || requested.source || "Original Source",
    url: story.sourceUrl || story.url || requested.url || "",
  };
}

function buildAuthorName(story = {}, requested = {}) {
  return cleanText(
    story.authorName
    || requested.authorName
    || requested.byline
    || story.source
    || requested.source
    || DEFAULT_AUTHOR_NAME
  ) || DEFAULT_AUTHOR_NAME;
}

function normalizeComparableText(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isThinArticleBody(body = "", summary = "", title = "") {
  const normalizedBody = normalizeComparableText(body);
  if (!normalizedBody) return true;
  if (countWords(normalizedBody) < MIN_RICH_BODY_WORDS) return true;

  const normalizedSummary = normalizeComparableText(summary);
  const normalizedTitle = normalizeComparableText(title);
  return normalizedBody === normalizedSummary
    || normalizedBody === normalizedTitle
    || normalizedBody.startsWith(`${normalizedTitle} `);
}

function hasHtmlMarkup(value = "") {
  return /<[^>]+>/.test(String(value || ""));
}

function hasBodyJunk(value = "", sourceUrl = "") {
  const text = cleanText(stripSourceBoilerplate(value || ""));
  if (!text) return false;
  if (BODY_JUNK_PATTERNS.some((pattern) => pattern.test(text))) return true;

  if (isTheVergeUrl(sourceUrl)) {
    return /^(tina nguyen|emma roth|close|share|gift)\b/i.test(text)
      || /\bfrom this author will be added\b/i.test(text)
      || /\bdaily email digest\b/i.test(text);
  }

  return false;
}

function isPollutedArticleBody(body = "", sourceUrl = "") {
  return hasHtmlMarkup(body) || hasBodyJunk(body, sourceUrl);
}

function splitBodyParagraphs(text = "") {
  return String(text || "")
    .split(/\n{2,}/)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
}

function buildDeepDive(body = "", fallbackParagraphs = []) {
  const bodyParagraphs = splitBodyParagraphs(body);
  return bodyParagraphs.length ? bodyParagraphs : fallbackParagraphs;
}

function cleanHtmlParagraph(value = "") {
  return cleanText(stripSourceBoilerplate(stripHtml(value || "")));
}

function isBoilerplateParagraph(value = "") {
  const text = cleanText(value);
  if (!text) return true;
  if (text.length < 45) return true;
  if (text.length > 2200) return true;

  return /skip to main content|menu espn|scores schedule standings|fantasy watch|__datalayer|function rc\(|var espn|window\.__|privacy policy|terms of use/i.test(text);
}

function extractRelaxedHtmlBody(html = "", title = "", summary = "") {
  const paragraphs = [...String(html || "").matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanHtmlParagraph(match[1] || ""))
    .filter((paragraph) => !isBoilerplateParagraph(paragraph));

  if (!paragraphs.length) return "";

  const firstRelevantIndex = paragraphs.findIndex((paragraph) =>
    scoreRelevanceToTitle(title, paragraph) >= 2
    || scoreRelevanceToTitle(summary, paragraph) >= 2
  );

  const candidateParagraphs = firstRelevantIndex >= 0
    ? paragraphs.slice(firstRelevantIndex, firstRelevantIndex + 18)
    : paragraphs.slice(0, 12);
  const candidateBody = candidateParagraphs.join("\n\n").trim();

  return countWords(candidateBody) >= MIN_RICH_BODY_WORDS
    ? candidateBody
    : "";
}

function chooseBestBody(title = "", summary = "", candidates = []) {
  return candidates
    .map((candidate) => cleanText(candidate))
    .filter(Boolean)
    .sort((left, right) => {
      const rightScore = countWords(right) + (scoreRelevanceToTitle(title, right) * 5);
      const leftScore = countWords(left) + (scoreRelevanceToTitle(title, left) * 5);
      return rightScore - leftScore;
    })[0]
    || "";
}

function toArticlePayload(story = {}, requested = {}) {
  const title = story.title || requested.title || "Story";
  const summary = story.subheadline || story.summary || requested.summary || "";
  const body = story.body || story.content || "";
  const publishedAt = story.source_published_at || story.published_at || story.publishedAt || requested.publishedAt || "";
  const sourceUrl = story.sourceUrl || story.url || requested.url || "";
  const image = story.image || story.image_url || requested.image || "";

  const basePayload = {
    id: story.id || requested.id || "",
    slug: story.slug || requested.slug || "",
    title,
    source: story.source || requested.source || "Sunwire Desk",
    sourceUrl,
    published_at: publishedAt,
    publishedAt,
    image,
    summary,
    category: story.category || requested.category || "latest",
    keyPoints: Array.isArray(story.keyPoints) ? story.keyPoints : [],
    practicalTakeaways: [],
    body,
    deepDive: Array.isArray(story.deepDive) ? story.deepDive : [],
    indiaPulse: story.indiaPulse || "",
    background: Array.isArray(story.background) ? story.background : [],
    factSheet: Array.isArray(story.factSheet) ? story.factSheet : [],
    tags: Array.isArray(story.tags) ? story.tags : [],
    metaDescription: story.metaDescription || summary.slice(0, 160),
    wordCount: Number(story.wordCount || 0),
    estimatedReadingTime: Number(story.estimatedReadingTime || 0),
    primarySource: buildPrimarySource(story, requested),
    authorName: buildAuthorName(story, requested),
    youtubeEmbedUrl: "",
    related: Array.isArray(story.trustedSources) ? story.trustedSources.slice(0, 5) : [],
    seoTitle: story.metaTitle || `${title} | Sunwire`,
    seoDescription: story.metaDescription || summary.slice(0, 160),
    manual_upload: Boolean(story.manual_upload),
    validation: {
      status: "accepted",
      reason: story.manual_upload ? "manual_upload" : "database_only",
    },
  };

  if (story.manual_upload) {
    return basePayload;
  }

  const enriched = buildIndexableArticlePayload({
    id: story.id || requested.id || "",
    slug: story.slug || requested.slug || "",
    title,
    summary,
    body,
    source: basePayload.source,
    sourceUrl,
    image,
    category: story.category || requested.category || "latest",
    publishedAt,
    modifiedAt: story.updatedAt || requested.updatedAt || publishedAt,
    related: basePayload.related,
    tags: basePayload.tags,
    authorName: basePayload.authorName,
    metaTitle: story.metaTitle || "",
    metaDescription: story.metaDescription || "",
    primarySourceUrl: basePayload.primarySource?.url || sourceUrl,
    primarySourceName: basePayload.primarySource?.name || basePayload.source,
  });

  return {
    ...basePayload,
    ...enriched,
  };
}

function buildArticleRequestCacheKey(requested = {}) {
  return buildCacheKey(
    "article",
    cleanText(requested.slug || ""),
    cleanText(requested.id || ""),
    cleanText(requested.category || "latest"),
    cleanText(requested.url || ""),
    cleanText(requested.title || "")
  );
}

async function enrichThinArticlePayload(payload = {}) {
  if (!payload) return payload;
  if (payload.manual_upload) return payload;

  const sourceUrl = cleanText(payload.primarySource?.url || payload.sourceUrl || "");
  const storedBodyIsPolluted = isPollutedArticleBody(payload.body, sourceUrl);
  const storedSummaryIsPolluted = hasBodyJunk(payload.summary, sourceUrl);
  const needsBodyRecovery = storedBodyIsPolluted || isThinArticleBody(payload.body, payload.summary, payload.title);
  const needsImageRecovery = !hasRenderableStoryImage(payload.image);

  if (!needsBodyRecovery && !needsImageRecovery && Number(payload.wordCount || 0) >= MIN_INDEXABLE_ARTICLE_WORDS) {
    return payload;
  }

  if (!ENABLE_REQUEST_TIME_SOURCE_RECOVERY) {
    const recoveredPayload = needsImageRecovery
      ? { ...payload, image: buildStoryPlaceholderImage(payload) }
      : payload;
    return {
      ...recoveredPayload,
      ...buildIndexableArticlePayload({
        ...recoveredPayload,
        slug: payload.slug || "",
        category: payload.category || "latest",
        primarySourceUrl: payload.primarySource?.url || payload.sourceUrl || "",
        primarySourceName: payload.primarySource?.name || payload.source || DEFAULT_AUTHOR_NAME,
      }),
    };
  }

  if (!needsBodyRecovery) {
    const recoveredPayload = needsImageRecovery
      ? { ...payload, image: buildStoryPlaceholderImage(payload) }
      : payload;
    return {
      ...recoveredPayload,
      ...buildIndexableArticlePayload({
        ...recoveredPayload,
        slug: payload.slug || "",
        category: payload.category || "latest",
        primarySourceUrl: payload.primarySource?.url || payload.sourceUrl || "",
        primarySourceName: payload.primarySource?.name || payload.source || DEFAULT_AUTHOR_NAME,
      }),
    };
  }

  if (!/^https?:\/\//i.test(sourceUrl)) {
    const recoveredPayload = needsImageRecovery
      ? { ...payload, image: buildStoryPlaceholderImage(payload) }
      : payload;
    return {
      ...recoveredPayload,
      ...buildIndexableArticlePayload({
        ...recoveredPayload,
        slug: payload.slug || "",
        category: payload.category || "latest",
        primarySourceUrl: payload.primarySource?.url || payload.sourceUrl || "",
        primarySourceName: payload.primarySource?.name || payload.source || DEFAULT_AUTHOR_NAME,
      }),
    };
  }

  try {
    const html = await fetchTextNoCache(sourceUrl, { timeoutMs: 6000 });
    const targeted = extractArticleFromHtml(html, sourceUrl);
    const targetedBody = cleanText(targeted.content || "");
    const extracted = extractPrimaryArticleFromHtml(html, payload.title || "");
    const fallbackBody = extractRelaxedHtmlBody(html, payload.title || "", payload.summary || "");
    const bodyCandidates = [
      targetedBody,
      extracted.body,
      fallbackBody,
      storedBodyIsPolluted ? "" : payload.body,
    ].filter((candidate) => candidate && !isPollutedArticleBody(candidate, sourceUrl));
    const nextBody = (isTheVergeUrl(sourceUrl) && targetedBody)
      ? targetedBody
      : chooseBestBody(payload.title || "", payload.summary || "", bodyCandidates);

    const recoveredImage = hasRenderableStoryImage(payload.image)
      ? payload.image
      : normalizeStoryImageUrl(extractImageFromHtml(html), sourceUrl);

    if (!nextBody || isThinArticleBody(nextBody, payload.summary, payload.title)) {
      const recoveredPayload = {
        ...payload,
        image: recoveredImage || buildStoryPlaceholderImage(payload),
      };
      return {
        ...recoveredPayload,
        ...buildIndexableArticlePayload({
          ...recoveredPayload,
          slug: payload.slug || "",
          category: payload.category || "latest",
          primarySourceUrl: payload.primarySource?.url || payload.sourceUrl || sourceUrl,
          primarySourceName: payload.primarySource?.name || payload.source || DEFAULT_AUTHOR_NAME,
        }),
      };
    }

    const extractedSummary = hasBodyJunk(extracted.summary, sourceUrl) ? "" : extracted.summary;
    const safeStoredSummary = storedSummaryIsPolluted ? "" : payload.summary;
    const nextSummary = cleanText(
      extractedSummary
      || summaryFromText(nextBody, safeStoredSummary || "")
      || safeStoredSummary
    );
    const nextWordCount = Math.max(Number(payload.wordCount || 0), countWords(nextBody));

    console.log("Article source used:", sourceUrl);
    console.log("Recovered article words:", nextWordCount);

    const recoveredPayload = {
      ...payload,
      image: recoveredImage || buildStoryPlaceholderImage(payload),
      summary: nextSummary || payload.summary,
      body: nextBody,
      deepDive: buildDeepDive(nextBody),
      wordCount: nextWordCount,
      estimatedReadingTime: Math.max(Number(payload.estimatedReadingTime || 0), Math.ceil(nextWordCount / 200), 2),
      validation: {
        status: "accepted",
        reason: "source_recovered",
      },
    };
    return {
      ...recoveredPayload,
      ...buildIndexableArticlePayload({
        ...recoveredPayload,
        slug: payload.slug || "",
        category: payload.category || "latest",
        primarySourceUrl: payload.primarySource?.url || payload.sourceUrl || sourceUrl,
        primarySourceName: payload.primarySource?.name || payload.source || DEFAULT_AUTHOR_NAME,
      }),
    };
  } catch (_) {
    const recoveredPayload = needsImageRecovery
      ? { ...payload, image: buildStoryPlaceholderImage(payload) }
      : payload;
    return {
      ...recoveredPayload,
      ...buildIndexableArticlePayload({
        ...recoveredPayload,
        slug: payload.slug || "",
        category: payload.category || "latest",
        primarySourceUrl: payload.primarySource?.url || payload.sourceUrl || "",
        primarySourceName: payload.primarySource?.name || payload.source || DEFAULT_AUTHOR_NAME,
      }),
    };
  }
}

async function buildArticlePayload(req, requestedArticle) {
  const story = await findStoryByIdentity({
    id: requestedArticle.id || "",
    slug: requestedArticle.slug || "",
    url: requestedArticle.url || "",
    title: requestedArticle.title || "",
    category: requestedArticle.category || "",
  });

  if (!story) return null;
  return enrichThinArticlePayload(toArticlePayload(story, requestedArticle));
}

async function buildArticleResponse(req, requestedArticle) {
  const cacheKey = buildArticleRequestCacheKey(requestedArticle);
  const cachedPayload = await getCachedJson(cacheKey);
  if (cachedPayload) {
    return {
      payload: cachedPayload,
      cacheHeader: ARTICLE_CACHE_HEADER,
      cdnCacheHeader: ARTICLE_CDN_CACHE_HEADER,
    };
  }

  const inFlight = ARTICLE_IN_FLIGHT_REQUESTS.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    const payload = await buildArticlePayload(req, requestedArticle);
    if (payload) {
      await setCachedJson(cacheKey, payload, ARTICLE_CACHE_TTL_SECONDS);
    }
    return {
      payload,
      cacheHeader: ARTICLE_CACHE_HEADER,
      cdnCacheHeader: ARTICLE_CDN_CACHE_HEADER,
    };
  })().finally(() => {
    ARTICLE_IN_FLIGHT_REQUESTS.delete(cacheKey);
  });

  ARTICLE_IN_FLIGHT_REQUESTS.set(cacheKey, request);
  return request;
}

const handler = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const requestedArticle = parseRequestedArticle(req.query || {});
  const result = await buildArticleResponse(req, requestedArticle);
  if (!result.payload) {
    res.setHeader("Cache-Control", ARTICLE_CACHE_HEADER);
    res.setHeader("CDN-Cache-Control", ARTICLE_CDN_CACHE_HEADER);
    res.setHeader("Vercel-CDN-Cache-Control", ARTICLE_CDN_CACHE_HEADER);
    res.status(404).json({ error: "Article not found" });
    return;
  }

  res.setHeader("Cache-Control", result.cacheHeader);
  res.setHeader("CDN-Cache-Control", result.cdnCacheHeader);
  res.setHeader("Vercel-CDN-Cache-Control", result.cdnCacheHeader);
  res.status(200).json(result.payload);
};

handler.parseRequestedArticle = parseRequestedArticle;
handler.buildArticlePayload = buildArticlePayload;
handler.buildArticleResponse = buildArticleResponse;
handler.enrichThinArticlePayload = enrichThinArticlePayload;
handler.toArticlePayload = toArticlePayload;

module.exports = handler;
