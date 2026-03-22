const { buildStructuredArticle } = require("./contentBuilder");
const { cleanText, countWords } = require("./shared");
const { SITE, buildArticleUrl, slugify } = require("../seo");

const MIN_INDEXABLE_ARTICLE_WORDS = 200;
const DEFAULT_AUTHOR_NAME = "Sunwire News Desk";

function truncateText(text = "", maxLength = 160) {
  const value = cleanText(text);
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 100 ? lastSpace : maxLength).trim()}...`;
}

function buildMetaTitle(headline = "") {
  const value = cleanText(headline || "Story");
  const suffix = " | Sunwire";
  if (!value) return `Sunwire${suffix}`;
  if (value.length <= 62 - suffix.length) return `${value}${suffix}`;
  const clipped = value.slice(0, 62 - suffix.length);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 30 ? lastSpace : clipped.length).trim()}${suffix}`;
}

function normalizeIsoDate(value = "") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeAuthorName(value = "") {
  const cleaned = cleanText(value);
  return cleaned || DEFAULT_AUTHOR_NAME;
}

function buildCanonicalUrl(options = {}) {
  if (cleanText(options.canonicalUrl)) return cleanText(options.canonicalUrl);
  return buildArticleUrl({
    id: options.id || "",
    slug: options.slug || slugify(options.title || "story"),
    title: options.title || "Story",
    category: options.category || "latest",
  });
}

function normalizeArticleBody(value = "") {
  return String(value || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((paragraph) => cleanText(paragraph))
    .filter(Boolean)
    .join("\n\n");
}

function buildNewsArticleStructuredData(input = {}) {
  const headline = cleanText(input.headline || input.title || "Story");
  const description = truncateText(input.description || input.summary || headline, 160);
  const image = cleanText(input.image || SITE.socialImage);
  const canonicalUrl = buildCanonicalUrl(input);
  const publishedAt = normalizeIsoDate(input.datePublished || input.publishedAt || "");
  const modifiedAt = normalizeIsoDate(input.dateModified || input.modifiedAt || publishedAt);
  const authorName = normalizeAuthorName(input.authorName || "");
  const articleBody = normalizeArticleBody(input.articleBody || "");
  const keywords = Array.isArray(input.tags)
    ? input.tags.map((tag) => cleanText(tag)).filter(Boolean).slice(0, 8)
    : [];

  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline,
    description,
    image: image ? [image] : undefined,
    datePublished: publishedAt || undefined,
    dateModified: modifiedAt || publishedAt || undefined,
    author: {
      "@type": "Person",
      name: authorName,
    },
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      logo: {
        "@type": "ImageObject",
        url: SITE.logo,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    url: canonicalUrl,
    articleSection: cleanText(input.articleSection || "Latest") || "Latest",
    keywords: keywords.length ? keywords.join(", ") : undefined,
    wordCount: Number(input.wordCount || countWords(articleBody) || 0) || undefined,
    articleBody: articleBody || undefined,
  };
}

function buildIndexableArticlePayload(options = {}) {
  const title = cleanText(options.title || "Story");
  const source = cleanText(options.source || "Sunwire");
  const sourceUrl = cleanText(options.sourceUrl || "");
  const summary = cleanText(options.summary || "");
  const body = cleanText(options.body || options.content || "");
  const category = cleanText(options.category || "latest").toLowerCase() || "latest";
  const publishedAt = normalizeIsoDate(options.publishedAt || "");
  const modifiedAt = normalizeIsoDate(options.modifiedAt || publishedAt);
  const image = cleanText(options.image || SITE.socialImage) || SITE.socialImage;
  const tags = Array.isArray(options.tags)
    ? options.tags.map((tag) => cleanText(tag).toLowerCase()).filter(Boolean)
    : [];
  const authorName = normalizeAuthorName(options.authorName || options.byline || "");
  const primaryPacket = {
    kind: "primary",
    title,
    summary,
    body,
    source,
    url: sourceUrl,
  };
  const related = Array.isArray(options.related) ? options.related : [];
  const structured = buildStructuredArticle([primaryPacket], title, summary || body, {
    category,
    publishedAt,
    source,
    sourceUrl,
    tags,
    related,
  });
  const canonicalUrl = buildCanonicalUrl({
    id: options.id || "",
    slug: options.slug || "",
    title,
    category,
    canonicalUrl: options.canonicalUrl || "",
  });
  const nextSummary = truncateText(
    options.metaDescription
      || structured.metaDescription
      || structured.summary
      || summary
      || body,
    160
  );
  const sourceBody = normalizeArticleBody(body);
  const structuredBody = normalizeArticleBody(structured.body || "");
  const nextBody = countWords(structuredBody) >= countWords(sourceBody)
    ? (structuredBody || sourceBody)
    : (sourceBody || structuredBody);
  const nextWordCount = Math.max(
    Number(structured.wordCount || 0),
    countWords(nextBody)
  );
  const metaTitle = cleanText(options.metaTitle || buildMetaTitle(title));
  const articleSection = cleanText(options.articleSection || category || "Latest") || "Latest";
  const primarySource = {
    name: cleanText(options.primarySourceName || structured.primarySource?.name || source || "Original Source"),
    url: cleanText(options.primarySourceUrl || structured.primarySource?.url || sourceUrl || ""),
  };
  const structuredData = buildNewsArticleStructuredData({
    title,
    headline: title,
    description: nextSummary,
    image,
    datePublished: publishedAt,
    dateModified: modifiedAt || publishedAt,
    authorName,
    canonicalUrl,
    articleSection,
    tags: structured.tags || tags,
    wordCount: nextWordCount,
    articleBody: nextBody,
  });

  return {
    headline: title,
    summary: structured.summary || summary || nextSummary,
    body: nextBody,
    keyPoints: Array.isArray(structured.keyPoints) ? structured.keyPoints : [],
    deepDive: Array.isArray(structured.deepDive) ? structured.deepDive : [],
    indiaPulse: cleanText(structured.indiaPulse || ""),
    background: Array.isArray(structured.background) ? structured.background : [],
    factSheet: Array.isArray(structured.factSheet) ? structured.factSheet : [],
    tags: Array.isArray(structured.tags) ? structured.tags : tags,
    metaTitle,
    metaDescription: nextSummary,
    seoTitle: metaTitle,
    seoDescription: nextSummary,
    structuredData,
    canonicalUrl,
    primarySource,
    primarySourceName: primarySource.name,
    primarySourceUrl: primarySource.url,
    wordCount: nextWordCount,
    estimatedReadingTime: Math.max(
      3,
      Number(structured.estimatedReadingTime || 0) || Math.ceil(Math.max(nextWordCount, 1) / 200)
    ),
    authorName,
    publishedAt,
    modifiedAt: modifiedAt || publishedAt,
    articleSection,
    isIndexable: nextWordCount >= MIN_INDEXABLE_ARTICLE_WORDS && Boolean(title) && Boolean(image),
  };
}

module.exports = {
  DEFAULT_AUTHOR_NAME,
  MIN_INDEXABLE_ARTICLE_WORDS,
  buildCanonicalUrl,
  buildIndexableArticlePayload,
  buildMetaTitle,
  buildNewsArticleStructuredData,
  normalizeAuthorName,
  truncateText,
};
