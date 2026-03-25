const { createHash } = require("node:crypto");
const {
  buildArticlePath,
  buildArticleState,
  decodeParam,
  injectHead,
  minifyHtml,
  readTemplate,
  slugify,
} = require("../lib/seo");
const {
  DEFAULT_AUTHOR_NAME,
  MIN_INDEXABLE_ARTICLE_WORDS,
  buildIndexableArticlePayload,
} = require("../lib/article/googleNews");
const articleHandler = require("./article");
const { findStoryByIdentity, findStoryBySlug } = require("../lib/server/backendCompat");
const {
  getStoriesForSsr,
  getArticlesFromPayload,
} = require("../lib/server/ssrStories");
const { buildArticleRelatedSets, renderArticleTemplate } = require("../lib/ssr");
const { buildPublisherReview } = require("../lib/article/publisherReview");
const { cleanText, isLowValueTrendText } = require("../lib/article/shared");
const ARTICLE_SSR_POOL_SIZE = 250;
const ARTICLE_FALLBACK_POOL_SIZE = 120;
const ARTICLE_FALLBACK_FILTERS = ["politics", "business", "ai", "tech", "entertainment", "sports", "jobs", "food"];
const ARTICLE_BROWSER_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";
const ARTICLE_CDN_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";

function normalizeUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function slugCandidates(story = {}) {
  return [...new Set([
    story.slug,
    story.title,
    story.summary,
    story.subheadline,
    story.metaTitle,
    story.metaDescription,
    `${story.id || ""} ${story.title || ""}`,
  ].map((value) => slugify(value || "")).filter(Boolean))];
}

function findStory(stories = [], query = {}) {
  const requestedId = String(query.id || "").trim();
  const requestedUrl = normalizeUrl(decodeParam(query.u || query.url || ""));
  const requestedTitle = String(decodeParam(query.t || query.title || "")).trim().toLowerCase();
  const requestedCategory = String(query.category || query.c || "").trim().toLowerCase();
  const requestedSlug = String(query.slug || "").trim().toLowerCase();

  return stories.find((story) => String(story.id || "").trim() === requestedId)
    || stories.find((story) => normalizeUrl(story.sourceUrl || story.url || "") === requestedUrl)
    || stories.find((story) => String(story.title || "").trim().toLowerCase() === requestedTitle)
    || stories.find((story) =>
      requestedSlug
      && slugCandidates(story).some((candidate) => (
        candidate.toLowerCase() === requestedSlug
        || candidate.toLowerCase().startsWith(`${requestedSlug}-`)
        || requestedSlug.startsWith(`${candidate.toLowerCase()}-`)
      ))
      && (!requestedCategory || String(story.category || "").toLowerCase() === requestedCategory)
    )
    || null;
}

function buildArticleQuery(story = {}, article = {}) {
  return {
    id: story.id || "",
    slug: story.slug || "",
    u: story.sourceUrl || story.url || "",
    t: story.title || "",
    s: article.source || story.source || "",
    c: story.category || "",
    p: story.source_published_at || story.published_at || story.publishedAt || "",
    m: article.summary || story.summary || "",
    i: article.image || story.image || "",
    tags: Array.isArray(article.tags) ? article.tags.join(",") : "",
    wordCount: article.wordCount || "",
    articleBody: article.body || story.content || "",
    primarySourceUrl: article.primarySource?.url || article.sourceUrl || story.sourceUrl || story.url || "",
    authorName: article.authorName || story.authorName || DEFAULT_AUTHOR_NAME,
    modifiedAt: article.modifiedAt || story.updatedAt || story.updated_at || story.source_published_at || story.published_at || "",
  };
}

function safeArticleSummary(value = "") {
  const summary = cleanText(value);
  return isLowValueTrendText(summary) ? "" : summary;
}

function sanitizeArticleBody(value = "") {
  const body = cleanText(value);
  return isLowValueTrendText(body) ? "" : body;
}

function getVerifiedKeyPoints(article = {}) {
  return Array.isArray(article?.keyPoints)
    ? article.keyPoints
      .map((point) => cleanText(point))
      .filter((point) => point && !isLowValueTrendText(point))
    : [];
}

function hasVerifiedArticleContent(article = {}, story = {}) {
  const summary = safeArticleSummary(article.summary || story.summary || "");
  const body = sanitizeArticleBody(article.body || story.content || "");
  const keyPoints = getVerifiedKeyPoints(article);
  const bodyWordCount = Number(article.wordCount || body.split(/\s+/).filter(Boolean).length);
  return Boolean(summary) && keyPoints.length >= 3 && bodyWordCount >= MIN_INDEXABLE_ARTICLE_WORDS;
}

function isLowTrustSnapshotStory(story = {}, article = {}) {
  const source = cleanText(story.source || article.source || "");
  if (/^google trends india$/i.test(source)) return true;

  const combined = cleanText([
    story.summary || "",
    story.content || "",
    article.summary || "",
    article.body || "",
  ].join(" "));

  return Boolean(combined) && isLowValueTrendText(combined);
}

function shouldRejectSnapshotArticle(sourceMode = "", story = {}, article = {}) {
  if (sourceMode !== "snapshot") return false;
  if (!isLowTrustSnapshotStory(story, article)) return false;
  const sourceUrl = cleanText(story.sourceUrl || article.sourceUrl || article.url || "");
  if (/^https?:\/\//i.test(sourceUrl)) return false;
  return !hasVerifiedArticleContent(article, story);
}

function sendNotFound(res) {
  res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", ARTICLE_BROWSER_CACHE_CONTROL);
  res.setHeader("CDN-Cache-Control", ARTICLE_CDN_CACHE_CONTROL);
  res.setHeader("Vercel-CDN-Cache-Control", ARTICLE_CDN_CACHE_CONTROL);
  res.send(readTemplate("404.html"));
}

function isCanonicalRequest(story = {}, query = {}) {
  const requestedSlug = String(query.slug || "").trim().toLowerCase();
  if (!requestedSlug) return false;
  const expectedPath = buildArticlePath({
    id: story.id || "",
    slug: story.slug || "",
    title: story.title || "",
    category: story.category || "",
  });
  return expectedPath.toLowerCase() === `/article/${requestedSlug}`;
}

function hasFallbackIdentityQuery(query = {}) {
  return [
    "id",
    "u",
    "url",
    "t",
    "title",
    "s",
    "source",
    "p",
    "publishedAt",
    "m",
    "summary",
    "i",
    "image",
    "c",
    "category",
  ].some((key) => {
    const value = query?.[key];
    return value != null && String(value).trim() !== "";
  });
}

async function findStoryInFallbackPools(query = {}) {
  const requestedCategory = String(query.category || query.c || "").trim().toLowerCase();
  const fallbackFilters = [...new Set([
    requestedCategory && requestedCategory !== "all" ? requestedCategory : "",
    ...ARTICLE_FALLBACK_FILTERS,
  ].filter(Boolean))];

  if (!fallbackFilters.length) return null;

  const payloads = await Promise.allSettled(
    fallbackFilters.map((filter) =>
      getStoriesForSsr({
        filter,
        pageSize: ARTICLE_FALLBACK_POOL_SIZE,
        reason: `article_page_fallback_${filter}`,
      })
    )
  );

  for (const result of payloads) {
    if (result.status !== "fulfilled") continue;
    const stories = getArticlesFromPayload(result.value || {});
    const matched = findStory(stories, query);
    if (matched) return matched;
  }

  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const query = req.query || {};
    const requestedSlug = String(query.slug || "").trim();
    const requestedCategory = query.category || query.c || "";
    let sourceMode = "snapshot";
    let stories = [];
    let story = null;

    if (requestedSlug) {
      story = await findStoryBySlug({
        slug: requestedSlug,
        category: requestedCategory,
      }).catch(() => null);

      const payload = await getStoriesForSsr({ pageSize: ARTICLE_SSR_POOL_SIZE, reason: "article_page_ssr" }).catch(() => null);
      stories = getArticlesFromPayload(payload);

      if (story) {
        sourceMode = "database";
      } else {
        sourceMode = String(payload?.sourceMode || "snapshot");
        story = findStory(stories, {
          slug: requestedSlug,
          category: requestedCategory,
        });
      }

      if (!story) {
        story = await findStoryByIdentity({
          id: query.id || "",
          url: decodeParam(query.u || query.url || ""),
          title: decodeParam(query.t || query.title || ""),
          slug: requestedSlug,
          category: requestedCategory,
        }).catch(() => null);
      }

      if (!story) {
        story = await findStoryInFallbackPools({
          ...query,
          slug: requestedSlug,
          category: requestedCategory,
        }).catch(() => null);
      }

      if (!story) {
        sendNotFound(res);
        return;
      }
    } else {
      const payload = await getStoriesForSsr({ pageSize: ARTICLE_SSR_POOL_SIZE, reason: "article_page_ssr" }).catch(() => null);
      stories = getArticlesFromPayload(payload);
      sourceMode = String(payload?.sourceMode || "snapshot");
      story = findStory(stories, query)
        || await findStoryByIdentity({
          id: query.id || "",
          url: decodeParam(query.u || query.url || ""),
          title: decodeParam(query.t || query.title || ""),
          slug: requestedSlug,
          category: requestedCategory,
        }).catch(() => null)
        || await findStoryInFallbackPools(query).catch(() => null);
    }
    const state = buildArticleState(buildArticleQuery(story || {}, story || {}));

    if (!state.hasIdentity) {
      sendNotFound(res);
      return;
    }

    if ((query.category || query.slug) && !hasFallbackIdentityQuery(query) && !isCanonicalRequest(story || {}, query)) {
      res.setHeader("Location", buildArticlePath({
        id: story?.id || "",
        slug: story?.slug || "",
        title: story?.title || "",
        category: story?.category || "",
      }));
      res.setHeader("Cache-Control", ARTICLE_BROWSER_CACHE_CONTROL);
      res.setHeader("CDN-Cache-Control", ARTICLE_CDN_CACHE_CONTROL);
      res.setHeader("Vercel-CDN-Cache-Control", ARTICLE_CDN_CACHE_CONTROL);
      res.status(301).send("");
      return;
    }

    const requestedArticle = {
      id: story?.id || "",
      slug: story?.slug || requestedSlug,
      url: story?.sourceUrl || story?.url || "",
      title: story?.title || "Story",
      source: story?.source || "SunWire Desk",
      publishedAt: story?.source_published_at || story?.published_at || story?.publishedAt || "",
      summary: story?.summary || story?.subheadline || "",
      image: story?.image || "",
      category: story?.category || requestedCategory || "",
    };

    const isManualStory = Boolean(story?.manual_upload);
    let article = isManualStory
      ? articleHandler.toArticlePayload(story || {}, requestedArticle)
      : await articleHandler.enrichThinArticlePayload(
        articleHandler.toArticlePayload(story || {}, requestedArticle)
      ).catch(() => null);

    if (!article) {
      article = {
        title: story?.title || "Story",
        summary: safeArticleSummary(story?.subheadline || story?.summary || ""),
        source: story?.source || "SunWire Desk",
        sourceUrl: story?.sourceUrl || story?.url || "",
        image: story?.image || "",
        keyPoints: getVerifiedKeyPoints(story),
        practicalTakeaways: Array.isArray(story?.practicalTakeaways) ? story.practicalTakeaways : [],
        body: sanitizeArticleBody(story?.body || story?.content || "") || safeArticleSummary(story?.summary || ""),
        deepDive: Array.isArray(story?.deepDive) ? story.deepDive : [],
        indiaPulse: story?.indiaPulse || "",
        background: Array.isArray(story?.background) ? story.background : [],
        factSheet: Array.isArray(story?.factSheet) ? story.factSheet : [],
        tags: Array.isArray(story?.tags) ? story.tags : [],
        wordCount: Number(story?.wordCount || 0),
        estimatedReadingTime: Number(story?.estimatedReadingTime || 0),
        primarySource: story?.primarySource || {
          name: story?.source || "Original Source",
          url: story?.sourceUrl || story?.url || "",
        },
        authorName: story?.authorName || DEFAULT_AUTHOR_NAME,
        metaTitle: story?.metaTitle || "",
        metaDescription: story?.metaDescription || "",
        structuredData: story?.structuredData || null,
      };
    }

    const relatedSets = buildArticleRelatedSets(story || {}, stories, article || {});

    if (!isManualStory) {
      article = {
        ...article,
        ...buildIndexableArticlePayload({
          id: story?.id || "",
          slug: story?.slug || requestedSlug,
          title: article?.title || story?.title || "Story",
          summary: article?.summary || story?.summary || "",
          body: article?.body || story?.content || "",
          source: article?.source || story?.source || "Sunwire Desk",
          sourceUrl: article?.sourceUrl || story?.sourceUrl || story?.url || "",
          image: article?.image || story?.image || "",
          category: article?.category || story?.category || requestedCategory || "latest",
          publishedAt: article?.published_at || article?.publishedAt || story?.source_published_at || story?.published_at || "",
          modifiedAt: article?.modifiedAt || story?.updatedAt || story?.updated_at || story?.source_published_at || "",
          tags: Array.isArray(article?.tags) ? article.tags : [],
          related: Array.isArray(relatedSets?.grid) ? relatedSets.grid : [],
          authorName: article?.authorName || story?.authorName || DEFAULT_AUTHOR_NAME,
          primarySourceUrl: article?.primarySource?.url || article?.sourceUrl || story?.sourceUrl || story?.url || "",
          primarySourceName: article?.primarySource?.name || article?.source || story?.source || DEFAULT_AUTHOR_NAME,
          metaTitle: article?.metaTitle || story?.metaTitle || "",
          metaDescription: article?.metaDescription || story?.metaDescription || "",
        }),
      };
    }

    if (shouldRejectSnapshotArticle(sourceMode, story, article)) {
      sendNotFound(res);
      return;
    }
    const publisherReview = buildPublisherReview({
      title: article?.title || story?.title || "",
      summary: article?.summary || story?.summary || "",
      content: article?.body || story?.content || "",
      keyPoints: article?.keyPoints || story?.keyPoints || [],
      deepDive: article?.deepDive || story?.deepDive || [],
      background: article?.background || story?.background || [],
      factSheet: article?.factSheet || story?.factSheet || [],
      raw_content: story?.raw_content || "",
      source: article?.source || story?.source || "",
      source_url: article?.sourceUrl || story?.sourceUrl || story?.url || "",
      word_count: article?.wordCount || story?.wordCount || 0,
      ai_rewritten: Boolean(story?.ai_rewritten || article?.ai_rewritten),
      rewriteStatus: story?.rewriteStatus || article?.rewriteStatus || "",
      manual_upload: Boolean(story?.manual_upload || article?.manual_upload),
    });

    if (!publisherReview.eligibleForPublisherNetwork) {
      sendNotFound(res);
      return;
    }

    const template = renderArticleTemplate(readTemplate("article.html"), {
      story,
      article,
      relatedSets,
      showAds: publisherReview.allowAds && process.env.SUNWIRE_ENABLE_ADSENSE === "1",
    });
    const baseHeadState = buildArticleState(buildArticleQuery(story || {}, article || {}));
    const html = injectHead(template, {
      ...baseHeadState,
      title: article?.metaTitle || story?.metaTitle || baseHeadState.title,
      description: article?.metaDescription || story?.metaDescription || baseHeadState.description,
      preloadImage: article?.image || story?.image || "",
      preloadImageWidth: 1600,
      preloadImageHeight: 900,
      preloadImageSizes: "(max-width: 960px) 100vw, 38vw",
      jsonLd: article?.structuredData
        ? [...(baseHeadState.jsonLd || []).filter((item) => item?.["@type"] !== "NewsArticle"), article.structuredData]
        : baseHeadState.jsonLd,
      type: "article",
      enableAdsense: publisherReview.allowAds && process.env.SUNWIRE_ENABLE_ADSENSE === "1",
    });
    const finalHtml = minifyHtml(html);
    const etag = `W/"${Buffer.byteLength(finalHtml).toString(16)}-${createHash("sha1").update(finalHtml).digest("base64url")}"`;
    const ifNoneMatch = String(req.headers["if-none-match"] || "");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", ARTICLE_BROWSER_CACHE_CONTROL);
    res.setHeader("CDN-Cache-Control", ARTICLE_CDN_CACHE_CONTROL);
    res.setHeader("Vercel-CDN-Cache-Control", ARTICLE_CDN_CACHE_CONTROL);
    res.setHeader("ETag", etag);

    if (ifNoneMatch.split(/\s*,\s*/).includes(etag)) {
      res.status(304).end();
      return;
    }

    res.status(200).send(finalHtml);
  } catch (_) {
    sendNotFound(res);
  }
};
