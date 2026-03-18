import {
  applyResponsiveImage,
  cleanText,
  decodeHtmlEntities,
  fmtDate,
  isElementNearViewport,
  scheduleIdleTask,
  setMetaContent,
  timeAgo,
  toTitleCase,
} from "./shared/client-utils.mjs";

const dom = {
  articleMeta: document.getElementById("articleMeta"),
  articleTitle: document.getElementById("articleTitle"),
  articleAuthor: document.getElementById("articleAuthor"),
  articleCategory: document.getElementById("articleCategory"),
  articleReadingTime: document.getElementById("articleReadingTime"),
  articleSummary: document.getElementById("articleSummary"),
  articleBody: document.getElementById("articleBody"),
  indiaPulseBody: document.getElementById("indiaPulseBody"),
  backgroundList: document.getElementById("backgroundList"),
  factSheetTable: document.getElementById("factSheetTable"),
  articleTags: document.getElementById("articleTags"),
  primarySourceBlock: document.getElementById("primarySourceBlock"),
  primarySourceLink: document.getElementById("primarySourceLink"),
  articleSource: document.getElementById("articleSource") || document.getElementById("primarySourceLink"),
  articleImage: document.getElementById("articleImage"),
  articleImageCaption: document.getElementById("articleImageCaption"),
  ogImageMeta: document.getElementById("ogImageMeta"),
  twitterImageMeta: document.getElementById("twitterImageMeta"),
  videoSection: document.getElementById("videoSection"),
  articleVideo: document.getElementById("articleVideo"),
  takeawaySection: document.getElementById("takeawaySection"),
  takeawayList: document.getElementById("takeawayList"),
  breadcrumbDesk: document.getElementById("breadcrumbDesk"),
  breadcrumbCurrent: document.getElementById("breadcrumbCurrent"),
  copyLinkButton: document.getElementById("copyLinkButton"),
  nativeShareButton: document.getElementById("nativeShareButton"),
  sidebarTrendingList: document.getElementById("sidebarTrendingList"),
  sidebarLatestList: document.getElementById("sidebarLatestList"),
  sidebarRelatedList: document.getElementById("sidebarRelatedList"),
  relatedGrid: document.getElementById("relatedGrid"),
  articleSidebar: document.querySelector(".article-sidebar"),
  relatedSection: document.querySelector(".related-section"),
};

const ARTICLE_CACHE_PREFIX = "sunwire-article-cache:";
const API_RESPONSE_TTL_MS = 5 * 60 * 1000;
const DEFERRED_ASSET_VERSION = "20260315-2";
const SEO_SITE_NAME = "Sunwire";
const SEO_SITE_ORIGIN = "https://sunwire.in";
const SEO_SOCIAL_IMAGE = `${SEO_SITE_ORIGIN}/social-card.svg`;
const CATEGORY_FALLBACK_IMAGES = {
  ai: "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1400&q=80",
  tech: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1400&q=80",
  entertainment: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1400&q=80",
  sports: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1400&q=80",
  business: "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1400&q=80",
  "startups-funding": "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1400&q=80",
  latest: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1400&q=80",
};
const PLACEHOLDER_PALETTES = [
  { background: "1E3A8A", foreground: "F8FAFC" },
  { background: "7C2D12", foreground: "FFFBEB" },
  { background: "14532D", foreground: "F7FEE7" },
  { background: "581C87", foreground: "FAF5FF" },
  { background: "0F766E", foreground: "F0FDFA" },
  { background: "9A3412", foreground: "FFF7ED" },
  { background: "1F2937", foreground: "F9FAFB" },
  { background: "831843", foreground: "FFF1F2" },
];

const apiResponseCache = new Map();
let relatedModulePromise = null;
let relatedObserver = null;
let relatedHydrationPromise = null;
let pendingRelatedOptions = null;
let appliedArticleScore = -1;

function loadRelatedModule() {
  relatedModulePromise ||= import(`./article-related.mjs?v=${DEFERRED_ASSET_VERSION}`);
  return relatedModulePromise;
}

function isLowValueSummary(text = "") {
  const summary = cleanText(text).toLowerCase();
  if (!summary) return false;

  return [
    "trending in india:",
    "approx search traffic",
    "this matters because",
    "experts believe",
    "it highlights the importance",
    "a practical next step",
    "focus on the signals that matter",
    "watch for follow-through",
  ].some((snippet) => summary.includes(snippet));
}

function sanitizeArticleCopy(text = "", { maxSentences = 3 } = {}) {
  const sentences = cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanText(sentence))
    .filter(Boolean)
    .filter((sentence) => !isLowValueSummary(sentence));

  return sentences.slice(0, maxSentences).join(" ").trim();
}

function sanitizeArticleBody(text = "") {
  const paragraphs = String(text)
    .split(/\n{2,}/)
    .map((paragraph) =>
      cleanText(paragraph)
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => cleanText(sentence))
        .filter(Boolean)
        .filter((sentence) => !isLowValueSummary(sentence))
        .join(" ")
        .trim()
    )
    .filter(Boolean);

  return paragraphs.join("\n\n").trim();
}

function wordCount(text = "") {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function normalizeComparableText(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHeadlineOnlyText(value = "", headline = "") {
  const text = normalizeComparableText(value);
  const title = normalizeComparableText(headline);
  if (!text || !title) return false;
  return text === title || text.startsWith(`${title} `) || title.startsWith(`${text} `);
}

function scoreArticleContent(article = {}, fallback = {}) {
  const headline = cleanText(article.title || fallback.title || "Story");
  const summary = cleanText(article.summary || fallback.summary || "");
  const body = cleanText(article.body || "");
  const keyPoints = Array.isArray(article.keyPoints)
    ? article.keyPoints.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const deepDive = Array.isArray(article.deepDive)
    ? article.deepDive.map((item) => cleanText(item)).filter(Boolean)
    : sanitizeArticleBody(article.body || summary)
      .split(/\n{2,}/)
      .map((item) => cleanText(item))
      .filter(Boolean);
  const background = Array.isArray(article.background) ? article.background : [];
  const factSheet = Array.isArray(article.factSheet) ? article.factSheet : [];

  let score = 0;

  if (summary && !isLowValueSummary(summary) && !isHeadlineOnlyText(summary, headline) && wordCount(summary) >= 10) {
    score += 4;
  }

  if (body && !isLowValueSummary(body) && !isHeadlineOnlyText(body, headline)) {
    score += Math.min(12, Math.floor(wordCount(body) / 40));
  }

  score += keyPoints
    .filter((item) => !isLowValueSummary(item) && !isHeadlineOnlyText(item, headline))
    .length * 5;
  score += deepDive
    .filter((item) => !isLowValueSummary(item) && !isHeadlineOnlyText(item, headline))
    .length * 4;
  score += background.length * 2;
  score += factSheet.length;

  return score;
}

function normalizeDeskFilter(value = "") {
  return String(value || "latest").toLowerCase() === "business"
    ? "startups-funding"
    : String(value || "latest").toLowerCase();
}

function displayDeskLabel(value = "") {
  const deskFilter = normalizeDeskFilter(value);
  if (deskFilter === "startups-funding") return "Startups & Funding";
  if (deskFilter === "war-conflict") return "War & Conflict";
  return toTitleCase(deskFilter || "latest");
}

function storyKey(story = {}) {
  return String(story.id || story.sourceUrl || story.url || story.title || "").trim();
}

function dedupeStories(stories = []) {
  const seen = new Set();
  return stories.filter((story) => {
    const key = storyKey(story);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildFallbackImage(story = {}, category = "latest") {
  const paletteSeed = [
    story.title,
    story.summary,
    story.source,
    story.sourceUrl,
    story.url,
    story.category || category,
  ].filter(Boolean).join("|");
  const palette = PLACEHOLDER_PALETTES[
    Array.from(paletteSeed).reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 7)
    % PLACEHOLDER_PALETTES.length
  ];
  const categoryLabel = cleanText(String(story.category || category || "latest").replace(/[-_]+/g, " ")).toUpperCase();
  const title = cleanText(story.title || "Sunwire story");
  const compactTitle = title.length > 54 ? `${title.slice(0, 51).trim()}...` : title;
  const source = cleanText(story.source || "Sunwire").slice(0, 28);
  const text = [categoryLabel, compactTitle, source].join(" | ");

  return `https://placehold.co/1200x675/${palette.background}/${palette.foreground}?text=${encodeURIComponent(text)}`;
}

function storyImage(story = {}, category = "latest") {
  const imageUrl = decodeHtmlEntities(String(story.image || story.image_url || story.image_storage_url || "").trim());
  if (/^https?:\/\//i.test(imageUrl) && !/\.svg(\?|$)/i.test(imageUrl)) return imageUrl;
  return buildFallbackImage(story, category);
}

function slugify(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function readPreloadedArticleData() {
  return window.__SUNWIRE_ARTICLE_DATA__ && typeof window.__SUNWIRE_ARTICLE_DATA__ === "object"
    ? window.__SUNWIRE_ARTICLE_DATA__
    : null;
}

function buildCanonicalArticleUrl(params = {}) {
  const storySlug = slugify(params.slug || params.t || params.title || params.id || "story");
  if (!storySlug) return `${SEO_SITE_ORIGIN}/`;
  return `${SEO_SITE_ORIGIN}/article/${encodeURIComponent(storySlug)}`;
}

function buildArticleHref(story = {}) {
  const storySlug = slugify(story.slug || story.title || story.id || "story");
  return storySlug ? `/article/${encodeURIComponent(storySlug)}` : "/";
}

function upsertJsonLdScript(id, payload) {
  if (!payload) return;

  let script = document.getElementById(id);
  if (!script) {
    script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = id;
    document.head.appendChild(script);
  }

  script.textContent = JSON.stringify(payload);
}

function buildSectionUrl(deskFilter = "latest") {
  const routeFilter = deskFilter === "startups-funding" ? "business" : deskFilter;
  return routeFilter === "latest"
    ? `${SEO_SITE_ORIGIN}/`
    : `${SEO_SITE_ORIGIN}/${encodeURIComponent(routeFilter)}`;
}

function setSeo(title, description, image = "", canonicalUrl = window.location.href, articleData = {}) {
  const metaDescription = cleanText(description).slice(0, 150);
  const resolvedCanonicalUrl = canonicalUrl || window.location.href;
  const pageTitle = title || `Story | ${SEO_SITE_NAME}`;
  const ogTitle = articleData.headline || cleanText(pageTitle.replace(/\s+\|\s+Sunwire$/i, ""));

  document.title = pageTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", metaDescription);
  document.querySelector('meta[name="robots"]')?.setAttribute("content", "index, follow");
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", resolvedCanonicalUrl);

  setMetaContent('meta[property="og:title"]', ogTitle || "Story");
  setMetaContent('meta[property="og:description"]', metaDescription);
  setMetaContent('meta[property="og:url"]', resolvedCanonicalUrl);
  setMetaContent('meta[property="og:site_name"]', SEO_SITE_NAME);
  setMetaContent('meta[name="twitter:title"]', pageTitle);
  setMetaContent('meta[name="twitter:description"]', metaDescription);

  if (dom.ogImageMeta) dom.ogImageMeta.setAttribute("content", image || SEO_SOCIAL_IMAGE);
  if (dom.twitterImageMeta) dom.twitterImageMeta.setAttribute("content", image || SEO_SOCIAL_IMAGE);
  if (!articleData.headline) return;

  upsertJsonLdScript("sunwire-breadcrumb-jsonld", {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SEO_SITE_ORIGIN },
      {
        "@type": "ListItem",
        position: 2,
        name: articleData.section || "Latest",
        item: articleData.sectionUrl || `${SEO_SITE_ORIGIN}/`,
      },
      { "@type": "ListItem", position: 3, name: articleData.headline, item: resolvedCanonicalUrl },
    ],
  });

  upsertJsonLdScript("sunwire-article-jsonld", {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: articleData.headline,
    description: metaDescription,
    image: image ? [image] : undefined,
    datePublished: articleData.publishedAt || undefined,
    dateModified: articleData.publishedAt || undefined,
    keywords: Array.isArray(articleData.tags) ? articleData.tags.join(", ") : undefined,
    wordCount: articleData.wordCount || undefined,
    articleBody: articleData.articleBody || undefined,
    author: {
      "@type": "Organization",
      name: SEO_SITE_NAME,
    },
    publisher: {
      "@type": "Organization",
      name: SEO_SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: `${SEO_SITE_ORIGIN}/logo.png`,
      },
    },
    articleSection: articleData.section || "Latest",
    mainEntityOfPage: resolvedCanonicalUrl,
    url: resolvedCanonicalUrl,
  });
}

function renderBulletList(listElement, items = [], fallbackText = "") {
  listElement.innerHTML = "";
  (items.length ? items : [fallbackText]).forEach((item) => {
    const listItem = document.createElement("li");
    listItem.textContent = cleanText(item);
    listElement.appendChild(listItem);
  });
}

function renderTagChips(tags = []) {
  if (!dom.articleTags) return;
  dom.articleTags.innerHTML = "";
  (Array.isArray(tags) ? tags : []).forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = cleanText(String(tag || "").replace(/[-_]+/g, " "));
    dom.articleTags.appendChild(chip);
  });
}

function renderParagraphs(container, paragraphs = [], fallbackText = "") {
  if (!container) return;
  container.innerHTML = "";
  const items = Array.isArray(paragraphs) && paragraphs.length ? paragraphs : [fallbackText];
  items.forEach((paragraph) => {
    const block = document.createElement("p");
    block.textContent = cleanText(paragraph);
    container.appendChild(block);
  });
}

function renderBackgroundItems(items = []) {
  if (!dom.backgroundList) return;
  dom.backgroundList.innerHTML = "";
  const entries = Array.isArray(items) && items.length
    ? items
    : [{ title: "Context update", context: "Related past events are still being assembled for this story." }];

  entries.forEach((item) => {
    const article = document.createElement("article");
    article.className = "background-item";

    if (item.url) {
      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const heading = document.createElement("h3");
      heading.textContent = cleanText(item.title || "Background");
      link.appendChild(heading);
      article.appendChild(link);
    } else {
      const heading = document.createElement("h3");
      heading.textContent = cleanText(item.title || "Background");
      article.appendChild(heading);
    }

    const copy = document.createElement("p");
    copy.textContent = cleanText(item.context || "");
    article.appendChild(copy);

    if (item.source) {
      const source = document.createElement("div");
      source.className = "background-item__source";
      source.textContent = cleanText(item.source);
      article.appendChild(source);
    }

    dom.backgroundList.appendChild(article);
  });
}

function renderFactSheet(rows = []) {
  if (!dom.factSheetTable) return;
  dom.factSheetTable.innerHTML = "";
  const body = document.createElement("tbody");
  const items = Array.isArray(rows) && rows.length
    ? rows
    : [{ label: "Status", value: "Verified data points are still loading." }];

  items.forEach((row) => {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = cleanText(row.label || "");
    const td = document.createElement("td");
    td.textContent = cleanText(row.value || "");
    tr.appendChild(th);
    tr.appendChild(td);
    body.appendChild(tr);
  });

  dom.factSheetTable.appendChild(body);
}

function buildInitialBody(title = "", summary = "", source = "") {
  const cleanedSummary = sanitizeArticleCopy(summary, { maxSentences: 3 });

  return cleanedSummary;
}

function storyCacheKey(url = "", title = "") {
  return `${ARTICLE_CACHE_PREFIX}${cleanText(url)}|${cleanText(title)}`;
}

function readCachedArticle(url = "", title = "") {
  try {
    const cachedValue = window.sessionStorage.getItem(storyCacheKey(url, title));
    return cachedValue ? JSON.parse(cachedValue) : null;
  } catch (_) {
    return null;
  }
}

function writeCachedArticle(url = "", title = "", article = null) {
  if (!article) return;

  try {
    window.sessionStorage.setItem(storyCacheKey(url, title), JSON.stringify(article));
  } catch (_) {
    // Ignore storage failures.
  }
}

function applyArticleData(article = {}, fallback = {}) {
  const nextScore = scoreArticleContent(article, fallback);
  if (nextScore < appliedArticleScore) return false;

  const deskFilter = normalizeDeskFilter(fallback.category || "latest");
  const headline = cleanText(article.title || fallback.title || "Story");
  const summary = sanitizeArticleCopy(
    article.summary || fallback.summary || fallback.subheadline || fallback.content || "",
    { maxSentences: 3 }
  );
  const fallbackBody = cleanText(fallback.body || fallback.content || "");
  const articleBody = cleanText(article.body || "");
  const preferredBody = wordCount(articleBody) >= wordCount(fallbackBody)
    ? (article.body || fallback.body || fallback.content || "")
    : (fallback.body || fallback.content || article.body || "");
  const deepDive = Array.isArray(article.deepDive) && article.deepDive.length
    ? article.deepDive.map((entry) => cleanText(entry)).filter(Boolean)
    : sanitizeArticleBody(preferredBody || summary).split(/\n{2,}/).map((entry) => cleanText(entry)).filter(Boolean);
  const publishedAt = article.published_at || article.publishedAt || fallback.publishedAt || "";
  const sourceName = article.source || fallback.source || "SunWire Desk";
  const sourceUrl = article.primarySource?.url || article.sourceUrl || fallback.url || "";
  const imageUrl = storyImage({ image: article.image || fallback.image || "" }, deskFilter);
  const readingTime = Number(article.estimatedReadingTime || 0) > 0 ? `${Number(article.estimatedReadingTime)} min read` : "4 min read";
  const tags = Array.isArray(article.tags) ? article.tags.slice(0, 5) : [];

  dom.articleTitle.textContent = headline;
  dom.breadcrumbCurrent.textContent = headline;
  dom.articleAuthor.textContent = sourceName;
  dom.articleMeta.textContent = publishedAt ? `${fmtDate(publishedAt)} · ${timeAgo(publishedAt)}` : "Live now";
  dom.articleSummary.textContent = summary || "No verified summary available.";
  if (dom.primarySourceBlock) dom.primarySourceBlock.hidden = !sourceUrl;
  if (dom.articleSource) {
    dom.articleSource.href = sourceUrl || "/";
    dom.articleSource.textContent = cleanText(article.primarySource?.name || sourceName || "Original Source");
  }
  dom.articleImageCaption.textContent = `Source: ${sourceName}`;
  if (dom.articleReadingTime) dom.articleReadingTime.textContent = readingTime;

  applyResponsiveImage(dom.articleImage, imageUrl, {
    alt: headline,
    width: 1600,
    height: 900,
    sizes: "(max-width: 960px) 100vw, 66vw",
    highPriority: true,
  });

  renderTagChips(tags);
  renderParagraphs(dom.articleBody, deepDive, "No additional verified details available.");
  renderParagraphs(
    dom.indiaPulseBody,
    article.indiaPulse ? [article.indiaPulse] : [],
    "India-specific pricing, availability, and impact updates are still being verified."
  );
  renderBackgroundItems(article.background || []);
  renderFactSheet(article.factSheet || []);

  const takeaways = Array.isArray(article.practicalTakeaways) ? article.practicalTakeaways : [];
  dom.takeawaySection.hidden = !takeaways.length;
  if (takeaways.length) {
    renderBulletList(dom.takeawayList, takeaways);
  }

  dom.videoSection.hidden = !article.youtubeEmbedUrl;
  dom.articleVideo.src = article.youtubeEmbedUrl || "";

  setSeo(
    article.seoTitle || `${headline} | SunWire`,
    article.seoDescription || summary,
    imageUrl,
    fallback.canonicalUrl || window.location.href,
    {
      headline,
      author: sourceName,
      publishedAt,
      section: displayDeskLabel(deskFilter),
      sectionUrl: buildSectionUrl(deskFilter),
      tags,
      wordCount: Number(article.wordCount || 0),
      articleBody: [summary, ...deepDive, article.indiaPulse || ""].join(" "),
    }
  );

  appliedArticleScore = nextScore;
  return true;
}

async function fetchJson(url, { forceFresh = false, ttlMs = API_RESPONSE_TTL_MS } = {}) {
  const cachedEntry = forceFresh ? null : apiResponseCache.get(url);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.promise;
  }

  const requestUrl = forceFresh
    ? `${url}${url.includes("?") ? "&" : "?"}_ts=${Date.now()}`
    : url;
  const request = fetch(requestUrl, { cache: forceFresh ? "no-store" : "default" })
    .then((response) => {
      if (!response.ok) throw new Error(`Fetch failed: ${url}`);
      return response.json();
    })
    .catch((error) => {
      apiResponseCache.delete(url);
      throw error;
    });

  if (!forceFresh && ttlMs > 0) {
    apiResponseCache.set(url, {
      expiresAt: Date.now() + ttlMs,
      promise: request,
    });
  }

  return request;
}

async function hydrateRelatedContent() {
  if (!pendingRelatedOptions) return;
  if (relatedHydrationPromise) return relatedHydrationPromise;

  relatedHydrationPromise = loadRelatedModule()
    .then((relatedModule) => relatedModule.loadRelatedStories({
      ...pendingRelatedOptions,
      fetchJson,
      containers: {
        sidebarTrendingList: dom.sidebarTrendingList,
        sidebarLatestList: dom.sidebarLatestList,
        sidebarRelatedList: dom.sidebarRelatedList,
        relatedGrid: dom.relatedGrid,
      },
      helpers: {
        cleanText,
        normalizeDeskFilter,
        displayDeskLabel,
        dedupeStories,
        storyKey,
        buildArticleHref,
        storyImage,
        applyResponsiveImage,
        timeAgo,
        normalizeTag: (value = "") => cleanText(String(value || "").toLowerCase()),
      },
    }))
    .finally(() => {
      relatedHydrationPromise = null;
    });

  return relatedHydrationPromise;
}

function scheduleRelatedContentLoad(options = {}) {
  pendingRelatedOptions = options;

  if (
    isElementNearViewport(dom.articleSidebar, 240)
    || isElementNearViewport(dom.relatedSection, 240)
  ) {
    void hydrateRelatedContent();
    return;
  }

  if (!relatedObserver) {
    relatedObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      void hydrateRelatedContent();
      relatedObserver.disconnect();
      relatedObserver = null;
    }, { rootMargin: "240px 0px" });
  }

  relatedObserver.disconnect();
  if (dom.articleSidebar) relatedObserver.observe(dom.articleSidebar);
  if (dom.relatedSection) relatedObserver.observe(dom.relatedSection);
}

function resetCopyButtonLabel(label) {
  dom.copyLinkButton.textContent = label;
  window.setTimeout(() => {
    dom.copyLinkButton.textContent = "Copy Link";
  }, 1600);
}

async function copyCurrentLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    resetCopyButtonLabel("Copied");
  } catch (_) {
    resetCopyButtonLabel("Copy failed");
  }
}

function attachNativeShare(title, text) {
  if (!navigator.share) {
    dom.nativeShareButton.hidden = true;
    return;
  }

  dom.nativeShareButton.addEventListener("click", async () => {
    try {
      await navigator.share({ title, text, url: window.location.href });
    } catch (_) {
      // Ignore cancelled shares.
    }
  }, { once: true });
}

function readStoryParams() {
  const pathMatch = window.location.pathname.match(/^\/article\/([^/]+)$/i)
    || window.location.pathname.match(/^\/(?:ai|tech|entertainment|sports|business|latest)\/([^/]+)$/i);
  const pathSlug = pathMatch ? decodeURIComponent(pathMatch[1] || "") : "";
  const preloaded = readPreloadedArticleData();
  if (preloaded?.story) {
    return {
      id: preloaded.story.id || "",
      slug: preloaded.story.slug || "",
      url: preloaded.story.sourceUrl || preloaded.story.url || "",
      title: preloaded.story.title || "Story",
      source: preloaded.story.source || "SunWire Desk",
      category: String(preloaded.story.category || "latest").toLowerCase(),
      isDatabaseArticle: preloaded.story.isDatabaseArticle === true,
      publishedAt: preloaded.story.source_published_at || preloaded.story.published_at || preloaded.story.publishedAt || "",
      summary: preloaded.story.summary || "",
      subheadline: preloaded.story.subheadline || "",
      image: preloaded.story.image || "",
      content: preloaded.story.content || "",
      body: preloaded.story.body || preloaded.story.content || "",
      canonicalUrl: buildCanonicalArticleUrl({
        id: preloaded.story.id || "",
        slug: preloaded.story.slug || "",
        t: preloaded.story.title || "Story",
        c: preloaded.story.category || "latest",
      }),
    };
  }

  const params = new URLSearchParams(window.location.search);
  const title = decodeHtmlEntities(params.get("t") || "Story");
  const source = decodeHtmlEntities(params.get("s") || "SunWire Desk");
  const category = String(params.get("c") || "latest").toLowerCase();
  const publishedAt = params.get("p") || "";
  const summary = decodeHtmlEntities(params.get("m") || "");
  const image = decodeHtmlEntities(params.get("i") || "");

  return {
    id: params.get("id") || "",
    slug: params.get("slug") || pathSlug,
    url: params.get("u") || "",
    title,
    source,
    category,
    isDatabaseArticle: false,
    publishedAt,
    summary,
    subheadline: "",
    image,
    content: "",
    body: "",
    canonicalUrl: buildCanonicalArticleUrl({
      id: params.get("id") || "",
      slug: params.get("slug") || "",
      u: params.get("u") || "",
      t: title,
      s: source,
      c: category,
      p: publishedAt,
      m: summary,
      i: image,
    }),
  };
}

function renderInitialStoryState(story) {
  appliedArticleScore = -1;
  const deskFilter = normalizeDeskFilter(story.category);
  const deskLabel = displayDeskLabel(story.category);
  const imageUrl = storyImage({ image: story.image }, deskFilter);
  const initialSummary = sanitizeArticleCopy(story.summary, { maxSentences: 2 }) || "Loading verified details...";

  dom.breadcrumbDesk.textContent = deskLabel;
  dom.breadcrumbDesk.href = buildSectionUrl(deskFilter).replace(SEO_SITE_ORIGIN, "");
  dom.breadcrumbCurrent.textContent = cleanText(story.title);
  dom.articleCategory.textContent = deskLabel;
  dom.articleTitle.textContent = cleanText(story.title);
  dom.articleAuthor.textContent = story.source || "SunWire Desk";
  dom.articleMeta.textContent = story.publishedAt ? `${fmtDate(story.publishedAt)} · ${timeAgo(story.publishedAt)}` : "Live now";
  dom.articleSummary.textContent = initialSummary;
  if (dom.primarySourceBlock) dom.primarySourceBlock.hidden = !story.url;
  if (dom.articleSource) {
    dom.articleSource.href = story.url || "/";
    dom.articleSource.textContent = cleanText(story.source || "Original Source");
  }
  dom.articleImageCaption.textContent = `Featured visual for ${deskLabel}.`;
  if (dom.articleReadingTime) dom.articleReadingTime.textContent = "4 min read";

  applyResponsiveImage(dom.articleImage, imageUrl, {
    alt: cleanText(story.title || "Story image"),
    width: 1600,
    height: 900,
    sizes: "(max-width: 960px) 100vw, 66vw",
    highPriority: true,
  });

  setSeo(
    `${cleanText(story.title)} | SunWire`,
    sanitizeArticleCopy(story.summary, { maxSentences: 2 }) || "Read the full story on SunWire.",
    imageUrl,
    story.canonicalUrl,
    {
      headline: cleanText(story.title),
      author: "SunWire",
      publishedAt: story.publishedAt || "",
      section: deskLabel,
      sectionUrl: buildSectionUrl(deskFilter),
      articleBody: initialSummary,
    }
  );

  renderTagChips([]);
  renderParagraphs(dom.articleBody, [buildInitialBody(story.title, story.summary, story.source)], "Fetching full story...");
  renderParagraphs(dom.indiaPulseBody, [], "Checking India-specific details...");
  renderBackgroundItems([]);
  renderFactSheet([]);
  dom.takeawaySection.hidden = true;
  dom.videoSection.hidden = true;

  attachNativeShare(
    cleanText(story.title),
    sanitizeArticleCopy(story.summary, { maxSentences: 2 }) || "Read the full story on SunWire."
  );

  appliedArticleScore = scoreArticleContent({
    title: story.title,
    summary: story.summary,
  }, story);
}

async function loadStory() {
  appliedArticleScore = -1;
  const story = readStoryParams();
  const deskFilter = normalizeDeskFilter(story.category);
  const fallbackArticle = {
    ...story,
    category: deskFilter,
  };
  const preloadedArticle = readPreloadedArticleData()?.article;
  const hasPreloadedArticle = Boolean(
    preloadedArticle?.summary || preloadedArticle?.body || preloadedArticle?.keyPoints?.length
  );

  if (hasPreloadedArticle) {
    applyArticleData(preloadedArticle, fallbackArticle);
  } else {
    renderInitialStoryState(story);
  }

  if (!story.url && !story.slug) {
    renderParagraphs(dom.articleBody, [], "No additional verified details available.");
    renderParagraphs(dom.indiaPulseBody, [], "India-specific pricing, availability, and impact updates are still being verified.");
    renderBackgroundItems([]);
    renderFactSheet([]);
    scheduleRelatedContentLoad({ category: deskFilter, currentUrl: "", currentTitle: story.title, currentTags: [] });
    return;
  }

  const cachedArticle = readCachedArticle(story.url, story.title);
  if (cachedArticle?.summary || cachedArticle?.body || cachedArticle?.keyPoints?.length) {
    applyArticleData(cachedArticle, fallbackArticle);
  }

  scheduleRelatedContentLoad({
    category: deskFilter,
    currentUrl: story.url,
    currentTitle: story.title,
    currentTags: Array.isArray(cachedArticle?.tags)
      ? cachedArticle.tags
      : Array.isArray(preloadedArticle?.tags) ? preloadedArticle.tags : [],
  });

  try {
    const articleSlug = slugify(story.slug || story.title || story.id || "");
    const article = articleSlug
      ? await fetchJson(`/api/article?${new URLSearchParams({
        slug: articleSlug,
        category: deskFilter,
        id: story.id || "",
      }).toString()}`, { ttlMs: 15 * 60 * 1000 })
      : await fetchJson(`/api/article?${new URLSearchParams({
        id: story.id,
        url: story.url,
        title: story.title,
        source: story.source,
        published_at: story.publishedAt,
        publishedAt: story.publishedAt,
        summary: story.summary,
        image: story.image,
        category: deskFilter,
      }).toString()}`, { ttlMs: 15 * 60 * 1000 });
    const didApplyArticle = applyArticleData(article, fallbackArticle);
    scheduleRelatedContentLoad({
      category: deskFilter,
      currentUrl: story.url,
      currentTitle: story.title,
      currentTags: Array.isArray(article.tags) ? article.tags : [],
    });
    if (didApplyArticle) {
      writeCachedArticle(story.url, story.title, article);
    }
  } catch (_) {
    if (cachedArticle) return;
    renderParagraphs(dom.articleBody, [], "No additional verified details available.");
  }
}

dom.copyLinkButton.addEventListener("click", copyCurrentLink);
window.addEventListener("load", () => {
  scheduleIdleTask(() => {
    void loadRelatedModule();
  });
}, { once: true });

loadStory();
