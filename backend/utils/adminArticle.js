const { slugify } = require('../../lib/seo');
const { normalizeAuthorName } = require('../../lib/article/googleNews');
const { countWords } = require('../services/contentQuality');

const ADMIN_CATEGORIES = [
  'ai',
  'tech',
  'entertainment',
  'sports',
  'politics',
  'business',
  'jobs',
  'food',
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
  }).catch(() => ({ count: 0 }));
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

function buildManualRawContent({
  title = '',
  subheadline = '',
  content = '',
  source = '',
  imageUrl = '',
  category = '',
  placement = 'headline',
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
  const normalizedPlacement = cleanText(placement || 'headline').toLowerCase();
  const summary = trimToLength(normalizedSubheadline || normalizedContent, 240);
  const wordCount = Number(countWords(normalizedContent) || 0);

  return {
    slug: slugify(normalizedTitle),
    subheadline: summary,
    body: normalizedContent,
    summary,
    keyPoints: [],
    deepDive: [],
    indiaPulse: '',
    background: [],
    factSheet: [],
    tags: [normalizedCategory].filter(Boolean),
    metaTitle: normalizedTitle,
    metaDescription: trimToLength(summary || normalizedContent, 160),
    structuredData: null,
    primarySourceUrl: '',
    primarySourceName: normalizedSource,
    authorName: normalizeAuthorName('Sunwire News Desk'),
    wordCount,
    estimatedReadingTime: Math.max(1, Math.ceil(Math.max(wordCount, 1) / 200)),
    ai_rewritten: true,
    rewriteStatus: 'manual_upload',
    manual_upload: true,
    featured_category: normalizedCategory,
    placement: normalizedPlacement,
    publishedAt,
    image: cleanText(imageUrl || ''),
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
};
