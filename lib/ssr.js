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
const {
  buildResponsiveImageConfig,
  buildStoryPlaceholderImage,
  hasRenderableStoryImage,
} = require("./server/storyImages");

function safeJsonForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/-->/g, "--\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function resolveGoogleClientId() {
  return cleanText(
    process.env.GOOGLE_CLIENT_ID
    || process.env.GOOGLE_AUTH_CLIENT_ID
    || process.env.GOOGLE_OAUTH_CLIENT_ID
    || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    || ""
  );
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
  const candidate = String(story.image || story.image_url || story.image_storage_url || "").trim();
  if (hasRenderableStoryImage(candidate)) {
    return candidate;
  }
  return buildStoryPlaceholderImage(story);
}

function storyCardImage(story = {}) {
  const candidate = String(story.image || story.image_url || story.image_storage_url || "").trim();
  if (!hasRenderableStoryImage(candidate)) return "";
  if (/placehold\.co/i.test(candidate)) return "";
  return candidate;
}

function storyDeskLabel(story = {}) {
  if (story.displayCategory) return toTitleCase(story.displayCategory);
  const normalized = storyCategoryKey(story);
  return FILTER_METADATA[normalized]?.label || toTitleCase(normalized);
}

function storyCategoryKey(story = {}) {
  const raw = String(story.category || "all").trim().toLowerCase();
  if (["general", "ai", "tech", "entertainment", "sports", "business", "politics", "jobs", "headline", "trending"].includes(raw)) {
    return raw;
  }
  return normalizeFilter(raw);
}

function trimSummary(text = "", maxLength = 160) {
  const summary = cleanText(text);
  if (summary.length <= maxLength) return summary;
  const clipped = summary.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 80 ? lastSpace : maxLength).trim()}...`;
}

const TECH_DESK_SOURCE_PATTERNS = [
  /livemint tech/i,
  /indian express tech/i,
  /techpp/i,
  /india today technology/i,
  /the hindu technology/i,
];
const NON_TECH_TECH_DESK_PATTERNS = [
  /pinkvilla/i,
  /filmfare/i,
  /bollywood hungama/i,
  /koimoi/i,
  /india today entertainment/i,
];
const TECH_DESK_KEYWORDS = [
  "tech", "technology", "software", "hardware", "smartphone", "iphone", "android", "samsung",
  "apple", "google", "microsoft", "meta", "amazon", "chip", "chips", "chipset", "semiconductor",
  "cybersecurity", "cloud", "browser", "api", "app", "apps", "platform", "device", "devices",
  "gadget", "gadgets", "laptop", "tablet", "wearable", "startup", "saas", "ai", "artificial intelligence"
];
const NON_TECH_TECH_DESK_KEYWORDS = [
  "movie", "film", "box office", "actor", "actress", "celebrity", "bollywood", "hollywood",
  "trailer", "album", "music", "awards", "award", "kapoor", "ranveer", "janhvi", "karan johar"
];
const HOME_FIRST_PAGE_STORY_COUNT = 12;
const HOME_ARCHIVE_PAGE_SIZE = 16;

function getHomeTotalPages(totalStories = 0) {
  const safeTotal = Math.max(0, Number(totalStories) || 0);
  if (safeTotal <= HOME_FIRST_PAGE_STORY_COUNT) return 1;
  return 1 + Math.ceil((safeTotal - HOME_FIRST_PAGE_STORY_COUNT) / HOME_ARCHIVE_PAGE_SIZE);
}

function getHomePageStoryWindow(page = 1) {
  const safePage = normalizePageNumber(page);
  if (safePage <= 1) {
    return {
      startIndex: 0,
      pageSize: HOME_FIRST_PAGE_STORY_COUNT,
      endIndex: HOME_FIRST_PAGE_STORY_COUNT,
    };
  }

  const startIndex = HOME_FIRST_PAGE_STORY_COUNT + ((safePage - 2) * HOME_ARCHIVE_PAGE_SIZE);
  return {
    startIndex,
    pageSize: HOME_ARCHIVE_PAGE_SIZE,
    endIndex: startIndex + HOME_ARCHIVE_PAGE_SIZE,
  };
}

function isLikelyTechStory(story = {}) {
  const source = normalizeComparableStoryText(story.source || "");
  const haystack = normalizeComparableStoryText([
    story.title,
    story.summary,
    story.content,
    story.body,
    story.source,
    story.category,
  ].filter(Boolean).join(" "));

  if (NON_TECH_TECH_DESK_PATTERNS.some((pattern) => pattern.test(source))) return false;
  if (NON_TECH_TECH_DESK_KEYWORDS.some((keyword) => haystack.includes(keyword))) return false;
  if (TECH_DESK_SOURCE_PATTERNS.some((pattern) => pattern.test(source))) return true;
  return TECH_DESK_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function storySlug(story = {}) {
  return slugify(story.slug || story.title || story.id || "story");
}

function buildStoryHref(story = {}) {
  if (story.href) return String(story.href || "/").trim() || "/";
  const slug = storySlug(story);
  if (!slug) return "/";

  const params = new URLSearchParams();
  if (story.id) params.set("id", String(story.id || "").trim());
  if (story.sourceUrl || story.url) params.set("u", String(story.sourceUrl || story.url || "").trim());
  if (story.title) params.set("t", cleanText(story.title || ""));
  if (story.category) params.set("c", normalizeFilter(story.category || "all"));
  params.set("sw", "2");
  const query = params.toString();

  return query ? `/article/${slug}?${query}` : `/article/${slug}`;
}

function buildCategoryPlaceholderStories(section = {}, currentStories = [], targetCount = 8) {
  const count = Math.max(0, targetCount - currentStories.length);
  if (!count) return [];

  const category = String(section.category || section.key || "latest").trim().toLowerCase() || "latest";
  const label = section.title || toTitleCase(category);
  const href = section.filter ? buildSectionPath(section.filter, 1) : "";
  const source = currentStories.length ? "Sunwire Live Desk" : "Sunwire";

  return Array.from({ length: count }, (_, index) => ({
    id: `placeholder-${category}-${index + 1}`,
    slug: `placeholder-${category}-${index + 1}`,
    href: href || "/",
    title: currentStories.length
      ? `More ${label.toLowerCase()} updates coming soon`
      : `${label} updates are loading`,
    summary: currentStories.length
      ? `More verified ${label.toLowerCase()} stories will appear here as fresh coverage is ingested.`
      : `This ${label.toLowerCase()} rail is reserved for strictly matched stories only.`,
    content: currentStories.length
      ? `More verified ${label.toLowerCase()} stories will appear here as fresh coverage is ingested.`
      : `This ${label.toLowerCase()} rail is reserved for strictly matched stories only.`,
    source,
    category,
    displayCategory: label,
    published_at: "",
    source_published_at: "",
  }));
}

function renderImageAttributes(src = "", options = {}) {
  const config = buildResponsiveImageConfig(src, options);
  const attributes = [
    `src="${escapeHtml(config.src || src)}"`,
    `width="${escapeHtml(String(config.width || options.width || 1600))}"`,
    `height="${escapeHtml(String(config.height || options.height || 900))}"`,
  ];

  if (config.srcset) attributes.push(`srcset="${escapeHtml(config.srcset)}"`);
  if (config.sizes) attributes.push(`sizes="${escapeHtml(config.sizes)}"`);

  return attributes.join(" ");
}

function renderNewsCard(story = {}, variant = "standard", options = {}) {
  const href = buildStoryHref(story);
  const image = storyImage(story);
  const imageAlt = cleanText(story.title || "SunWire story");
  const summary = trimSummary(
    story.summary || story.subheadline || story.content || "",
    variant === "compact" ? 110 : 150
  );
  const priority = options.priority === true;
  const loading = priority ? "eager" : "lazy";
  const fetchPriorityAttr = priority ? ' fetchpriority="high"' : "";

  return [
    `<article class="news-card news-card--${escapeHtml(variant)}">`,
    `<a class="news-card__media" href="${escapeHtml(href)}" target="_self" rel="noopener noreferrer">`,
    `<img class="news-card__image" ${renderImageAttributes(image, {
      width: 1600,
      height: variant === "standard" ? 1000 : 900,
      sizes: variant === "compact"
        ? "(max-width: 900px) 100vw, 24vw"
        : variant === "dense"
        ? "(max-width: 900px) 100vw, 48vw"
          : "(max-width: 900px) 100vw, 30vw",
    })} alt="${escapeHtml(imageAlt)}" loading="${loading}" decoding="async"${fetchPriorityAttr} />`,
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
  const categories = ["ai", "tech", "entertainment", "sports", "business", "politics", "jobs"];
  return categories.reduce((acc, category) => {
    acc[category] = dedupeStories(allStories.filter((story) =>
      storyCategoryKey(story) === category
      && (category !== "tech" || isLikelyTechStory(story))
    ));
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

const HOMEPAGE_SECTION_DEFINITIONS = [
  { key: "ai", title: "AI", eyebrow: "Models and agents", category: "ai", filter: "ai" },
  { key: "tech", title: "Tech", eyebrow: "Platforms and chips", category: "tech", filter: "tech" },
  { key: "entertainment", title: "Entertainment", eyebrow: "Culture and releases", category: "entertainment", filter: "entertainment" },
  { key: "sports", title: "Sports", eyebrow: "Matches and momentum", category: "sports", filter: "sports" },
  { key: "business", title: "Business", eyebrow: "Markets and money", category: "business", filter: "business" },
  { key: "politics", title: "Politics", eyebrow: "Power and policy", category: "politics", filter: "politics" },
  { key: "jobs", title: "Jobs", eyebrow: "Hiring and careers", category: "jobs", filter: "jobs" },
];
const ECONOMY_KEYWORDS = [
  "economy", "economic", "inflation", "deflation", "gdp", "cpi", "ppi", "interest rate",
  "federal reserve", "fed", "rbi", "central bank", "treasury", "bond", "yield", "tariff",
  "trade", "oil", "crude", "currency", "rupee", "dollar", "unemployment", "growth", "recession",
  "markets", "market", "stocks", "shares", "sensex", "nifty", "nasdaq", "dow", "s&p"
];
const JOBS_KEYWORDS = [
  "job", "jobs", "hiring", "hire", "recruit", "recruiting", "layoff", "layoffs", "career",
  "careers", "workforce", "salary", "payroll", "headcount", "internship", "internships",
  "employee", "employees", "talent", "opening", "openings", "resume"
];
const FOOD_KEYWORDS = [
  "food", "restaurant", "restaurants", "dining", "chef", "menu", "cafe", "coffee", "tea",
  "recipe", "recipes", "cooking", "kitchen", "grocery", "groceries", "snack", "snacks",
  "beverage", "beverages", "drink", "drinks", "cuisine", "meals", "michelin"
];
const WAR_KEYWORDS = [
  "war", "conflict", "missile", "missiles", "drone", "drones", "border", "attack", "attacks",
  "military", "army", "navy", "air force", "ceasefire", "shelling", "defence", "defense", "terror"
];

function storySearchText(story = {}) {
  return normalizeComparableStoryText([
    story.title,
    story.summary,
    story.content,
    story.body,
    story.displayCategory,
    story.source,
    story.category,
    story.searchTrendTopic,
  ].filter(Boolean).join(" "));
}

function matchesKeywordSet(story = {}, keywords = []) {
  const haystack = storySearchText(story);
  return keywords.some((keyword) => haystack.includes(keyword));
}

function isPoliticsStory(story = {}) {
  return matchesKeywordSet(story, [
    "politics", "political", "policy", "policies", "government", "election", "elections",
    "president", "prime minister", "minister", "congress", "senate", "parliament", "white house",
    "tariff", "trade war", "sanction", "sanctions", "visa", "asylum", "regulation", "regulatory",
    "antitrust", "supreme court", "lawmakers", "diplomatic", "geopolitic", "border", "immigration",
  ]);
}

function isEconomyStory(story = {}) {
  return matchesKeywordSet(story, ECONOMY_KEYWORDS) || normalizeFilter(story.category || "all") === "business";
}

function isJobsStory(story = {}) {
  return matchesKeywordSet(story, JOBS_KEYWORDS);
}

function isFoodStory(story = {}) {
  return matchesKeywordSet(story, FOOD_KEYWORDS);
}

function isWarStory(story = {}) {
  return matchesKeywordSet(story, WAR_KEYWORDS);
}

function isAudienceGatheringStory(story = {}) {
  return Number(story.searchTrendScore || 0) >= 35
    || Number(story.indiaAudienceRelevance || 0) >= 15
    || Number(story.trendingScore || 0) >= 12
    || Number(story.priority || 0) >= 1;
}

function isHomepageGeneralStory(story = {}) {
  const category = storyCategoryKey(story);
  return category !== "food"
    && category !== "jobs"
    && !isFoodStory(story)
    && !isJobsStory(story);
}

function isActiveFeaturedManualStory(story = {}) {
  const featuredUntil = new Date(story?.featured_until || story?.featuredUntil || "").getTime();
  return Boolean(story?.is_featured && featuredUntil && featuredUntil > Date.now());
}

function isHomepageFeaturedStory(story = {}) {
  if (isActiveFeaturedManualStory(story)) return true;
  const category = storyCategoryKey(story);
  if (!isHomepageGeneralStory(story)) return false;
  if (category === "ai") return true;
  if (category === "tech") return isLikelyTechStory(story);
  if (isWarStory(story)) return true;
  return isAudienceGatheringStory(story);
}

function compareHomepagePriority(left = {}, right = {}) {
  const manualFeaturedDelta = Number(isActiveFeaturedManualStory(right)) - Number(isActiveFeaturedManualStory(left));
  if (manualFeaturedDelta !== 0) return manualFeaturedDelta;

  const featuredDelta = Number(isHomepageFeaturedStory(right)) - Number(isHomepageFeaturedStory(left));
  if (featuredDelta !== 0) return featuredDelta;

  const trendDelta = Number(right.searchTrendScore || 0) - Number(left.searchTrendScore || 0);
  if (trendDelta !== 0) return trendDelta;

  const audienceDelta = Number(right.indiaAudienceRelevance || 0) - Number(left.indiaAudienceRelevance || 0);
  if (audienceDelta !== 0) return audienceDelta;

  const trendingDelta = Number(right.trendingScore || 0) - Number(left.trendingScore || 0);
  if (trendingDelta !== 0) return trendingDelta;

  const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
  if (priorityDelta !== 0) return priorityDelta;

  return new Date(storyTimestamp(right)).getTime() - new Date(storyTimestamp(left)).getTime();
}

function sortStoriesForHomepageFocus(stories = []) {
  return [...stories].sort(compareHomepagePriority);
}

function sortStoriesByRecency(stories = []) {
  return [...stories].sort((left, right) =>
    new Date(storyTimestamp(right)).getTime() - new Date(storyTimestamp(left)).getTime()
  );
}

function mapSectionStories(stories = [], label = "") {
  return stories.map((story) => ({
    ...story,
    displayCategory: label || story.displayCategory || story.category || "News",
  }));
}

function buildHomepageSectionStories(section = {}, storyPool = [], categoryMap = {}, latestPool = []) {
  const sectionLabel = section.title || "News";

  if (section.category) {
    const exactStories = fillSectionStories(categoryMap[section.category], [], 8, new Set());
    return mapSectionStories([
      ...exactStories.slice(0, 8),
      ...buildCategoryPlaceholderStories(section, exactStories.slice(0, 8), 8),
    ].slice(0, 8), sectionLabel);
  }

  return [];
}

function buildHomepageDeskSections(storyPool = [], categoryMap = {}, latestPool = []) {
  return HOMEPAGE_SECTION_DEFINITIONS.map((section) => ({
    eyebrow: section.eyebrow,
    title: section.title,
    filter: section.filter || "",
    hideAction: !section.filter,
    layout: "rail",
    cardVariant: "compact",
    stories: buildHomepageSectionStories(section, storyPool, categoryMap, latestPool),
  })).filter((section) => Array.isArray(section.stories) && section.stories.length);
}

function deterministicShuffle(stories = [], salt = 1) {
  return [...stories]
    .map((story, index) => {
      const key = `${storyKey(story)}|${salt}|${index}`;
      const weight = Array.from(key).reduce((hash, char) => ((hash * 33) + char.charCodeAt(0)) >>> 0, 5381);
      return { story, weight };
    })
    .sort((left, right) => left.weight - right.weight)
    .map((entry) => entry.story);
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
  const metadata = FILTER_METADATA[safeFilter] || FILTER_METADATA.all;

  if (safeFilter !== "all") {
    const deskPool = Array.isArray(categoryMap[safeFilter]) && categoryMap[safeFilter].length
      ? categoryMap[safeFilter]
      : filteredPageStories;
    const focusedStories = fillSectionStories(
      sortStoriesByRecency(filteredPageStories),
      sortStoriesByRecency(
        deskPool.filter((story) => !filteredPageStories.some((entry) => storyKey(entry) === storyKey(story)))
      ),
      16,
      new Set()
    );

    return {
      hero: null,
      trending: [],
      topSections: [],
      moreSections: [],
      fullGridStories: focusedStories,
      categoryMap,
      tickerStories: focusedStories,
      pageStories: filteredPageStories,
      totalPages,
      totalStories,
      page: safePage,
      filter: safeFilter,
      hideSectionHead: true,
      pageTitle: safePage > 1 ? `${metadata.label} Page ${safePage}` : `${metadata.label} News`,
    };
  }

  if (safePage > 1) {
    const fallbackStories = deterministicShuffle(
      storyPool.filter((story) => !filteredPageStories.some((entry) => storyKey(entry) === storyKey(story))),
      safePage + 11
    );
    const fullGridStories = fillSectionStories(filteredPageStories, fallbackStories, HOME_ARCHIVE_PAGE_SIZE, new Set());
    return {
      hero: null,
      trending: [],
      topSections: [],
      moreSections: [],
      fullGridStories,
      categoryMap,
      pageStories: filteredPageStories,
      totalPages,
      totalStories,
      page: safePage,
      filter: safeFilter,
      pageTitle: `Page ${safePage} News Grid`,
    };
  }
  const homepageGeneralPool = dedupeStories(storyPool.filter(isHomepageGeneralStory));
  const homepagePriorityPool = dedupeStories(sortStoriesForHomepageFocus(homepageGeneralPool.filter(isHomepageFeaturedStory)));
  const homepageFallbackPool = homepageGeneralPool.length ? homepageGeneralPool : storyPool;
  const hero = homepagePriorityPool[0] || homepageFallbackPool[0] || filteredPageStories[0] || storyPool[0] || null;
  const trending = selectUniqueStories(
    dedupeStories([
      ...filteredPageStories,
      ...homepagePriorityPool,
      ...sortStoriesForHomepageFocus(homepageFallbackPool),
    ]),
    HOME_FIRST_PAGE_STORY_COUNT,
    new Set()
  );
  const topSections = [];

  return {
    hero,
    trending,
    topSections: topSections.filter((section) => Array.isArray(section.stories) && section.stories.length),
    moreSections: [],
    fullGridStories: [],
    tickerStories: dedupeStories([
      hero,
      ...trending,
    ].filter(Boolean)),
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

function toHomePreloadStory(story = {}) {
  return {
    id: story.id || "",
    slug: story.slug || "",
    title: story.title || "",
    summary: story.summary || story.subheadline || "",
    subheadline: story.subheadline || "",
    source: story.source || "",
    sourceUrl: story.sourceUrl || story.url || "",
    url: story.url || story.sourceUrl || "",
    image: story.image || story.image_url || story.image_storage_url || "",
    image_url: story.image_url || story.image || "",
    image_storage_url: story.image_storage_url || "",
    category: story.category || "",
    published_at: story.published_at || "",
    source_published_at: story.source_published_at || story.published_at || "",
    is_featured: Boolean(story.is_featured),
    featured_until: story.featured_until || "",
    manual_upload: Boolean(story.manual_upload),
  };
}

function toHomePreloadCategoryMap(categoryMap = {}) {
  return Object.fromEntries(
    Object.entries(categoryMap || {}).map(([key, stories]) => [
      key,
      Array.isArray(stories) ? stories.map(toHomePreloadStory) : [],
    ])
  );
}

function renderHomeTemplate(template = "", view = {}, runtimeConfig = {}) {
  const hero = view.hero;
  const heroHref = hero ? buildStoryHref(hero) : "/";
  const heroImage = hero ? storyImage(hero) : SITE.socialImage;
  const heroTitle = cleanText(hero?.title || "Loading headline...");
  const heroSummary = trimSummary(hero?.summary || SITE.defaultDescription, 170);
  const heroAuthor = cleanText(hero?.source || "SunWire Desk");
  const heroMeta = hero ? formatDateLabel(storyTimestamp(hero)) : "Waiting for fresh stories.";
  const tickerStories = dedupeStories((view.tickerStories || [hero, ...(view.trending || []), ...(view.fullGridStories || []), ...(view.moreSections || []).flatMap((section) => section.stories || [])]).filter(Boolean));
  const tickerText = tickerStories.length
    ? tickerStories.slice(0, 8).map((story) => cleanText(story.title || "")).join(" • ")
    : "Fresh stories are loading on SunWire.";
  const categoryHeading = "Category News Grid";
  const leadStory = view.hero || (Array.isArray(view.fullGridStories) ? view.fullGridStories[0] : null) || null;
  const moreHeadingMeta = leadStory
    ? `${FILTER_METADATA[view.filter]?.label || "Latest"} updated ${formatDateLabel(storyTimestamp(leadStory))}`
    : "Scanning the live wire";
  const hasFullGrid = Array.isArray(view.fullGridStories) && view.fullGridStories.length > 0;
  const hasMoreSections = Array.isArray(view.moreSections) && view.moreSections.some((section) => Array.isArray(section?.stories) && section.stories.length);
  const cleanGridMode = hasFullGrid && view.filter !== "all";

  let output = String(template || "");
  output = output.replace(
    /<body data-home-mode="home">/,
    hasFullGrid
      ? '<body data-home-mode="archive">'
      : '<body data-home-mode="home">'
  );
  const topLayoutMarkup = [
    `<div class="main-layout home-top-layout" id="heroSection" aria-live="polite"${hasFullGrid ? " hidden" : ""}>`,
    '<div class="home-left-col">',
    '<div class="left-hero">',
    `<a class="hero-media-link" id="heroMediaLink" href="${escapeHtml(heroHref)}" target="_self" rel="noopener noreferrer" aria-label="Open headline story">`,
    `<img id="heroImage" ${renderImageAttributes(heroImage, {
      width: 1600,
      height: 900,
      sizes: "(max-width: 1100px) 100vw, 66vw",
    })} alt="${escapeHtml(heroTitle)}" loading="eager" decoding="async" fetchpriority="high" />`,
    '</a>',
    '<div class="hero-overlay"></div>',
    '<div class="hero-content">',
    `<span class="hero-kicker" id="heroDeskChip">${escapeHtml(view.hero ? storyDeskLabel(view.hero) : "Live Desk")}</span>`,
    '<h1 class="hero-title">',
    heroTitle.includes(":")
      ? `<a id="headlineOfTheDayLink" href="${escapeHtml(heroHref)}" target="_self" rel="noopener noreferrer"><span class="highlight">${escapeHtml(heroTitle.split(":")[0])}</span>: ${escapeHtml(heroTitle.split(":").slice(1).join(":"))}</a>`
      : `<a id="headlineOfTheDayLink" href="${escapeHtml(heroHref)}" target="_self" rel="noopener noreferrer">${escapeHtml(heroTitle)}</a>`,
    "</h1>",
    `<p class="hero-desc" id="heroSummary">${escapeHtml(heroSummary)}</p>`,
    '<div class="meta-row">',
    '<span class="breaking-badge"><span class="breaking-dot"></span>BREAKING</span>',
    `<span class="hero-section__author" id="heroAuthor">${escapeHtml(heroAuthor)}</span>`,
    `<span class="hero-section__time" id="headlineOfTheDayMeta">${escapeHtml(heroMeta)}</span>`,
    "</div>",
    '<div class="hero-actions-row">',
    `<a id="heroViewStory" href="${escapeHtml(heroHref)}" class="hero-view-btn" target="_self" rel="noopener noreferrer">View Full Story →</a>`,
    "</div>",
    "</div>",
    "</div>",
    '<section class="hero-live-panel" id="heroLiveUpdatesPanel">',
    '<div class="hero-live-panel__header">',
    "<div>",
    '<p class="hero-live-panel__eyebrow">Live Updates</p>',
    '<h2 class="hero-live-panel__title" id="heroLiveUpdatesTitle">Rolling timeline</h2>',
    "</div>",
    '<span class="hero-live-panel__meta" id="heroLiveUpdatesMeta">Waiting for queued updates</span>',
    "</div>",
    '<ul class="hero-live-panel__list" id="heroLiveUpdatesList"><li>Live updates will appear here after you queue them from Watch All News.</li></ul>',
    "</section>",
    "</div>",
    `<aside class="right-sidebar" id="homepageSidebar" aria-label="SunWire insights"${hasFullGrid ? " hidden" : ""}>`,
    '<article class="sidebar-card sidebar-card--tool">',
    '<p class="sidebar-card__eyebrow"><span class="eyebrow-icon">✦</span> AI Tool of the Day</p>',
    '<h3 id="toolName">Loading…</h3>',
    '<p id="toolUse">Loading tool description…</p>',
    '<a id="toolLink" class="sidebar-button" target="_blank" rel="noopener noreferrer">Try it Free →</a>',
    '<p class="tool-no-cc">✓ No credit card required</p>',
    '</article>',
    '<article class="sidebar-card sidebar-card--prices">',
    '<div class="sidebar-card__header">',
    '<span class="price-icon">📈</span> Price Moves',
    `<span class="price-moves-date">${escapeHtml(new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", year: "numeric" }))}</span>`,
    '</div>',
    '<div class="price-board">',
    '<p class="price-board__meta" id="priceBoardMeta">Loading latest prices…</p>',
    '<ul class="price-list" id="priceBoardList"><li>Loading latest prices…</li></ul>',
    '<p class="price-board__sources" id="priceBoardSources"></p>',
    '</div>',
    '</article>',
    '<article class="sidebar-card sidebar-card--reading">',
    '<div class="sidebar-card__header"><span class="updates-icon">👁</span> People Are Reading</div>',
    '<ul class="people-reading-list" id="peopleReadingList"><li>Loading audience pulse…</li></ul>',
    '</article>',
    '</aside>',
    '</div>',
    `<section class="trending-strip" aria-labelledby="trendingSectionTitle"${hasFullGrid ? " hidden" : ""}>`,
    '<div class="section-head">',
    "<div>",
    '<p class="section-caption">Live momentum</p>',
    '<h2 class="section-title" id="trendingSectionTitle">Trending Now</h2>',
    "</div>",
    '<div class="section-head__actions">',
    '<div class="section-switcher" aria-label="Trending feed mode">',
    '<button class="section-tab is-active" type="button" data-trending-mode="trending">Trending</button>',
    '<button class="section-tab" type="button" data-trending-mode="just-in">Just In</button>',
    "</div>",
    `<span class="section-head__meta" id="trendingUpdatedAt">${escapeHtml(view.hero ? `Updated ${formatDateLabel(storyTimestamp(view.hero))}` : "Updated just now")}</span>`,
    "</div>",
    "</div>",
    `<div class="trending-strip__cards" id="trendingGrid" aria-live="polite">${(view.trending || []).map((story, index) => renderNewsCard(story, "compact", { priority: index < 4 })).join("")}</div>`,
    "</section>",
  ].join("");
  output = output.replace(
    /<div class="main-layout home-top-layout" id="heroSection" aria-live="polite">[\s\S]*?<section class="trending-strip" aria-labelledby="trendingSectionTitle">[\s\S]*?<\/section>/,
    topLayoutMarkup
  );
  output = output.replace(
    /<div class="breaking-ticker__track" id="tickerTrack">[\s\S]*?<\/div>/,
    `<div class="breaking-ticker__track" id="tickerTrack">${escapeHtml(tickerText)}</div>`,
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
    /<section class="category-zone" aria-labelledby="categoryNewsTitle"(?: hidden)?>([\s\S]*?)<\/section>/,
    [
      '<section class="category-zone" aria-labelledby="categoryNewsTitle" hidden>',
      '<div class="section-head">',
      '<div>',
      '<p class="section-caption">Front page by desk</p>',
      `<h2 class="section-title" id="categoryNewsTitle">${escapeHtml(categoryHeading)}</h2>`,
      '</div>',
      '<div class="section-head__actions">',
      '<button class="ghost-button" id="showAllButton" type="button">Show All</button>',
      `<span class="desk-chip" id="activeDeskChip">${escapeHtml(FILTER_METADATA[view.filter]?.label || "All")}</span>`,
      '</div>',
      '</div>',
      '<div class="desk-panels desk-panels--top" id="categorySectionsGrid" aria-live="polite"></div>',
      '</section>',
    ].join(""),
  );
  output = output.replace(
    /<section class="more-news-shell" aria-labelledby="moreNewsTitle">/,
    `<section class="more-news-shell${cleanGridMode ? " more-news-shell--clean" : ""}" aria-labelledby="moreNewsTitle"${hasFullGrid || hasMoreSections ? "" : " hidden"}>`,
  );
  output = output.replace(
    /<h2 class="section-title" id="moreNewsTitle">[\s\S]*?<\/h2>/,
    `<h2 class="section-title" id="moreNewsTitle">${escapeHtml(hasFullGrid ? (view.pageTitle || `Page ${view.page} News Grid`) : "More News")}</h2>`,
  );
  output = output.replace(
    /<span class="section-head__meta" id="livePulseText">[\s\S]*?<\/span>/,
    `<span class="section-head__meta" id="livePulseText">${escapeHtml(moreHeadingMeta)}</span>`,
  );
  output = output.replace(
    /<div class="news-card-grid news-card-grid--homepage" id="moreNewsGrid" aria-live="polite">[\s\S]*?<\/div>/,
    hasFullGrid
      ? `<div class="news-card-grid news-card-grid--page" id="moreNewsGrid" aria-live="polite">${(view.fullGridStories || []).map((story, index) => renderNewsCard(story, "dense", { priority: index < 4 })).join("")}</div>`
      : `<div class="news-card-grid news-card-grid--homepage" id="moreNewsGrid" aria-live="polite">${((view.moreSections?.[0]?.stories) || []).map((story, index) => renderNewsCard(story, "dense", { priority: index < 4 })).join("")}</div>`,
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
    pageStories: (view.pageStories || []).map(toHomePreloadStory),
    mainStories: (view.pageStories || []).map(toHomePreloadStory),
    categoryMap: {},
  };

  const clientId = cleanText(runtimeConfig.clientId || resolveGoogleClientId());
  const authState = runtimeConfig.authState || null;
  return output.replace(
    /<script type="module" src="\/?app\.js\?v=[^"]+"><\/script>/,
    `<script>window.__SUNWIRE_HOME_DATA__=${safeJsonForInlineScript(preloadPayload)};window.__SUNWIRE_AUTH_STATE__=${safeJsonForInlineScript(authState)};window.__SUNWIRE_GOOGLE_CLIENT_ID__=${safeJsonForInlineScript(clientId)};document.documentElement.dataset.googleClientId=${safeJsonForInlineScript(clientId)};var authButton=document.getElementById('authButton');if(authButton){authButton.dataset.googleClientId=${safeJsonForInlineScript(clientId)};}</script><script type="module" src="/app.js?v=20260331-38"></script>`,
  );
}

function normalizeParagraph(entry = "", preserveLines = false) {
  const raw = String(entry || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "");
  if (!preserveLines) return cleanText(raw);
  return raw
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

function splitParagraphs(text = "", options = {}) {
  const preserveLines = Boolean(options?.preserveLines);
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((entry) => normalizeParagraph(entry, preserveLines))
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
    const image = storyCardImage(story);
    return [
      '<article class="related-card">',
      image
        ? `<a class="related-card__media" href="${escapeHtml(href)}"><img ${renderImageAttributes(image, {
          width: 1600,
          height: 1000,
          sizes: "(max-width: 900px) 100vw, 22vw",
        })} alt="${escapeHtml(cleanText(story.title || "Story"))}" loading="lazy" decoding="async" /></a>`
        : "",
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
  return items.map((paragraph) => `<p>${escapeHtml(String(paragraph || "")).replace(/\n/g, "<br />")}</p>`).join("");
}

function renderBackgroundItems(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return '<div class="background-list" id="backgroundList"><div class="background-item"><h3>Context update</h3><p>Related past events are still being assembled for this story.</p></div></div>';
  }

  return `<div class="background-list" id="backgroundList">${items.map((item) => [
    '<div class="background-item">',
    `<h3>${escapeHtml(cleanText(item.title || "Background"))}</h3>`,
    `<p>${escapeHtml(cleanText(item.context || ""))}</p>`,
    "</div>",
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
    '<p>Trace the reporting trail through the original filing, announcement, interview, or official source behind this story.</p>',
    "</div>",
    "</section>",
  ].join("");
}

function renderInArticleAd() {
  return [
    '<div class="article-inline-ad js-adsense-slot" aria-label="Advertisement">',
    '<ins class="adsbygoogle"',
    ' style="display:block; text-align:center;"',
    ' data-ad-client="ca-pub-5608383950266105"',
    ' data-ad-slot="3853179433"',
    ' data-ad-layout="in-article"',
    ' data-ad-format="fluid"></ins>',
    '<script>(function(){var ad=document.currentScript&&document.currentScript.previousElementSibling;if(!ad||ad.dataset.sunwireAdBooted==="1"){return;}try{(window.adsbygoogle=window.adsbygoogle||[]).push({});ad.dataset.sunwireAdBooted="1";}catch(_){}})();</script>',
    "</div>",
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
  const showAds = page.showAds === true;
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
  const preserveManualParagraphs = Boolean(story.manual_upload || article.manual_upload);
  const fullContent = splitParagraphs(article.body || story.content || article.summary || story.summary || "", {
    preserveLines: preserveManualParagraphs,
  });
  const deepDive = fullContent.length
    ? fullContent
    : Array.isArray(article.deepDive) && article.deepDive.length
      ? article.deepDive
      : splitParagraphs(article.summary || story.summary || "", { preserveLines: preserveManualParagraphs });
  const keyPoints = Array.isArray(article.keyPoints) ? article.keyPoints.filter(Boolean).slice(0, 5) : [];
  const background = Array.isArray(article.background) ? article.background.slice(0, 3) : [];
  const factSheet = Array.isArray(article.factSheet) ? article.factSheet.slice(0, 8) : [];
  const indiaPulse = cleanText(article.indiaPulse || "");
  const tags = articleTags(story, article).slice(0, 5);
  const latestStories = Array.isArray(relatedSets.latest) ? relatedSets.latest.slice(0, 4) : [];

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
      '<section class="article-lead">',
      '<div class="article-lead__copy">',
      '<header class="article-hero">',
      `<span class="article-kicker" id="articleCategory">${escapeHtml(sectionLabel)}</span>`,
      `<h1 id="articleTitle">${escapeHtml(cleanText(story.title || "Story"))}</h1>`,
      '<div class="article-meta">',
      `<span id="articleAuthor">${escapeHtml(cleanText(article.authorName || story.authorName || article.source || story.source || "Sunwire News Desk"))}</span>`,
      `<span id="articleMeta">${escapeHtml(publishedLabel)}</span>`,
      `<span class="article-reading-time" id="articleReadingTime">${escapeHtml(readingTime)}</span>`,
      "</div>",
      "</header>",
      `<p class="article-summary" id="articleSummary">${escapeHtml(articleSummary)}</p>`,
      "</div>",
      '<figure class="article-media">',
      `<img id="articleImage" ${renderImageAttributes(image, {
        width: 1600,
        height: 900,
        sizes: "(max-width: 960px) 100vw, 46vw",
      })} alt="${escapeHtml(cleanText(story.title || "Story"))}" loading="eager" decoding="async" fetchpriority="high" />`,
      `<figcaption id="articleImageCaption">Source: ${escapeHtml(cleanText(article.source || story.source || "SunWire Desk"))}</figcaption>`,
      '<div class="article-actions">',
      '<button class="action-button" id="copyLinkButton" type="button">Copy Link</button>',
      '<button class="action-button" id="nativeShareButton" type="button">Share</button>',
      "</div>",
      renderTagChips(tags),
      "</figure>",
      showAds ? renderInArticleAd() : "",
      '<section class="article-block article-block--story">',
      '<div class="article-block__head"><p class="article-block__eyebrow">Full coverage</p><h2>What Happened</h2></div>',
      `<div class="article-body" id="articleBody">${renderParagraphGroup(deepDive)}</div>`,
      "</section>",
      [
        '<aside class="article-support-rail">',
        '<section class="article-block article-block--fact-sheet">',
        '<div class="article-block__head"><p class="article-block__eyebrow">Fact Sheet</p><h2>Verified Details</h2></div>',
        renderFactSheet(factSheet),
        "</section>",
        '<section class="article-block article-block--key-points">',
        '<div class="article-block__head"><p class="article-block__eyebrow">Key Points</p><h2>What To Know</h2></div>',
        `<div class="article-body">${renderParagraphGroup((keyPoints.length ? keyPoints : ["No verified key points available yet."]).map((point) => `${cleanText(point)}.`))}</div>`,
        "</section>",
        '<section class="article-block article-block--india-pulse">',
        '<div class="article-block__head"><p class="article-block__eyebrow">Why It Matters</p><h2>Context</h2></div>',
        `<div class="article-body"><p>${escapeHtml(indiaPulse || "Why this story matters is still being prepared for this article.")}</p></div>`,
        "</section>",
        "</aside>",
      ].join(""),
      "</section>",
      [
        '<div class="article-followup">',
        '<section class="article-block article-block--background">',
        '<div class="article-block__head"><p class="article-block__eyebrow">Background</p><h2>Context Trail</h2></div>',
        renderBackgroundItems(background),
        "</section>",
        renderPrimarySource(article, story),
        "</div>",
      ].join(""),
      [
        '<div class="article-secondary">',
        '<section class="article-block article-block--latest">',
        '<div class="article-block__head"><p class="article-block__eyebrow">Fresh Links</p><h2>Latest News</h2></div>',
        `<ul class="story-list" id="latestNewsList">${renderStoryList(latestStories)}</ul>`,
        "</section>",
        "</div>",
      ].join(""),
      "</article>",
    ].join(""),
  );
  output = output.replace(
    /<aside class="article-sidebar">[\s\S]*?<\/aside>/,
    "",
  );
  output = output.replace(
    /<section class="related-section">[\s\S]*?<\/section>/,
    "",
  );
  output = output.replace(
    /<section class="shell ad-slot"[\s\S]*?<\/section>/,
    "",
  );

  const preloadPayload = {
    story: page.story,
    article: page.article,
    relatedSets: page.relatedSets,
  };

  return output.replace(
    /<script type="module" src="\/?article\.js\?v=[^"]+"><\/script>/,
    `<script>window.__SUNWIRE_ARTICLE_DATA__=${safeJsonForInlineScript(preloadPayload)};</script><script type="module" src="/article.js?v=20260327-article-layout-1"></script>`,
  );
}

module.exports = {
  buildHomeView,
  buildArticleRelatedSets,
  renderHomeTemplate,
  renderArticleTemplate,
  trimSummary,
};
