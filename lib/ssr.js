const {
  SITE,
  FILTER_METADATA,
  cleanText,
  escapeHtml,
  normalizeFilter,
  normalizePageNumber,
  buildSectionPath,
  slugify,
} = require("./seo");
const {
  buildStoryTags,
  composeEmbeddingText,
  cosineSimilarity,
  createTextEmbedding,
} = require("./article/shared");

function safeJsonForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/-->/g, "--\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function toTitleCase(value = "") {
  const input = String(value || "").trim();
  if (input.toLowerCase() === "ai") return "AI";
  return input
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateLabel(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Live now";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function storyTimestamp(story = {}) {
  return story.source_published_at || story.published_at || story.publishedAt || story.injected_at || "";
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

function normalizeComparableStoryText(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRedditStory(story = {}) {
  const haystack = normalizeComparableStoryText([
    story.source,
    story.sourceUrl,
    story.url,
  ].filter(Boolean).join(" "));
  return haystack.includes("reddit") || haystack.includes("r sports") || haystack.includes("r technology");
}

function hasRenderableStoryCopy(story = {}) {
  const headline = normalizeComparableStoryText(story.title || "");
  const copy = normalizeComparableStoryText(
    story.content || story.body || story.summary || story.subheadline || ""
  );
  if (!headline || !copy || copy.length < 40) return false;
  if (copy === headline) return false;
  return !copy.startsWith(`${headline} source`);
}

function isDisplayableStory(story = {}) {
  return Boolean(cleanText(story.slug || story.title || story.id || ""))
    && !isRedditStory(story)
    && hasRenderableStoryCopy(story);
}

function filterDisplayableStories(stories = []) {
  return dedupeStories(stories).filter(isDisplayableStory);
}

function storyImage(story = {}) {
  const candidate = String(story.image || story.image_url || "").trim();
  if (/^https?:\/\//i.test(candidate) && !/\.svg(\?|$)/i.test(candidate)) {
    return candidate;
  }
  return SITE.socialImage;
}

function storyDeskLabel(story = {}) {
  const normalized = normalizeFilter(story.category || "all");
  return FILTER_METADATA[normalized]?.label || toTitleCase(normalized);
}

function trimSummary(text = "", maxLength = 160) {
  const summary = cleanText(text);
  if (summary.length <= maxLength) return summary;
  const clipped = summary.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 80 ? lastSpace : maxLength).trim()}...`;
}

function storySlug(story = {}) {
  return slugify(story.slug || story.title || story.id || "story");
}

function buildStoryHref(story = {}) {
  const slug = storySlug(story);
  return slug ? `/article/${slug}` : "/";
}

function renderNewsCard(story = {}, variant = "standard") {
  const href = buildStoryHref(story);
  const image = storyImage(story);
  const imageAlt = cleanText(story.title || "SunWire story");
  const summary = trimSummary(
    story.summary || story.subheadline || story.content || "",
    variant === "compact" ? 110 : 150
  );

  return [
    `<article class="news-card news-card--${escapeHtml(variant)}">`,
    `<a class="news-card__media" href="${escapeHtml(href)}" target="_self" rel="noopener noreferrer">`,
    `<img class="news-card__image" src="${escapeHtml(image)}" alt="${escapeHtml(imageAlt)}" loading="lazy" decoding="async" width="1600" height="${variant === "standard" ? "1000" : "900"}" />`,
    `<span class="news-card__tag">${escapeHtml(storyDeskLabel(story))}</span>`,
    "</a>",
    '<div class="news-card__body">',
    `<a class="news-card__headlineLink" href="${escapeHtml(href)}" target="_self" rel="noopener noreferrer">`,
    `<h3 class="news-card__headline">${escapeHtml(cleanText(story.title || "Story"))}</h3>`,
    "</a>",
    `<p class="news-card__summary">${escapeHtml(summary || "Read the full story on SunWire.")}</p>`,
    '<div class="news-card__meta">',
    `<span class="news-card__time">${escapeHtml(formatDateLabel(storyTimestamp(story)))}</span>`,
    `<span class="news-card__source">${escapeHtml(cleanText(story.source || "SunWire"))}</span>`,
    "</div>",
    "</div>",
    "</article>",
  ].join("");
}

function renderDeskPanel(section = {}, defaultVariant = "dense") {
  const stories = Array.isArray(section.stories) ? section.stories : [];
  const actionHref = section.filter ? buildSectionPath(section.filter, 1) : "";
  const title = cleanText(section.title || "Stories");

  return [
    '<section class="desk-panel">',
    '<div class="desk-panel__head">',
    "<div>",
    `<p class="desk-panel__eyebrow">${escapeHtml(cleanText(section.eyebrow || "Coverage"))}</p>`,
    actionHref
      ? `<h3 class="desk-panel__title"><a class="desk-panel__title--interactive" href="${escapeHtml(actionHref)}">${escapeHtml(title)}</a></h3>`
      : `<h3 class="desk-panel__title">${escapeHtml(title)}</h3>`,
    "</div>",
    actionHref
      ? `<a class="desk-panel__action" href="${escapeHtml(actionHref)}">Open</a>`
      : '<button class="desk-panel__action" type="button" hidden>Open</button>',
    "</div>",
    `<div class="desk-panel__grid${section.layout === "rail" ? " desk-panel__grid--rail" : ""}${section.layout === "catalog" ? " desk-panel__grid--catalog" : ""}">`,
    stories.map((story) => renderNewsCard(story, section.cardVariant || defaultVariant)).join(""),
    "</div>",
    "</section>",
  ].join("");
}

function selectUniqueStories(stories = [], count = 4, used = new Set(), predicate = null) {
  const output = [];
  for (const story of stories) {
    const key = storyKey(story);
    if (!key || used.has(key)) continue;
    if (typeof predicate === "function" && !predicate(story)) continue;
    used.add(key);
    output.push(story);
    if (output.length >= count) break;
  }
  return output;
}

function buildCategoryMap(allStories = []) {
  const categories = ["ai", "tech", "entertainment", "sports", "business"];
  return categories.reduce((acc, category) => {
    acc[category] = dedupeStories(allStories.filter((story) => normalizeFilter(story.category || "all") === category));
    return acc;
  }, {});
}

function fillSectionStories(preferredStories = [], fallbackStories = [], count = 5, used = new Set()) {
  const selected = [];

  for (const story of preferredStories) {
    const key = storyKey(story);
    if (!key || used.has(key)) continue;
    used.add(key);
    selected.push(story);
    if (selected.length >= count) return selected;
  }

  for (const story of fallbackStories) {
    const key = storyKey(story);
    if (!key || used.has(key)) continue;
    used.add(key);
    selected.push(story);
    if (selected.length >= count) return selected;
  }

  return selected;
}

function buildHomeView({
  filter = "all",
  page = 1,
  totalPages = 1,
  totalStories = 0,
  pageStories = [],
  allStories = [],
}) {
  const safeFilter = normalizeFilter(filter);
  const safePage = normalizePageNumber(page);
  const filteredPageStories = filterDisplayableStories(pageStories);
  const storyPool = filterDisplayableStories(allStories);
  const categoryMap = buildCategoryMap(storyPool);
  const hero = filteredPageStories[0] || storyPool[0] || null;
  const used = new Set(hero ? [storyKey(hero)] : []);
  const trending = selectUniqueStories(filteredPageStories.slice(1), 4, used);
  const latestRemainder = filteredPageStories.slice(5);
  const relatedDesks = ["ai", "tech", "entertainment", "sports", "business"].filter((entry) => entry !== safeFilter);
  const metadata = FILTER_METADATA[safeFilter] || FILTER_METADATA.all;

  let topSections = [];
  let moreSections = [];

  if (safeFilter === "all") {
    topSections = [
      {
        eyebrow: "AI Desk",
        title: "AI",
        filter: "ai",
        layout: "rail",
        cardVariant: "compact",
        stories: fillSectionStories(categoryMap.ai, latestRemainder, 5, used),
      },
      {
        eyebrow: "Tech Desk",
        title: "Tech",
        filter: "tech",
        layout: "rail",
        cardVariant: "compact",
        stories: fillSectionStories(categoryMap.tech, latestRemainder, 5, used),
      },
    ];
    moreSections = [
      {
        eyebrow: "Entertainment Desk",
        title: "Entertainment",
        filter: "entertainment",
        stories: fillSectionStories(categoryMap.entertainment, latestRemainder, 5, used),
      },
      {
        eyebrow: "Sports Desk",
        title: "Sports",
        filter: "sports",
        stories: fillSectionStories(categoryMap.sports, latestRemainder, 5, used),
      },
      {
        eyebrow: "Business Desk",
        title: "Business",
        filter: "business",
        stories: fillSectionStories(categoryMap.business, latestRemainder, 5, used),
      },
    ];
  } else {
    const deskStories = filteredPageStories.slice(5);
    topSections = [
      {
        eyebrow: `${metadata.label} Desk`,
        title: `${metadata.label} Coverage`,
        filter: safeFilter,
        layout: "catalog",
        cardVariant: "dense",
        stories: deskStories.slice(0, 20),
      },
    ];
    moreSections = [];
  }

  return {
    hero,
    trending,
    topSections: topSections.filter((section) => Array.isArray(section.stories) && section.stories.length),
    moreSections: moreSections.filter((section) => Array.isArray(section.stories) && section.stories.length),
    categoryMap,
    pageStories: filteredPageStories,
    totalPages,
    totalStories,
    page: safePage,
    filter: safeFilter,
  };
}

function renderPagination(filter = "all", page = 1, totalPages = 1, totalStories = 0) {
  if (totalPages <= 1) return "";
  const safeFilter = normalizeFilter(filter);
  const safePage = normalizePageNumber(page);
  const pages = [];

  const start = Math.max(1, safePage - 1);
  const end = Math.min(totalPages, start + 3);
  const pageStart = Math.max(1, end - 3);

  const link = (label, targetPage, className = "", disabled = false) => {
    if (disabled) {
      return `<span class="page-btn is-disabled${className ? ` ${className}` : ""}">${escapeHtml(label)}</span>`;
    }
    return `<a class="page-btn${className ? ` ${className}` : ""}" href="${escapeHtml(buildSectionPath(safeFilter, targetPage))}">${escapeHtml(label)}</a>`;
  };

  pages.push(link("Previous", Math.max(1, safePage - 1), " page-btn--nav", safePage === 1));
  for (let current = pageStart; current <= end; current += 1) {
    pages.push(link(String(current), current, current === safePage ? " is-active" : ""));
  }
  pages.push(link("Next", Math.min(totalPages, safePage + 1), " page-btn--nav", safePage === totalPages));

  return [
    `<div class="pagination-status" id="paginationStatus">Page ${safePage} of ${totalPages}</div>`,
    `<div class="pagination" id="pagination">${pages.join("")}</div>`,
    `<div class="pagination-status pagination-status--secondary" id="paginationStatusSecondary">${totalStories} indexed stories</div>`,
  ].join("");
}

function replaceBlock(html = "", selector = "", replacement = "") {
  return String(html || "").replace(selector, replacement);
}

function renderHomeTemplate(template = "", view = {}) {
  const hero = view.hero;
  const heroHref = hero ? buildStoryHref(hero) : "/";
  const heroImage = hero ? storyImage(hero) : SITE.socialImage;
  const heroTitle = cleanText(hero?.title || "Loading headline...");
  const heroSummary = trimSummary(hero?.summary || SITE.defaultDescription, 170);
  const heroAuthor = cleanText(hero?.source || "SunWire Desk");
  const heroMeta = hero ? formatDateLabel(storyTimestamp(hero)) : "Waiting for fresh stories.";
  const tickerStories = dedupeStories([hero, ...(view.trending || []), ...(view.moreSections || []).flatMap((section) => section.stories || [])].filter(Boolean));
  const tickerText = tickerStories.length
    ? tickerStories.slice(0, 8).map((story) => cleanText(story.title || "")).join(" • ")
    : "Fresh stories are loading on SunWire.";
  const categoryHeading = view.filter === "all"
    ? "Category News Grid"
    : `${FILTER_METADATA[view.filter]?.label || toTitleCase(view.filter)} Desk`;
  const moreHeadingMeta = view.hero
    ? `${FILTER_METADATA[view.filter]?.label || "Latest"} updated ${formatDateLabel(storyTimestamp(view.hero))}`
    : "Scanning the live wire";

  let output = String(template || "");
  output = replaceBlock(
    output,
    /<section class="hero-section" id="heroSection" aria-live="polite">[\s\S]*?<\/section>/,
    [
      '<section class="hero-section" id="heroSection" aria-live="polite">',
      '<div class="hero-section__copy">',
      `<span class="hero-section__kicker" id="heroDeskChip">${escapeHtml(view.hero ? storyDeskLabel(view.hero) : "Live Desk")}</span>`,
      '<h1 class="hero-section__title">',
      `<a id="headlineOfTheDayLink" href="${escapeHtml(heroHref)}" target="_self" rel="noopener noreferrer">${escapeHtml(heroTitle)}</a>`,
      "</h1>",
      `<p class="hero-section__summary" id="heroSummary">${escapeHtml(heroSummary)}</p>`,
      '<div class="hero-section__meta">',
      '<span class="hero-badge">Breaking</span>',
      `<span class="hero-section__author" id="heroAuthor">${escapeHtml(heroAuthor)}</span>`,
      `<span class="hero-section__time" id="headlineOfTheDayMeta">${escapeHtml(heroMeta)}</span>`,
      "</div>",
      "</div>",
      '<div class="hero-section__media">',
      `<img id="heroImage" src="${escapeHtml(heroImage)}" alt="${escapeHtml(heroTitle)}" loading="eager" decoding="async" fetchpriority="high" width="1600" height="900" />`,
      "</div>",
      "</section>",
    ].join(""),
  );
  output = output.replace(
    /<div class="breaking-ticker__track" id="tickerTrack">[\s\S]*?<\/div>/,
    `<div class="breaking-ticker__track" id="tickerTrack">${escapeHtml(tickerText)}</div>`,
  );
  output = output.replace(
    /<div class="trending-strip__cards" id="trendingGrid" aria-live="polite">[\s\S]*?<\/div>/,
    `<div class="trending-strip__cards" id="trendingGrid" aria-live="polite">${(view.trending || []).map((story) => renderNewsCard(story, "compact")).join("")}</div>`,
  );
  output = output.replace(
    /<span class="section-head__meta" id="trendingUpdatedAt">[\s\S]*?<\/span>/,
    `<span class="section-head__meta" id="trendingUpdatedAt">${escapeHtml(view.hero ? `Updated ${formatDateLabel(storyTimestamp(view.hero))}` : "Updated just now")}</span>`,
  );
  output = output.replace(
    /<h2 class="section-title" id="categoryNewsTitle">[\s\S]*?<\/h2>/,
    `<h2 class="section-title" id="categoryNewsTitle">${escapeHtml(categoryHeading)}</h2>`,
  );
  output = output.replace(
    /<span class="desk-chip" id="activeDeskChip">[\s\S]*?<\/span>/,
    `<span class="desk-chip" id="activeDeskChip">${escapeHtml(FILTER_METADATA[view.filter]?.label || "All")}</span>`,
  );
  output = output.replace(
    /<div class="desk-panels desk-panels--top" id="categorySectionsGrid" aria-live="polite">[\s\S]*?<\/div>/,
    `<div class="desk-panels desk-panels--top${view.filter === "all" ? "" : " desk-panels--focused"}" id="categorySectionsGrid" aria-live="polite">${(view.topSections || []).map((section) => renderDeskPanel(section, "dense")).join("")}</div>`,
  );
  output = output.replace(
    /<span class="section-head__meta" id="livePulseText">[\s\S]*?<\/span>/,
    `<span class="section-head__meta" id="livePulseText">${escapeHtml(moreHeadingMeta)}</span>`,
  );
  output = output.replace(
    /<div class="desk-panels desk-panels--expanded" id="moreNewsGrid" aria-live="polite">[\s\S]*?<\/div>/,
    `<div class="desk-panels desk-panels--expanded" id="moreNewsGrid" aria-live="polite">${(view.moreSections || []).map((section) => renderDeskPanel(section, "dense")).join("")}</div>`,
  );
  output = output.replace(
    /<nav class="shell pagination-shell" aria-label="Pagination" hidden>[\s\S]*?<\/nav>/,
    view.totalPages > 1
      ? `<nav class="shell pagination-shell" aria-label="Pagination">${renderPagination(view.filter, view.page, view.totalPages, view.totalStories)}</nav>`
      : '<nav class="shell pagination-shell" aria-label="Pagination" hidden><div class="pagination-status" id="paginationStatus">Page 1 of 1</div><div class="pagination" id="pagination"></div><div class="pagination-status pagination-status--secondary" id="paginationStatusSecondary"></div></nav>',
  );

  const preloadPayload = {
    filter: view.filter,
    page: view.page,
    totalPages: view.totalPages,
    totalStories: view.totalStories,
    pageStories: view.pageStories || [],
    mainStories: view.pageStories || [],
    categoryMap: view.categoryMap || {},
  };

  return output.replace(
    /<script type="module" src="\/?app\.js\?v=[^"]+"><\/script>/,
    `<script>window.__SUNWIRE_HOME_DATA__=${safeJsonForInlineScript(preloadPayload)};</script><script type="module" src="/app.js?v=20260315-5"></script>`,
  );
}

function splitParagraphs(text = "") {
  return String(text || "")
    .split(/\n{2,}/)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
}

function isLowValueArticleCopy(text = "") {
  const value = cleanText(text).toLowerCase();
  if (!value) return false;

  return [
    "trending in india:",
    "approx search traffic",
    "this matters because",
    "experts believe",
    "it highlights the importance",
    "a practical next step",
    "watch for follow-through",
    "platform performance",
    "engineering velocity",
    "traffic potential",
  ].some((snippet) => value.includes(snippet));
}

function sanitizeArticleCopy(text = "", maxSentences = 3) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanText(sentence))
    .filter(Boolean)
    .filter((sentence) => !isLowValueArticleCopy(sentence))
    .slice(0, maxSentences)
    .join(" ")
    .trim();
}

function renderBulletList(items = [], emptyText = "No verified key facts available.") {
  const list = Array.isArray(items) && items.length ? items : [emptyText];
  return list.map((item) => `<li>${escapeHtml(cleanText(item))}</li>`).join("");
}

function renderStoryList(stories = []) {
  if (!stories.length) return "<li>No stories available right now.</li>";
  return stories.map((story) => {
    const href = buildStoryHref(story);
    return [
      "<li>",
      `<a href="${escapeHtml(href)}">`,
      `<strong>${escapeHtml(cleanText(story.title || "Story"))}</strong>`,
      `<span>${escapeHtml(storyDeskLabel(story))} • ${escapeHtml(formatDateLabel(storyTimestamp(story)))}</span>`,
      "</a>",
      "</li>",
    ].join("");
  }).join("");
}

function renderRelatedGrid(stories = []) {
  if (!stories.length) return "<p>No related stories available right now.</p>";
  return stories.map((story) => {
    const href = buildStoryHref(story);
    return [
      '<article class="related-card">',
      `<a class="related-card__media" href="${escapeHtml(href)}">`,
      `<img src="${escapeHtml(storyImage(story))}" alt="${escapeHtml(cleanText(story.title || "Story"))}" loading="lazy" decoding="async" width="1600" height="1000" />`,
      "</a>",
      `<span class="related-card__tag">${escapeHtml(storyDeskLabel(story))}</span>`,
      `<a class="related-card__headline" href="${escapeHtml(href)}">${escapeHtml(cleanText(story.title || "Story"))}</a>`,
      `<div class="related-card__meta">${escapeHtml(formatDateLabel(storyTimestamp(story)))}</div>`,
      "</article>",
    ].join("");
  }).join("");
}

function renderArticleBody(article = {}, relatedStories = []) {
  const paragraphs = splitParagraphs(sanitizeArticleCopy(article.body || article.summary || "", 3)).slice(0, 3);
  const continueReading = relatedStories.slice(0, 3);

  return [
    "<h3>Details</h3>",
    ...(paragraphs.length
      ? paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      : ["<p>No additional verified details available.</p>"]),
    continueReading.length
      ? [
        "<h3>Continue Reading</h3>",
        "<p>",
        continueReading.map((story) => {
          const href = buildStoryHref(story);
          return `<a href="${escapeHtml(href)}">${escapeHtml(cleanText(story.title || "Story"))}</a>`;
        }).join(" • "),
        "</p>",
      ].join("")
      : "",
  ].filter(Boolean).join("");
}

function renderTagChips(tags = []) {
  if (!Array.isArray(tags) || !tags.length) return "";
  return `<div class="tag-row" id="articleTags">${tags.map((tag) => `<span class="tag-chip">${escapeHtml(cleanText(String(tag || "").replace(/[-_]+/g, " ")))}</span>`).join("")}</div>`;
}

function renderParagraphGroup(paragraphs = [], emptyText = "No additional verified details available.") {
  const items = Array.isArray(paragraphs) && paragraphs.length
    ? paragraphs
    : [emptyText];
  return items.map((paragraph) => `<p>${escapeHtml(cleanText(paragraph))}</p>`).join("");
}

function renderBackgroundItems(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return '<div class="background-list" id="backgroundList"><article class="background-item"><h3>Context update</h3><p>Related past events are still being assembled for this story.</p></article></div>';
  }

  return `<div class="background-list" id="backgroundList">${items.map((item) => [
    '<article class="background-item">',
    item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><h3>${escapeHtml(cleanText(item.title || "Background"))}</h3></a>` : `<h3>${escapeHtml(cleanText(item.title || "Background"))}</h3>`,
    `<p>${escapeHtml(cleanText(item.context || ""))}</p>`,
    item.source ? `<div class="background-item__source">${escapeHtml(cleanText(item.source))}</div>` : "",
    "</article>",
  ].join("")).join("")}</div>`;
}

function renderFactSheet(rows = []) {
  const items = Array.isArray(rows) && rows.length
    ? rows
    : [{ label: "Status", value: "Verified data points are still loading." }];
  return [
    '<div class="fact-sheet-wrap">',
    '<table class="fact-sheet" id="factSheetTable">',
    "<tbody>",
    items.map((row) => `<tr><th scope="row">${escapeHtml(cleanText(row.label || ""))}</th><td>${escapeHtml(cleanText(row.value || ""))}</td></tr>`).join(""),
    "</tbody>",
    "</table>",
    "</div>",
  ].join("");
}

function renderPrimarySource(article = {}, story = {}) {
  const primarySource = article.primarySource || {
    name: article.source || story.source || "Original Source",
    url: article.sourceUrl || story.sourceUrl || story.url || "",
  };
  const sourceUrl = cleanText(primarySource.url || "");

  return [
    `<section class="article-block article-block--source" id="primarySourceBlock"${sourceUrl ? "" : " hidden"}>`,
    '<div class="article-block__head"><p class="article-block__eyebrow">Source Trail</p><h2>Primary Source</h2></div>',
    '<div class="primary-source">',
    `<a class="primary-source__link" id="articleSource" href="${escapeHtml(sourceUrl || "/")}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanText(primarySource.name || "Original Source"))}</a>`,
    '<p>Use the primary-source link for the original filing, announcement, interview, or report behind this story.</p>',
    "</div>",
    "</section>",
  ].join("");
}

function articleTags(story = {}, article = {}) {
  const existingTags = [
    ...(Array.isArray(article.tags) ? article.tags : []),
    ...(Array.isArray(story.tags) ? story.tags : []),
    ...(Array.isArray(story.keywords) ? story.keywords : []),
  ].filter(Boolean).slice(0, 8);
  if (existingTags.length) return existingTags;
  return buildStoryTags(
    story.title || "",
    ...(Array.isArray(article.keyPoints) ? article.keyPoints : []),
    article.summary || story.summary || ""
  );
}

function relatedEmbedding(story = {}, article = {}) {
  return createTextEmbedding(composeEmbeddingText({
    title: story.title || "",
    keyPoints: Array.isArray(article.keyPoints) ? article.keyPoints : [],
    summary: article.summary || story.summary || "",
  }));
}

function scoreRelatedStory(targetStory = {}, targetArticle = {}, candidate = {}) {
  const targetCategory = normalizeFilter(targetStory.category || "all");
  const candidateCategory = normalizeFilter(candidate.category || "all");
  const targetTags = articleTags(targetStory, targetArticle);
  const candidateTags = articleTags(candidate, candidate);
  const sharedTags = targetTags.filter((tag) => candidateTags.includes(tag));
  const tagScore = sharedTags.length / Math.max(1, Math.max(targetTags.length, candidateTags.length));
  const embeddingScore = cosineSimilarity(
    relatedEmbedding(targetStory, targetArticle),
    relatedEmbedding(candidate, candidate)
  );
  const categoryBoost = targetCategory === candidateCategory ? 0.25 : 0;
  const freshnessBoost = Math.max(0, 1 - ((Date.now() - new Date(storyTimestamp(candidate) || 0).getTime()) / (1000 * 60 * 60 * 24 * 14))) * 0.05;
  return embeddingScore + tagScore + categoryBoost + freshnessBoost;
}

function buildArticleRelatedSets(story = {}, allStories = [], article = {}) {
  const stories = dedupeStories(allStories).filter((candidate) => storyKey(candidate) !== storyKey(story));
  const targetCategory = normalizeFilter(story.category || "all");
  const latest = [...stories].sort((left, right) =>
    new Date(storyTimestamp(right) || 0).getTime() - new Date(storyTimestamp(left) || 0).getTime()
  ).slice(0, 4);
  const rankedRelated = stories
    .filter((candidate) => normalizeFilter(candidate.category || "all") === targetCategory)
    .map((candidate) => ({
      ...candidate,
      relatedScore: scoreRelatedStory(story, article, candidate),
    }))
    .filter((candidate) => candidate.relatedScore > 0.15)
    .sort((left, right) => right.relatedScore - left.relatedScore);
  const related = rankedRelated.slice(0, 6);
  const grid = (related.length ? related : latest).slice(0, 6);

  return {
    trending: stories.slice(0, 4),
    latest,
    related,
    grid,
  };
}

function renderArticleTemplate(template = "", page = {}) {
  const story = page.story || {};
  const article = page.article || {};
  const relatedSets = page.relatedSets || { trending: [], latest: [], related: [], grid: [] };
  const image = storyImage({
    image: article.image || story.image,
    category: story.category,
  });
  const sectionLabel = FILTER_METADATA[normalizeFilter(story.category || "all")]?.label || "Latest";
  const sectionHref = buildSectionPath(story.category || "all", 1);
  const publishedLabel = storyTimestamp(story) ? formatDateLabel(storyTimestamp(story)) : "Live now";
  const articleSummary = sanitizeArticleCopy(article.summary || story.summary || "", 3)
    || "No verified summary available.";
  const readingTime = Number(article.estimatedReadingTime || 0) > 0 ? `${Number(article.estimatedReadingTime)} min read` : "4 min read";
  const fullContent = splitParagraphs(article.body || story.content || article.summary || story.summary || "");
  const deepDive = fullContent.length
    ? fullContent
    : Array.isArray(article.deepDive) && article.deepDive.length
      ? article.deepDive
      : splitParagraphs(article.summary || story.summary || "");
  const background = Array.isArray(article.background) ? article.background : [];
  const tags = articleTags(story, article).slice(0, 5);
  const takeaways = Array.isArray(article.practicalTakeaways) ? article.practicalTakeaways : [];

  let output = String(template || "");
  output = output.replace(
    /<nav class="breadcrumb" id="breadcrumb">[\s\S]*?<\/nav>/,
    [
      '<nav class="breadcrumb" id="breadcrumb">',
      '<a href="/">Home</a>',
      "<span>/</span>",
      `<a href="${escapeHtml(sectionHref)}" id="breadcrumbDesk">${escapeHtml(sectionLabel)}</a>`,
      "<span>/</span>",
      `<span id="breadcrumbCurrent">${escapeHtml(cleanText(story.title || "Story"))}</span>`,
      "</nav>",
    ].join(""),
  );
  output = output.replace(
    /<article class="article-main">[\s\S]*?<\/article>/,
    [
      '<article class="article-main">',
      '<header class="article-hero">',
      `<span class="article-kicker" id="articleCategory">${escapeHtml(sectionLabel)}</span>`,
      `<h1 id="articleTitle">${escapeHtml(cleanText(story.title || "Story"))}</h1>`,
      '<div class="article-meta">',
      `<span id="articleAuthor">${escapeHtml(cleanText(article.source || story.source || "SunWire Desk"))}</span>`,
      `<span id="articleMeta">${escapeHtml(publishedLabel)}</span>`,
      `<span class="article-reading-time" id="articleReadingTime">${escapeHtml(readingTime)}</span>`,
      "</div>",
      '<div class="article-actions">',
      '<button class="action-button" id="copyLinkButton" type="button">Copy Link</button>',
      '<button class="action-button" id="nativeShareButton" type="button">Share</button>',
      "</div>",
      "</header>",
      '<figure class="article-media">',
      `<img id="articleImage" src="${escapeHtml(image)}" alt="${escapeHtml(cleanText(story.title || "Story"))}" loading="eager" decoding="async" fetchpriority="high" width="1600" height="900" />`,
      `<figcaption id="articleImageCaption">Source: ${escapeHtml(cleanText(article.source || story.source || "SunWire Desk"))}</figcaption>`,
      "</figure>",
      `<p class="article-summary" id="articleSummary">${escapeHtml(articleSummary)}</p>`,
      renderTagChips(tags),
      '<section class="article-block article-block--highlights">',
      '<div class="article-block__head"><p class="article-block__eyebrow">TL;DR</p><h2>Key Highlights</h2></div>',
      `<ul class="bullet-list" id="keyPoints">${renderBulletList(
        (article.keyPoints || []).filter((item) => !isLowValueArticleCopy(item))
      )}</ul>`,
      "</section>",
      '<section class="article-block">',
      '<div class="article-block__head"><p class="article-block__eyebrow">Full coverage</p><h2>Full Story</h2></div>',
      `<div class="article-body" id="articleBody">${renderParagraphGroup(deepDive)}</div>`,
      "</section>",
      renderPrimarySource(article, story),
      '<section class="article-block">',
      '<div class="article-block__head"><p class="article-block__eyebrow">Local Angle</p><h2>The India Pulse</h2></div>',
      `<div class="article-body" id="indiaPulseBody">${renderParagraphGroup(article.indiaPulse ? [article.indiaPulse] : [], "India-specific pricing, availability, and impact updates are still being verified.")}</div>`,
      "</section>",
      '<section class="article-block">',
      '<div class="article-block__head"><p class="article-block__eyebrow">Background</p><h2>The Flashback</h2></div>',
      renderBackgroundItems(background),
      "</section>",
      `<section class="article-block" id="takeawaySection"${takeaways.length ? "" : " hidden"}>`,
      '<div class="article-block__head"><p class="article-block__eyebrow">Practical take</p><h2>Takeaways</h2></div>',
      `<ul class="bullet-list" id="takeawayList">${renderBulletList(takeaways, "Watch the next verified update for this story.")}</ul>`,
      "</section>",
      "</article>",
    ].join(""),
  );
  output = output.replace(
    /<aside class="article-sidebar">[\s\S]*?<\/aside>/,
    [
      '<aside class="article-sidebar">',
      '<section class="sidebar-card"><p class="sidebar-card__eyebrow">Trending Now</p>',
      `<ul class="story-list" id="sidebarTrendingList">${renderStoryList(relatedSets.trending)}</ul></section>`,
      '<section class="sidebar-card"><p class="sidebar-card__eyebrow">Latest News</p>',
      `<ul class="story-list" id="sidebarLatestList">${renderStoryList(relatedSets.latest)}</ul></section>`,
      '<section class="sidebar-card"><p class="sidebar-card__eyebrow">Related News</p>',
      `<ul class="story-list" id="sidebarRelatedList">${renderStoryList(relatedSets.related)}</ul></section>`,
      "</aside>",
    ].join(""),
  );
  output = output.replace(
    /<section class="related-section">[\s\S]*?<\/section>/,
    [
      '<section class="related-section">',
      '<div class="related-section__head"><p class="article-block__eyebrow">Suggested by Tags</p><h2>Related News</h2></div>',
      `<div class="related-grid" id="relatedGrid">${renderRelatedGrid(relatedSets.grid)}</div>`,
      "</section>",
    ].join(""),
  );

  const preloadPayload = {
    story: page.story,
    article: page.article,
    relatedSets: page.relatedSets,
  };

  return output.replace(
    /<script type="module" src="\/?article\.js\?v=20260315-2"><\/script>/,
    `<script>window.__SUNWIRE_ARTICLE_DATA__=${safeJsonForInlineScript(preloadPayload)};</script><script type="module" src="/article.js?v=20260315-2"></script>`,
  );
}

module.exports = {
  buildHomeView,
  buildArticleRelatedSets,
  renderHomeTemplate,
  renderArticleTemplate,
  trimSummary,
};
