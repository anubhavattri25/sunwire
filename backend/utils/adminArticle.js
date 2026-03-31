const { slugify } = require('../../lib/seo');
const { normalizeAuthorName } = require('../../lib/article/googleNews');
const { countWords } = require('../services/contentQuality');
const {
  isDatabaseCoolingDown,
  markDatabasePressure,
} = require('./databaseAvailability');

const ADMIN_CATEGORIES = [
  'ai',
  'tech',
  'entertainment',
  'sports',
  'politics',
  'business',
  'jobs',
];
const ADMIN_PLACEMENTS = ['headline', 'trending'];
const FEATURED_EXPIRY_INTERVAL_MS = 60 * 1000;
const MAX_READER_COUNT = 100000000;
const MAX_LIVE_UPDATES = 40;
const featuredExpiryState = globalThis.__SUNWIRE_FEATURED_EXPIRY_STATE__ || {
  lastRunAt: 0,
};

globalThis.__SUNWIRE_FEATURED_EXPIRY_STATE__ = featuredExpiryState;

function cleanText(value = '') {
  return String(value || '').trim();
}

function normalizeInteger(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeIsoDateTime(value = '') {
  const normalized = cleanText(value);
  if (!normalized) return '';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString();
}

function normalizeLiveUpdateItems(items = [], maxItems = MAX_LIVE_UPDATES) {
  const sourceItems = Array.isArray(items)
    ? items
    : String(items || '')
      .split(/\n+/)
      .map((entry) => ({ text: entry }));

  return sourceItems
    .map((entry) => {
      if (typeof entry === 'string') {
        return { text: cleanText(entry), scheduledAt: '' };
      }
      return {
        text: cleanText(entry?.text || entry?.title || entry?.label || ''),
        scheduledAt: normalizeIsoDateTime(entry?.scheduledAt || entry?.createdAt || entry?.timestamp || ''),
      };
    })
    .filter((entry) => entry.text)
    .slice(0, maxItems);
}

function normalizeManualReaderPulse(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const baseCount = normalizeInteger(
    source.baseCount ?? source.startCount ?? fallbackSource.baseCount ?? fallbackSource.startCount ?? 0,
    0,
    { min: 0, max: MAX_READER_COUNT }
  );
  const incrementBy = normalizeInteger(
    source.incrementBy ?? source.stepCount ?? fallbackSource.incrementBy ?? fallbackSource.stepCount ?? 0,
    0,
    { min: 0, max: MAX_READER_COUNT }
  );
  const everyMinutes = normalizeInteger(
    source.everyMinutes ?? source.stepMinutes ?? fallbackSource.everyMinutes ?? fallbackSource.stepMinutes ?? 15,
    15,
    { min: 1, max: 24 * 60 }
  );
  const startedAt = normalizeIsoDateTime(
    source.startedAt
    || source.startAt
    || fallbackSource.startedAt
    || fallbackSource.startAt
    || ''
  );
  const enabled = Boolean(
    source.enabled
    ?? fallbackSource.enabled
    ?? (baseCount > 0 || incrementBy > 0)
  );

  return {
    enabled,
    baseCount,
    incrementBy,
    everyMinutes,
    startedAt,
  };
}

function normalizeManualLiveUpdates(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const items = normalizeLiveUpdateItems(
    source.items
    || source.queue
    || fallbackSource.items
    || fallbackSource.queue
    || []
  );
  const requestedMode = cleanText(
    source.mode
    || source.releaseMode
    || fallbackSource.mode
    || fallbackSource.releaseMode
    || ''
  ).toLowerCase();
  const hasScheduleFlag = Object.prototype.hasOwnProperty.call(source, 'scheduleEnabled')
    || Object.prototype.hasOwnProperty.call(fallbackSource, 'scheduleEnabled');
  const hasInterval = Object.prototype.hasOwnProperty.call(source, 'intervalMinutes')
    || Object.prototype.hasOwnProperty.call(source, 'everyMinutes')
    || Object.prototype.hasOwnProperty.call(fallbackSource, 'intervalMinutes')
    || Object.prototype.hasOwnProperty.call(fallbackSource, 'everyMinutes');
  const hasLegacyGapConfig = Object.prototype.hasOwnProperty.call(source, 'minGapMinutes')
    || Object.prototype.hasOwnProperty.call(source, 'maxGapMinutes')
    || Object.prototype.hasOwnProperty.call(source, 'intervalMin')
    || Object.prototype.hasOwnProperty.call(source, 'intervalMax')
    || Object.prototype.hasOwnProperty.call(fallbackSource, 'minGapMinutes')
    || Object.prototype.hasOwnProperty.call(fallbackSource, 'maxGapMinutes')
    || Object.prototype.hasOwnProperty.call(fallbackSource, 'intervalMin')
    || Object.prototype.hasOwnProperty.call(fallbackSource, 'intervalMax');
  const intervalMinutes = normalizeInteger(
    source.intervalMinutes
    ?? source.everyMinutes
    ?? fallbackSource.intervalMinutes
    ?? fallbackSource.everyMinutes
    ?? source.minGapMinutes
    ?? source.intervalMin
    ?? fallbackSource.minGapMinutes
    ?? fallbackSource.intervalMin
    ?? 10,
    10,
    { min: 1, max: 24 * 60 }
  );
  const scheduleEnabled = requestedMode === 'scheduled'
    || (requestedMode !== 'instant' && Boolean(
      source.scheduleEnabled
      ?? fallbackSource.scheduleEnabled
      ?? hasInterval
      ?? hasLegacyGapConfig
    ));
  const startedAt = normalizeIsoDateTime(
    source.startedAt
    || source.startAt
    || fallbackSource.startedAt
    || fallbackSource.startAt
    || ''
  );
  const enabled = Boolean(
    source.enabled
    ?? fallbackSource.enabled
    ?? items.length
  );

  return {
    enabled,
    startedAt,
    mode: scheduleEnabled ? 'scheduled' : 'instant',
    scheduleEnabled,
    intervalMinutes,
    minGapMinutes: intervalMinutes,
    maxGapMinutes: intervalMinutes,
    items,
  };
}

function hashSeed(value = '') {
  let hash = 2166136261;
  const normalized = String(value || '');
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveDeterministicStep(seed = '', index = 0, min = 10, max = 20) {
  const safeMin = Math.max(1, Number(min || 10));
  const safeMax = Math.max(safeMin, Number(max || safeMin));
  const spread = safeMax - safeMin + 1;
  return safeMin + (hashSeed(`${seed}:${index}`) % spread);
}

function resolveTimelineAnchor({
  startedAt = '',
  fallbackStartAt = '',
  publishedAt = '',
} = {}) {
  return normalizeIsoDateTime(startedAt || fallbackStartAt || publishedAt || '') || '';
}

function buildInstantLiveUpdateTimeline(items = [], { anchorMs = Date.now(), seed = 'sunwire-live' } = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (!sourceItems.length) return [];

  const nowMs = Date.now();
  const parsedTimes = sourceItems.map((item) => {
    const value = normalizeIsoDateTime(item?.scheduledAt || '');
    return value ? new Date(value).getTime() : NaN;
  });
  const hasBrokenTiming = parsedTimes.some((timeMs) => !Number.isFinite(timeMs) || timeMs > nowMs)
    || parsedTimes.some((timeMs, index) => index > 0 && timeMs <= parsedTimes[index - 1]);

  if (!hasBrokenTiming) {
    return sourceItems.map((item, index) => ({
      id: `${seed}-${index + 1}`,
      text: item.text,
      scheduledAt: new Date(parsedTimes[index]).toISOString(),
    }));
  }

  const startMs = Math.min(anchorMs, nowMs - ((sourceItems.length - 1) * 60 * 1000));
  return sourceItems.map((item, index) => ({
    id: `${seed}-${index + 1}`,
    text: item.text,
    scheduledAt: new Date(startMs + (index * 60 * 1000)).toISOString(),
  }));
}

function buildLiveUpdateTimeline(liveUpdates = {}, options = {}) {
  const normalized = normalizeManualLiveUpdates(liveUpdates);
  if (!normalized.enabled || !normalized.items.length) return [];

  const anchor = resolveTimelineAnchor({
    startedAt: normalized.startedAt,
    fallbackStartAt: options.fallbackStartAt,
    publishedAt: options.publishedAt,
  }) || new Date().toISOString();
  const anchorMs = new Date(anchor).getTime();
  if (Number.isNaN(anchorMs)) return [];

  const seed = cleanText(options.seed || options.articleId || options.slug || options.title || 'sunwire-live');

  if (normalized.mode !== 'scheduled') {
    return buildInstantLiveUpdateTimeline(normalized.items, {
      anchorMs,
      seed,
    });
  }

  let currentMs = anchorMs;

  return normalized.items.map((item, index) => {
    const existingScheduledAt = normalizeIsoDateTime(item?.scheduledAt || '');
    if (existingScheduledAt) {
      currentMs = new Date(existingScheduledAt).getTime();
    } else {
      currentMs += resolveDeterministicStep(
        seed,
        index,
        normalized.minGapMinutes,
        normalized.maxGapMinutes
      ) * 60 * 1000;
    }

    return {
      id: `${seed}-${index + 1}`,
      text: item.text,
      scheduledAt: existingScheduledAt || new Date(currentMs).toISOString(),
    };
  });
}

function getLiveUpdateSnapshot(liveUpdates = {}, options = {}) {
  const timeline = buildLiveUpdateTimeline(liveUpdates, options);
  if (!timeline.length) {
    return {
      items: [],
      active: [],
      next: null,
      total: 0,
    };
  }

  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  const asOfMs = Number.isNaN(asOf.getTime()) ? Date.now() : asOf.getTime();
  const active = timeline.filter((item) => new Date(item.scheduledAt).getTime() <= asOfMs);
  const next = timeline.find((item) => new Date(item.scheduledAt).getTime() > asOfMs) || null;

  return {
    items: timeline,
    active: active.slice().reverse(),
    next,
    total: timeline.length,
  };
}

function computeSyntheticVisitorCount(readerPulse = {}, options = {}) {
  const normalized = normalizeManualReaderPulse(readerPulse);
  if (!normalized.enabled) return 0;

  const anchor = resolveTimelineAnchor({
    startedAt: normalized.startedAt,
    fallbackStartAt: options.fallbackStartAt,
    publishedAt: options.publishedAt,
  });
  const anchorMs = anchor ? new Date(anchor).getTime() : NaN;
  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  const asOfMs = Number.isNaN(asOf.getTime()) ? Date.now() : asOf.getTime();
  const elapsedMs = Number.isNaN(anchorMs) ? 0 : Math.max(0, asOfMs - anchorMs);
  const increments = normalized.incrementBy > 0
    ? Math.floor(elapsedMs / (normalized.everyMinutes * 60 * 1000))
    : 0;

  return normalized.baseCount + (increments * normalized.incrementBy);
}

function normalizeAdminCategory(value = '') {
  const normalized = cleanText(value).toLowerCase();
  return ADMIN_CATEGORIES.includes(normalized) ? normalized : '';
}

function normalizeAdminPlacement(value = '') {
  const normalized = cleanText(value).toLowerCase();
  return ADMIN_PLACEMENTS.includes(normalized) ? normalized : 'headline';
}

function buildFeaturedOrderBy() {
  return [
    { is_featured: 'desc' },
    { featured_until: 'desc' },
    { created_at: 'desc' },
    { published_at: 'desc' },
  ];
}

async function expireFeaturedArticles(prisma) {
  if (isDatabaseCoolingDown()) {
    return { count: 0, skipped: true, coolingDown: true };
  }
  const nowMs = Date.now();
  if (nowMs - Number(featuredExpiryState.lastRunAt || 0) < FEATURED_EXPIRY_INTERVAL_MS) {
    return { count: 0, skipped: true };
  }

  featuredExpiryState.lastRunAt = nowMs;
  const now = new Date();
  return prisma.article.updateMany({
    where: {
      is_featured: true,
      featured_until: {
        lte: now,
      },
    },
    data: {
      is_featured: false,
      featured_until: null,
    },
  }).catch((error) => {
    markDatabasePressure(error);
    return { count: 0 };
  });
}

function buildManualSourceUrl({ slug = '', createdAt = new Date() } = {}) {
  const safeSlug = slugify(slug || 'manual-story');
  const stamp = new Date(createdAt).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `https://sunwire.in/manual/${safeSlug}-${stamp}`;
}

function trimToLength(value = '', maxLength = 240) {
  const normalized = cleanText(value);
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength);
  const boundary = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, boundary > Math.floor(maxLength * 0.6) ? boundary : maxLength).trim()}...`;
}

function normalizeManualParagraph(value = '') {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim();
}

function normalizeManualList(values = [], maxItems = 8) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeFactSheetRows(rows = [], maxItems = 8) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      label: cleanText(row?.label || ''),
      value: cleanText(row?.value || ''),
    }))
    .filter((row) => row.label && row.value)
    .slice(0, maxItems);
}

function normalizeBackgroundItems(items = [], maxItems = 6) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      title: cleanText(item?.title || ''),
      context: cleanText(item?.context || ''),
      url: cleanText(item?.url || ''),
      source: cleanText(item?.source || ''),
    }))
    .filter((item) => item.title && item.context)
    .slice(0, maxItems);
}

function parseManualRawContent(value = '') {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function buildManualRawContent({
  title = '',
  subheadline = '',
  content = '',
  source = '',
  authorName = '',
  primarySourceName = '',
  primarySourceUrl = '',
  imageUrl = '',
  category = '',
  tags = [],
  keyPoints = [],
  factSheet = [],
  background = [],
  indiaPulse = '',
  metaTitle = '',
  metaDescription = '',
  publishedAt = '',
  readerPulse = {},
  liveUpdates = {},
} = {}) {
  const normalizedContent = String(content || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((entry) => normalizeManualParagraph(entry))
    .filter(Boolean)
    .join('\n\n');
  const paragraphs = normalizedContent
    .split(/\n{2,}/)
    .map((entry) => normalizeManualParagraph(entry))
    .filter(Boolean);
  const normalizedTitle = cleanText(title || 'Story');
  const normalizedSubheadline = cleanText(subheadline || paragraphs[0] || normalizedContent);
  const normalizedSource = cleanText(source || 'Sunwire');
  const normalizedCategory = cleanText(category || 'ai').toLowerCase();
  const normalizedTags = normalizeManualList([
    ...normalizeManualList(tags, 8),
    normalizedCategory,
  ], 8);
  const normalizedKeyPoints = normalizeManualList(keyPoints, 6);
  const normalizedFactSheet = normalizeFactSheetRows(factSheet, 8);
  const normalizedBackground = normalizeBackgroundItems(background, 6);
  const normalizedIndiaPulse = cleanText(indiaPulse || '');
  const normalizedMetaTitle = cleanText(metaTitle || normalizedTitle);
  const normalizedReaderPulse = normalizeManualReaderPulse(readerPulse);
  const normalizedLiveUpdates = normalizeManualLiveUpdates(liveUpdates);
  const summary = trimToLength(normalizedSubheadline || normalizedContent, 240);
  const normalizedMetaDescription = trimToLength(
    metaDescription || summary || normalizedContent,
    160
  );
  const wordCount = Number(countWords(normalizedContent) || 0);

  return {
    slug: slugify(normalizedTitle),
    subheadline: summary,
    body: normalizedContent,
    summary,
    keyPoints: normalizedKeyPoints,
    deepDive: [],
    indiaPulse: normalizedIndiaPulse,
    background: normalizedBackground,
    factSheet: normalizedFactSheet,
    tags: normalizedTags,
    metaTitle: normalizedMetaTitle,
    metaDescription: normalizedMetaDescription,
    structuredData: null,
    primarySourceUrl: cleanText(primarySourceUrl || ''),
    primarySourceName: cleanText(primarySourceName || normalizedSource),
    authorName: normalizeAuthorName(authorName || 'Sunwire News Desk'),
    wordCount,
    estimatedReadingTime: Math.max(1, Math.ceil(Math.max(wordCount, 1) / 200)),
    ai_rewritten: true,
    rewriteStatus: 'manual_upload',
    manual_upload: true,
    featured_category: normalizedCategory,
    publishedAt,
    image: cleanText(imageUrl || ''),
    readerPulse: normalizedReaderPulse,
    liveUpdates: normalizedLiveUpdates,
  };
}

function toAdminArticleInput(record = {}) {
  const metadata = parseManualRawContent(record?.raw_content || '');
  const readerPulse = normalizeManualReaderPulse(metadata?.readerPulse || metadata?.reader_pulse || {});
  const liveUpdates = normalizeManualLiveUpdates(metadata?.liveUpdates || metadata?.live_updates || {});
  return {
    id: record?.id || '',
    headline: cleanText(record?.title || ''),
    subheadline: cleanText(metadata?.subheadline || record?.ai_summary || record?.summary || ''),
    source: cleanText(record?.source || ''),
    authorName: cleanText(metadata?.authorName || 'Sunwire News Desk'),
    primarySourceName: cleanText(metadata?.primarySourceName || record?.source || ''),
    primarySourceUrl: cleanText(metadata?.primarySourceUrl || ''),
    category: normalizeAdminCategory(record?.category || ''),
    image_url: cleanText(record?.image_storage_url || record?.image_url || metadata?.image || ''),
    content: String(metadata?.body || record?.content || '').replace(/\r/g, '').trim(),
    keyPoints: normalizeManualList(metadata?.keyPoints || [], 6),
    factSheet: normalizeFactSheetRows(metadata?.factSheet || [], 8),
    background: normalizeBackgroundItems(metadata?.background || [], 6),
    indiaPulse: cleanText(metadata?.indiaPulse || ''),
    tags: normalizeManualList(metadata?.tags || [], 8),
    metaTitle: cleanText(metadata?.metaTitle || record?.title || ''),
    metaDescription: cleanText(metadata?.metaDescription || record?.summary || ''),
    showOnHero: Boolean(record?.is_featured && new Date(record?.featured_until || '').getTime() > Date.now()),
    featuredUntil: record?.featured_until ? new Date(record.featured_until).toISOString() : '',
    createdAt: record?.created_at ? new Date(record.created_at).toISOString() : '',
    publishedAt: record?.published_at ? new Date(record.published_at).toISOString() : '',
    readerPulse,
    liveUpdates,
  };
}

module.exports = {
  ADMIN_CATEGORIES,
  ADMIN_PLACEMENTS,
  buildFeaturedOrderBy,
  buildLiveUpdateTimeline,
  buildManualRawContent,
  buildManualSourceUrl,
  computeSyntheticVisitorCount,
  expireFeaturedArticles,
  getLiveUpdateSnapshot,
  normalizeAdminCategory,
  normalizeAdminPlacement,
  normalizeManualLiveUpdates,
  normalizeManualReaderPulse,
  parseManualRawContent,
  toAdminArticleInput,
};
