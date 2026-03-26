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
const featuredExpiryState = globalThis.__SUNWIRE_FEATURED_EXPIRY_STATE__ || {
  lastRunAt: 0,
};

globalThis.__SUNWIRE_FEATURED_EXPIRY_STATE__ = featuredExpiryState;

function cleanText(value = '') {
  return String(value || '').trim();
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
  };
}

function toAdminArticleInput(record = {}) {
  const metadata = parseManualRawContent(record?.raw_content || '');
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
  };
}

module.exports = {
  ADMIN_CATEGORIES,
  ADMIN_PLACEMENTS,
  buildFeaturedOrderBy,
  buildManualRawContent,
  buildManualSourceUrl,
  expireFeaturedArticles,
  normalizeAdminCategory,
  normalizeAdminPlacement,
  parseManualRawContent,
  toAdminArticleInput,
};
