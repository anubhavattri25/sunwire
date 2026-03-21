const {
  buildArticlePath,
  buildArticleState,
  decodeParam,
  injectHead,
  minifyHtml,
  readTemplate,
  slugify,
} = require("../lib/seo");
const articleHandler = require("./article");
const { findStoryByIdentity, findStoryBySlug } = require("../lib/server/backendCompat");
const {
  getStoriesForSsr,
  getArticlesFromPayload,
} = require("../lib/server/ssrStories");
const { buildArticleRelatedSets, renderArticleTemplate } = require("../lib/ssr");
const { cleanText, isLowValueTrendText } = require("../lib/article/shared");
const ARTICLE_SSR_POOL_SIZE = 80;

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
  return Boolean(summary) && keyPoints.length >= 3 && bodyWordCount >= 400;
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
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
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
        }).catch(() => null);
    }
    const state = buildArticleState(buildArticleQuery(story || {}, story || {}));

    if (!state.hasIdentity) {
      sendNotFound(res);
      return;
    }

    if ((query.category || query.slug) && !isCanonicalRequest(story || {}, query)) {
      res.setHeader("Location", buildArticlePath({
        id: story?.id || "",
        slug: story?.slug || "",
        title: story?.title || "",
        category: story?.category || "",
      }));
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
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

    let article = await articleHandler.enrichThinArticlePayload(
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
        metaTitle: story?.metaTitle || "",
        metaDescription: story?.metaDescription || "",
        structuredData: story?.structuredData || null,
      };
    }

    let cacheHeader = "public, s-maxage=300, stale-while-revalidate=600";

    if (shouldRejectSnapshotArticle(sourceMode, story, article)) {
      sendNotFound(res);
      return;
    }

    const relatedSets = buildArticleRelatedSets(story || {}, stories, article || {});
    const template = renderArticleTemplate(readTemplate("article.html"), {
      story,
      article,
      relatedSets,
    });
    const baseHeadState = buildArticleState(buildArticleQuery(story || {}, article || {}));
    const html = injectHead(template, {
      ...baseHeadState,
      title: article?.metaTitle || story?.metaTitle || baseHeadState.title,
      description: article?.metaDescription || story?.metaDescription || baseHeadState.description,
      jsonLd: article?.structuredData
        ? [...(baseHeadState.jsonLd || []), article.structuredData]
        : baseHeadState.jsonLd,
      type: "article",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", cacheHeader);
    res.status(200).send(minifyHtml(html));
  } catch (_) {
    sendNotFound(res);
  }
};
