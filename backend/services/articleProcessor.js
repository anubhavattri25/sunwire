const prisma = require('../config/database');
const { logEvent } = require('../utils/logger');
const { pipelineState } = require('./newsIngestor');
const { slugify } = require('../../lib/seo');
const {
  MIN_INDEXABLE_ARTICLE_WORDS,
  buildIndexableArticlePayload,
  normalizeAuthorName,
} = require('../../lib/article/googleNews');
const { normalizeTitle } = require('../utils/articleUtils');
const { generateSummary } = require('./summaryGenerator');
const {
  countWords,
} = require('./contentQuality');
const {
  buildPublisherReview,
} = require('../../lib/article/publisherReview');
const {
  DESK_CATEGORY_CHOICES,
  classifyArticleCategoryLocally,
  cleanArticleTextForRewrite,
  getLocalAiConfig,
  isLocalAiRewriteEnabled,
  rewriteArticleLocally,
} = require('./localAiRewrite');

const EXISTING_ARTICLE_SELECT = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  content: true,
  raw_content: true,
  word_count: true,
  image_url: true,
  image_storage_url: true,
  category: true,
  source: true,
  source_url: true,
  published_at: true,
  views: true,
  shares: true,
};

const SAVED_ARTICLE_SELECT = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  content: true,
  raw_content: true,
  word_count: true,
  image_url: true,
  image_storage_url: true,
  category: true,
  source: true,
  source_url: true,
  published_at: true,
  views: true,
  shares: true,
};

function getDuplicateMatcher() {
  return require('../utils/deduplicator').isDuplicate;
}

function getHeadlineNormalizer() {
  return require('./contentQuality').normalizeHeadlineForComparison;
}

function rewriteHeadline(title = '') {
  return normalizeTitle(title);
}

function normalizeArticleCategory(value = '', fallback = 'general') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized || fallback;
}

function isTopicalDeskCategory(value = '') {
  return DESK_CATEGORY_CHOICES.includes(normalizeArticleCategory(value));
}

function shouldSkipAiCategoryClassification() {
  return process.env.SUNWIRE_SKIP_AI_CATEGORY_CLASSIFICATION === '1';
}

function shouldSkipSearchIndexing() {
  return process.env.SUNWIRE_SKIP_SEARCH_INDEXING === '1';
}

function parseRawContentMetadata(value = '') {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function stringifyRawContentMetadata(metadata = {}) {
  try {
    return JSON.stringify(metadata);
  } catch (_) {
    return JSON.stringify({
      rewriteStatus: 'fallback_used',
      rewriteError: 'metadata_stringify_failed',
      ai_rewritten: false,
    });
  }
}

function buildArticleSlug(article = {}) {
  return slugify(article.slug || article.title || 'story');
}

function buildSlugDateSuffix(value = '') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

async function resolveUniqueArticleSlug(article = {}, existingArticle = null) {
  const baseSlug = buildArticleSlug(article);
  const dateSuffix = buildSlugDateSuffix(article.published_at || existingArticle?.published_at || '');
  const candidates = [
    baseSlug,
    dateSuffix ? `${baseSlug}-${dateSuffix}` : '',
  ].filter(Boolean);

  let counter = 2;
  while (candidates.length < 10) {
    candidates.push(`${baseSlug}-${dateSuffix || 'story'}-${counter}`);
    counter += 1;
  }

  for (const candidate of candidates) {
    const collision = await prisma.article.findFirst({
      where: { slug: candidate },
      select: { id: true, source_url: true },
    }).catch(() => null);

    if (!collision) return candidate;
    if (existingArticle?.id && collision.id === existingArticle.id) return candidate;
    if (article.source_url && collision.source_url === article.source_url) return candidate;
  }

  return `${baseSlug}-${Date.now()}`;
}

function createExistingArticleRegistry(existingArticles = []) {
  const bySourceUrl = new Map();
  const bySlug = new Map();

  function remember(article = {}) {
    const sourceUrl = String(article.source_url || '').trim();
    const slug = buildArticleSlug(article);

    if (sourceUrl) bySourceUrl.set(sourceUrl, article);
    if (slug) bySlug.set(slug, article);
  }

  existingArticles.forEach(remember);

  return {
    find(article = {}) {
      const sourceUrl = String(article.source_url || '').trim();
      const slug = buildArticleSlug(article);

      if (sourceUrl && bySourceUrl.has(sourceUrl)) return bySourceUrl.get(sourceUrl);
      if (slug && bySlug.has(slug)) return bySlug.get(slug);
      return null;
    },
    remember,
  };
}

async function findExistingArticle(article = {}, options = {}) {
  if (options.existingArticle?.id) {
    return options.existingArticle;
  }

  if (options.existingRegistry?.find) {
    const cached = options.existingRegistry.find(article);
    if (cached) return cached;
  }

  const sourceUrl = String(article.source_url || '').trim();
  if (sourceUrl) {
    const bySourceUrl = await prisma.article.findUnique({
      where: {
        source_url: sourceUrl,
      },
      select: EXISTING_ARTICLE_SELECT,
    }).catch(() => null);

    if (bySourceUrl) {
      if (options.existingRegistry?.remember) {
        options.existingRegistry.remember(bySourceUrl);
      }
      return bySourceUrl;
    }
  }

  const slug = buildArticleSlug(article);
  if (!slug) return null;

  const existing = await prisma.article.findFirst({
    where: {
      slug,
    },
    select: EXISTING_ARTICLE_SELECT,
  }).catch(() => null);

  if (existing && options.existingRegistry?.remember) {
    options.existingRegistry.remember(existing);
  }

  return existing;
}

function getStoredRewriteState(article = {}) {
  const metadata = parseRawContentMetadata(article.raw_content);
  const content = String(article.content || metadata.body || '').trim();
  const summary = String(article.summary || metadata.sourceSummary || '').trim();
  const aiRewritten = Boolean(
    article.ai_rewritten ||
    metadata.ai_rewritten ||
    metadata.rewriteStatus === 'ai_rewritten'
  );
  const rewriteStatus = String(
    article.rewriteStatus ||
    metadata.rewriteStatus ||
    (aiRewritten ? 'ai_rewritten' : 'fallback_used')
  ).trim();
  const wordCount = Number(article.word_count || metadata.wordCount || countWords(content) || 0);

  return {
    metadata,
    content,
    summary,
    aiRewritten,
    rewriteStatus,
    wordCount,
  };
}

async function rewriteArticleContent(item = {}, sourceContent = '', options = {}) {
  const existingArticle = options.existingArticle || null;
  const existingState = getStoredRewriteState(existingArticle || {});
  const candidateSourceContent =
    sourceContent ||
    existingState.metadata.sourceBody ||
    existingState.metadata.originalContent ||
    existingState.content ||
    '';
  const cleanedSourceContent = cleanArticleTextForRewrite(candidateSourceContent);
  const baseSummary = String(item.summary || '').trim();
  const fallbackSummary =
    baseSummary ||
    cleanedSourceContent.slice(0, 220) ||
    existingState.summary ||
    String(candidateSourceContent || '').trim().slice(0, 220);
  const aiConfig = getLocalAiConfig();
  const rewriteMetadata = {
    ...existingState.metadata,
    sourceBody: cleanedSourceContent,
    originalContent: cleanedSourceContent,
    sourceSummary: baseSummary,
    rawSourcePayload: item.raw_source_payload || existingState.metadata.rawSourcePayload || null,
    rewriteProvider: aiConfig.provider,
    rewriteModel: '',
    rewriteStatus: 'fallback_used',
    rewriteError: '',
    ai_rewritten: false,
    primarySourceUrl: item.source_url || existingArticle?.source_url || existingState.metadata.primarySourceUrl || '',
    primarySourceName: item.source || existingArticle?.source || existingState.metadata.primarySourceName || '',
    classifiedCategory: normalizeArticleCategory(item.category || existingArticle?.category || existingState.metadata.classifiedCategory || 'general'),
    categoryOrigin: existingState.metadata.categoryOrigin || 'source',
  };

  if (existingState.aiRewritten && existingState.content) {
    console.log('Rewrite success:', item.title, '(cached)');

    return {
      summary: existingState.summary || fallbackSummary,
      content: existingState.content,
      word_count: existingState.wordCount || countWords(existingState.content),
      raw_content: existingArticle?.raw_content || stringifyRawContentMetadata({
        ...rewriteMetadata,
        rewriteModel: existingState.metadata.rewriteModel || aiConfig.model,
        rewriteStatus: 'ai_rewritten',
        ai_rewritten: true,
        body: existingState.content,
        wordCount: existingState.wordCount || countWords(existingState.content),
        estimatedReadingTime: Math.max(2, Math.ceil((existingState.wordCount || countWords(existingState.content)) / 200)),
      }),
      ai_rewritten: true,
      rewrite_status: 'ai_rewritten',
    };
  }

  if (!cleanedSourceContent) {
    return {
      summary: fallbackSummary,
      content: existingState.content || '',
      word_count: 0,
      raw_content: stringifyRawContentMetadata(rewriteMetadata),
      ai_rewritten: false,
      rewrite_status: 'fallback_used',
    };
  }

  let finalContent = cleanedSourceContent;
  let rewriteStatus = 'fallback_used';
  let rewriteError = '';
  let aiRewritten = false;
  let classifiedCategory = normalizeArticleCategory(item.category || existingArticle?.category || 'general');
  let categoryOrigin = 'source';

  if (isLocalAiRewriteEnabled()) {
    let rewritten = null;
    try {
      rewritten = await rewriteArticleLocally(cleanedSourceContent, {
        topic: item.title,
        source: item.source,
      });
    } catch (error) {
      console.log('Rewrite error:', error.message);
    }

    if (rewritten) {
      finalContent = rewritten;
      rewriteStatus = 'ai_rewritten';
      aiRewritten = true;
      console.log('Rewrite success:', item.title);
      logEvent('article.rewrite.succeeded', {
        title: item.title,
        source_url: item.source_url,
        provider: aiConfig.provider,
        model: aiConfig.model,
        word_count: countWords(rewritten),
      });
    } else {
      rewriteError = 'ollama_request_failed';
      console.log('Rewrite fallback used:', item.title);
      logEvent('article.rewrite.fallback', {
        title: item.title,
        source_url: item.source_url,
        provider: aiConfig.provider,
        model: aiConfig.model,
        reason: rewriteError,
      });
    }
  } else {
    rewriteError = `provider:${aiConfig.provider}`;
    console.log('Rewrite fallback used:', item.title);
    logEvent('article.rewrite.fallback', {
      title: item.title,
      source_url: item.source_url,
      provider: aiConfig.provider,
      model: aiConfig.model,
      reason: 'provider_disabled',
    });
  }

  const generatedSummary = await generateSummary(finalContent, {
    title: item.title,
  }).catch(() => '');
  const wordCount = countWords(finalContent);
  if (!shouldSkipAiCategoryClassification()) {
    const aiCategory = await classifyArticleCategoryLocally(finalContent || cleanedSourceContent, {
      topic: item.title,
      source: item.source,
    }).catch(() => '');
    if (isTopicalDeskCategory(aiCategory)) {
      classifiedCategory = aiCategory;
      categoryOrigin = 'ai_classified';
    }
  }

  return {
    summary: generatedSummary || fallbackSummary,
    content: finalContent,
    word_count: wordCount,
    raw_content: stringifyRawContentMetadata({
      ...rewriteMetadata,
      classifiedCategory,
      categoryOrigin,
      rewriteModel: aiRewritten ? aiConfig.model : '',
      rewriteStatus,
      rewriteError,
      ai_rewritten: aiRewritten,
      body: finalContent,
      wordCount,
      estimatedReadingTime: Math.max(2, Math.ceil(wordCount / 200)),
    }),
    ai_rewritten: aiRewritten,
    rewrite_status: rewriteStatus,
  };
}

async function buildArticlesFromTopics(rawArticles, options = {}) {
  const articles = [];

  for (const item of rawArticles) {
    const normalizedItem = {
      ...item,
      title: rewriteHeadline(item.title || 'Untitled'),
      category: normalizeArticleCategory(item.category || 'general'),
    };
    const existingArticle = await findExistingArticle(normalizedItem, options);
    const content =
      normalizedItem.content ||
      normalizedItem.summary ||
      normalizedItem.snippet ||
      existingArticle?.content ||
      normalizedItem.title ||
      '';

    if (!content || content.length < 100) continue;
    const rewritten = await rewriteArticleContent(normalizedItem, content, {
      existingArticle,
    });

    const rewrittenMetadata = parseRawContentMetadata(rewritten.raw_content);
    const effectiveCategory = normalizeArticleCategory(
      rewrittenMetadata.classifiedCategory
      || normalizedItem.category
      || existingArticle?.category
      || 'general'
    );

    articles.push({
      title: normalizedItem.title,
      slug: existingArticle?.slug || buildArticleSlug(normalizedItem),
      summary: rewritten.summary,
      content: rewritten.content,
      image_url: normalizedItem.image_url || existingArticle?.image_url || '',
      image_storage_url: normalizedItem.image_storage_url || existingArticle?.image_storage_url || '',
      category: effectiveCategory,
      source: normalizedItem.source || existingArticle?.source || 'Unknown',
      source_url: normalizedItem.source_url || existingArticle?.source_url || '',
      published_at: normalizedItem.published_at || existingArticle?.published_at || new Date().toISOString(),
      views: Number(normalizedItem.views || existingArticle?.views || 0),
      shares: Number(normalizedItem.shares || existingArticle?.shares || 0),
      word_count: rewritten.word_count,
      raw_content: rewritten.raw_content,
      ai_rewritten: rewritten.ai_rewritten,
      rewriteStatus: rewritten.rewrite_status,
      existing_id: existingArticle?.id || null,
    });
  }

  return articles;
}

async function buildPersistedArticleData(article = {}, existingArticle = null) {
  const existingState = getStoredRewriteState(existingArticle || {});
  const incomingMetadata = parseRawContentMetadata(article.raw_content);
  const incomingAiRewritten = Boolean(
    article.ai_rewritten ||
    incomingMetadata.ai_rewritten ||
    incomingMetadata.rewriteStatus === 'ai_rewritten'
  );
  const preserveExistingRewrite = existingState.aiRewritten && !incomingAiRewritten;
  const baseContent = preserveExistingRewrite
    ? existingState.content
    : String(article.content || article.summary || article.subheadline || article.title || '').trim();
  const baseSummary = preserveExistingRewrite
    ? String(existingArticle?.summary || article.summary || '').trim()
    : String(article.summary || '').trim();
  const title = String(article.title || existingArticle?.title || 'Untitled').trim();
  const category = normalizeArticleCategory(article.category || existingArticle?.category || 'general');
  const publishedAt = article.published_at || existingArticle?.published_at || new Date().toISOString();
  const imageUrl = article.image_storage_url || article.image_url || existingArticle?.image_storage_url || existingArticle?.image_url || '';
  const source = article.source || existingArticle?.source || 'Unknown';
  const sourceUrl = article.source_url || existingArticle?.source_url || '';
  const uniqueSlug = await resolveUniqueArticleSlug({
    ...article,
    title,
    source_url: sourceUrl,
    published_at: publishedAt,
  }, existingArticle);
  const authorName = normalizeAuthorName(incomingMetadata.authorName || article.author_name || '');
  const indexable = buildIndexableArticlePayload({
    id: existingArticle?.id || article.existing_id || '',
    slug: uniqueSlug,
    title,
    summary: baseSummary,
    body: baseContent,
    source,
    sourceUrl,
    image: imageUrl,
    category,
    publishedAt,
    modifiedAt: existingArticle?.published_at || publishedAt,
    tags: Array.isArray(incomingMetadata.tags) ? incomingMetadata.tags : [],
    related: Array.isArray(incomingMetadata.coverage) ? incomingMetadata.coverage : [],
    authorName,
    metaTitle: incomingMetadata.metaTitle || '',
    metaDescription: incomingMetadata.metaDescription || '',
    primarySourceUrl: incomingMetadata.primarySourceUrl || sourceUrl,
    primarySourceName: incomingMetadata.primarySourceName || source,
  });
  const content = String(indexable.body || baseContent || '').trim();
  const summary = String(indexable.summary || baseSummary || '').trim();
  const wordCount = Number(indexable.wordCount || article.word_count || incomingMetadata.wordCount || countWords(content) || 0) || null;
  const mergedMetadata = {
    ...(preserveExistingRewrite ? existingState.metadata : {}),
    ...incomingMetadata,
    slug: uniqueSlug,
    body: content,
    summary,
    keyPoints: indexable.keyPoints,
    deepDive: indexable.deepDive,
    indiaPulse: indexable.indiaPulse,
    background: indexable.background,
    factSheet: indexable.factSheet,
    tags: indexable.tags,
    metaTitle: indexable.metaTitle,
    metaDescription: indexable.metaDescription,
    structuredData: indexable.structuredData,
    primarySourceUrl: indexable.primarySourceUrl,
    primarySourceName: indexable.primarySourceName,
    authorName: indexable.authorName,
    wordCount,
    estimatedReadingTime: indexable.estimatedReadingTime,
    sourceSummary: summary,
  };
  const publisherReview = buildPublisherReview({
    title,
    summary,
    content,
    raw_content: stringifyRawContentMetadata(mergedMetadata),
    source,
    source_url: sourceUrl,
    word_count: wordCount,
    ai_rewritten: preserveExistingRewrite ? existingState.aiRewritten : article.ai_rewritten,
    rewriteStatus: preserveExistingRewrite ? existingState.rewriteStatus : article.rewriteStatus,
    manual_upload: Boolean(existingArticle?.manual_upload || article.manual_upload),
  }, { metadata: mergedMetadata });
  mergedMetadata.publisherReview = publisherReview;

  return {
    title,
    slug: uniqueSlug,
    summary,
    content,
    word_count: wordCount,
    raw_content: stringifyRawContentMetadata(mergedMetadata),
    image_url: article.image_url || existingArticle?.image_url || null,
    image_storage_url: article.image_storage_url || existingArticle?.image_storage_url || null,
    category,
    source,
    source_url: sourceUrl,
    published_at: new Date(publishedAt || new Date()),
    views: Number(article.views || existingArticle?.views || 0),
    shares: Number(article.shares || existingArticle?.shares || 0),
    ai_summary: article.subheadline || null,
  };
}

async function saveArticle(article, options = {}) {
  console.log('Saving article:', article.title);

  const existingArticle = article.existing_id
    ? await prisma.article.findUnique({
        where: { id: article.existing_id },
        select: EXISTING_ARTICLE_SELECT,
      }).catch(() => null)
    : await findExistingArticle(article, options);
  const data = await buildPersistedArticleData(article, existingArticle);
  const persistedMetadata = parseRawContentMetadata(data.raw_content);
  const publisherReview = buildPublisherReview({
    title: data.title,
    summary: data.summary,
    content: data.content,
    raw_content: data.raw_content,
    source: data.source,
    source_url: data.source_url,
    word_count: data.word_count,
    ai_rewritten: article.ai_rewritten,
    rewriteStatus: article.rewriteStatus,
    manual_upload: Boolean(existingArticle?.manual_upload || article.manual_upload),
  }, { metadata: persistedMetadata });
  if (!data.content || Number(data.word_count || 0) < MIN_INDEXABLE_ARTICLE_WORDS) {
    logEvent('article.rejected', {
      stage: 'persist',
      reasons: [`final_word_count_below_${MIN_INDEXABLE_ARTICLE_WORDS}`],
      title: article.title,
      source_url: article.source_url || null,
    });
    return null;
  }
  if (!publisherReview.eligibleForPublisherNetwork) {
    logEvent('article.rejected', {
      stage: 'publisher_review',
      reasons: publisherReview.reasons,
      title: article.title,
      source_url: article.source_url || null,
    });
    return null;
  }
  const saved = existingArticle
    ? await prisma.article.update({
        where: { id: existingArticle.id },
        data,
        select: SAVED_ARTICLE_SELECT,
      })
    : await prisma.article.create({
        data,
        select: SAVED_ARTICLE_SELECT,
      });

  if (options.existingRegistry?.remember) {
    options.existingRegistry.remember(saved);
  }

  return saved;
}
function createHeadlineRegistry(existingArticles = []) {
  const normalizeHeadlineForComparison = getHeadlineNormalizer();
  const knownHeadlines = new Set(
    existingArticles
      .map((entry) => normalizeHeadlineForComparison(entry.title || ''))
      .filter(Boolean)
  );
  const cache = new Map();

  return {
    async exists(title = '') {
      const normalized = normalizeHeadlineForComparison(title);
      if (!normalized) return false;
      if (knownHeadlines.has(normalized)) return true;
      if (cache.has(normalized)) return cache.get(normalized);

      const exact = await prisma.article.findFirst({
        where: {
          OR: [
            { slug: slugify(title || 'story') },
            { title: title || '' },
          ],
        },
        select: {
          id: true,
          title: true,
        },
      }).catch(() => null);

      const exists = Boolean(exact);
      cache.set(normalized, exists);
      if (exists) knownHeadlines.add(normalized);
      return exists;
    },
    remember(title = '') {
      const normalized = normalizeHeadlineForComparison(title);
      if (!normalized) return;
      knownHeadlines.add(normalized);
      cache.set(normalized, true);
    },
  };
}

async function processRawArticle(article = {}, recentArticles = [], options = {}) {
  const isDuplicate = getDuplicateMatcher();
  const [processed] = await buildArticlesFromTopics([{
    ...article,
    title: rewriteHeadline(article.title || 'Untitled'),
    category: normalizeArticleCategory(article.category || 'general'),
  }], {
    headlineExists: options.headlineExists,
  });

  if (!processed) return null;

  const duplicate = isDuplicate({
    title: processed.title,
    source_url: processed.source_url,
  }, recentArticles, 0.86);

  if (duplicate) {
    logEvent('article.rejected', {
      stage: 'publish',
      reasons: ['duplicate_source_or_similarity'],
      title: processed.title,
      source_url: processed.source_url,
      duplicateOf: duplicate.source_url || duplicate.id || duplicate.title,
    });
    return null;
  }

  return processed;
}

async function processPendingArticles(rawArticles = pipelineState.pendingRawArticles) {
  const isDuplicate = getDuplicateMatcher();
  logEvent('scheduler.process.start', { pending: rawArticles.length });
  if (!Array.isArray(rawArticles) || rawArticles.length === 0) {
    pipelineState.lastProcessAt = new Date().toISOString();
    logEvent('articles.processed', { processed: 0, inserted: 0, duplicatesSkipped: 0 });
    return { processed: 0, inserted: 0, duplicatesSkipped: 0 };
  }

  const recentArticles = await prisma.article.findMany({
    where: {
      created_at: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    },
    select: EXISTING_ARTICLE_SELECT,
  });
  const headlineRegistry = createHeadlineRegistry(recentArticles);
  const existingRegistry = createExistingArticleRegistry(recentArticles);

  const generatedArticles = await buildArticlesFromTopics(rawArticles, {
    existingRegistry,
    headlineExists: (title) => headlineRegistry.exists(title),
  });
  let inserted = 0;
  let duplicatesSkipped = 0;
  const workingSet = [...recentArticles];

  for (const processed of generatedArticles) {
    try {
      const matchedExisting = existingRegistry.find(processed);
      const isExistingRecord = Boolean(processed.existing_id || matchedExisting?.id);
      const duplicate = isExistingRecord
        ? null
        : isDuplicate({
            title: processed.title,
            source_url: processed.source_url,
          }, workingSet, 0.86);

      if (duplicate && !isExistingRecord) {
        duplicatesSkipped += 1;
        logEvent('article.rejected', {
          stage: 'publish',
          reasons: ['duplicate_source_or_similarity'],
          title: processed.title,
          source_url: processed.source_url,
          duplicateOf: duplicate.source_url || duplicate.id || duplicate.title,
        });
        continue;
      }

      const saved = await saveArticle(processed, {
        existingArticle: matchedExisting,
        existingRegistry,
      });
      if (!saved) {
        continue;
      }

      inserted += 1;
      workingSet.push(saved);
      headlineRegistry.remember(saved.title || processed.title);
      logEvent('article.published', {
        id: saved.id,
        title: saved.title,
        category: processed.category,
        source: processed.source,
        workflow: 'strict_journalistic_v2',
      });
    } catch (error) {
      logEvent('article.process.error', {
        title: processed?.title || 'Untitled',
        source_url: processed?.source_url || null,
        message: error.message,
      });
    }
  }

  pipelineState.lastProcessAt = new Date().toISOString();
  pipelineState.pendingRawArticles = [];
  const { invalidateCache } = require('../utils/cache');
  await invalidateCache();
  if (inserted > 0 && !shouldSkipSearchIndexing()) {
    const { submitSearchConsoleSitemaps } = require('../utils/searchIndexing');
    await submitSearchConsoleSitemaps().catch(() => null);
  }

  logEvent('articles.processed', {
    processed: generatedArticles.length,
    inserted,
    duplicatesSkipped,
    seedCount: rawArticles.length,
  });

  return {
    processed: generatedArticles.length,
    inserted,
    duplicatesSkipped,
  };
}

module.exports = {
  saveArticle,
  buildArticlesFromTopics,
  createHeadlineRegistry,
  rewriteHeadline,
  processRawArticle,
  processPendingArticles,
};
