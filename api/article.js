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
const { findStoryByIdentity } = require("../lib/server/backendCompat");
const {
  buildStoryPlaceholderImage,
  hasRenderableStoryImage,
  normalizeStoryImageUrl,
} = require("../lib/server/storyImages");

const ARTICLE_CACHE_HEADER = "public, s-maxage=300, stale-while-revalidate=600";
const MIN_RICH_BODY_WORDS = 120;

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
  const summary = story.summary || story.subheadline || requested.summary || "";
  const body = story.body || story.content || "";
  const publishedAt = story.source_published_at || story.published_at || story.publishedAt || requested.publishedAt || "";
  const sourceUrl = story.sourceUrl || story.url || requested.url || "";
  const image = story.image || story.image_url || requested.image || "";

  return {
    title,
    source: story.source || requested.source || "Sunwire Desk",
    sourceUrl,
    published_at: publishedAt,
    publishedAt,
    image,
    summary,
    keyPoints: Array.isArray(story.keyPoints) ? story.keyPoints : [],
    practicalTakeaways: [],
    body,
    deepDive: Array.isArray(story.deepDive) ? story.deepDive : [],
    indiaPulse: story.indiaPulse || "",
    background: Array.isArray(story.background) ? story.background : [],
    factSheet: Array.isArray(story.factSheet) ? story.factSheet : [],
    tags: Array.isArray(story.tags) ? story.tags : [],
    metaDescription: story.metaDescription || summary.slice(0, 150),
    wordCount: Number(story.wordCount || 0),
    estimatedReadingTime: Number(story.estimatedReadingTime || 0),
    primarySource: buildPrimarySource(story, requested),
    youtubeEmbedUrl: "",
    related: Array.isArray(story.trustedSources) ? story.trustedSources.slice(0, 5) : [],
    seoTitle: story.metaTitle || `${title} | Sunwire`,
    seoDescription: story.metaDescription || summary.slice(0, 150),
    validation: {
      status: "accepted",
      reason: "database_only",
    },
  };
}

async function enrichThinArticlePayload(payload = {}) {
  if (!payload) return payload;

  const needsBodyRecovery = isThinArticleBody(payload.body, payload.summary, payload.title);
  const needsImageRecovery = !hasRenderableStoryImage(payload.image);

  if (!needsBodyRecovery && !needsImageRecovery) {
    return payload;
  }

  const sourceUrl = cleanText(payload.primarySource?.url || payload.sourceUrl || "");
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return needsImageRecovery
      ? { ...payload, image: buildStoryPlaceholderImage(payload) }
      : payload;
  }

  try {
    const html = await fetchTextNoCache(sourceUrl, { timeoutMs: 6000 });
    const extracted = extractPrimaryArticleFromHtml(html, payload.title || "");
    const fallbackBody = extractRelaxedHtmlBody(html, payload.title || "", payload.summary || "");
    const nextBody = chooseBestBody(payload.title || "", payload.summary || "", [
      extracted.body,
      fallbackBody,
      payload.body,
    ]);

    const recoveredImage = hasRenderableStoryImage(payload.image)
      ? payload.image
      : normalizeStoryImageUrl(extractImageFromHtml(html), sourceUrl);

    if (!nextBody || isThinArticleBody(nextBody, payload.summary, payload.title)) {
      return {
        ...payload,
        image: recoveredImage || buildStoryPlaceholderImage(payload),
      };
    }

    const nextSummary = cleanText(
      extracted.summary
      || payload.summary
      || summaryFromText(nextBody, payload.summary || "")
    );
    const nextWordCount = Math.max(Number(payload.wordCount || 0), countWords(nextBody));

    console.log("Article source used:", sourceUrl);
    console.log("Recovered article words:", nextWordCount);

    return {
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
  } catch (_) {
    return needsImageRecovery
      ? { ...payload, image: buildStoryPlaceholderImage(payload) }
      : payload;
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
  const payload = await buildArticlePayload(req, requestedArticle);
  return payload
    ? { payload, cacheHeader: ARTICLE_CACHE_HEADER }
    : { payload: null, cacheHeader: ARTICLE_CACHE_HEADER };
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
    res.status(404).json({ error: "Article not found" });
    return;
  }

  res.setHeader("Cache-Control", result.cacheHeader);
  res.status(200).json(result.payload);
};

handler.parseRequestedArticle = parseRequestedArticle;
handler.buildArticlePayload = buildArticlePayload;
handler.buildArticleResponse = buildArticleResponse;
handler.enrichThinArticlePayload = enrichThinArticlePayload;
handler.toArticlePayload = toArticlePayload;

module.exports = handler;
