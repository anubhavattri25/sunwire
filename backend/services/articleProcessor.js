const prisma = require('../config/database');
const { logEvent } = require('../utils/logger');
const { pipelineState } = require('./newsIngestor');
const { slugify } = require('../../lib/seo');
const { normalizeTitle, classifyCategory } = require('../utils/articleUtils');
const { generateSummary } = require('./summaryGenerator');
const {
  countWords,
} = require('./contentQuality');
const {
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

  return {
    summary: generatedSummary || fallbackSummary,
    content: finalContent,
    word_count: wordCount,
    raw_content: stringifyRawContentMetadata({
      ...rewriteMetadata,
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
      category: item.category || classifyCategory(item),
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

    articles.push({
      title: normalizedItem.title,
      slug: existingArticle?.slug || buildArticleSlug(normalizedItem),
      summary: rewritten.summary,
      content: rewritten.content,
      image_url: normalizedItem.image_url || existingArticle?.image_url || '',
      image_storage_url: normalizedItem.image_storage_url || existingArticle?.image_storage_url || '',
      category: normalizedItem.category || existingArticle?.category || 'general',
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

function buildPersistedArticleData(article = {}, existingArticle = null) {
  const existingState = getStoredRewriteState(existingArticle || {});
  const incomingMetadata = parseRawContentMetadata(article.raw_content);
  const incomingAiRewritten = Boolean(
    article.ai_rewritten ||
    incomingMetadata.ai_rewritten ||
    incomingMetadata.rewriteStatus === 'ai_rewritten'
  );
  const preserveExistingRewrite = existingState.aiRewritten && !incomingAiRewritten;
  const content = preserveExistingRewrite
    ? existingState.content
    : String(article.content || article.summary || article.subheadline || article.title || '').trim();
  const summary = preserveExistingRewrite
    ? String(existingArticle?.summary || article.summary || '').trim()
    : String(article.summary || '').trim();
  const wordCount = preserveExistingRewrite
    ? Number(existingArticle?.word_count || existingState.wordCount || 0) || null
    : Number(article.word_count || incomingMetadata.wordCount || countWords(content) || 0) || null;

  return {
    title: article.title,
    slug: buildArticleSlug(article),
    summary,
    content,
    word_count: wordCount,
    raw_content: preserveExistingRewrite
      ? existingArticle?.raw_content || article.raw_content || null
      : article.raw_content || existingArticle?.raw_content || null,
    image_url: article.image_url || existingArticle?.image_url || null,
    image_storage_url: article.image_storage_url || existingArticle?.image_storage_url || null,
    category: article.category || existingArticle?.category || 'general',
    source: article.source || existingArticle?.source || 'Unknown',
    source_url: article.source_url || existingArticle?.source_url || '',
    published_at: new Date(article.published_at || existingArticle?.published_at || new Date()),
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
  const data = buildPersistedArticleData(article, existingArticle);
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
    category: article.category || classifyCategory(article),
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
