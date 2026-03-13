const prisma = require('../config/database');
const { isDuplicate } = require('../utils/deduplicator');
const { logEvent } = require('../utils/logger');
const { pipelineState } = require('./newsIngestor');
const { invalidateCache } = require('../utils/cache');
const { slugify } = require('../../lib/seo');
const { normalizeHeadlineForComparison } = require('./contentQuality');
const {
  buildArticlesFromTopics,
  classifyCategory,
  normalizeTitle,
} = require('./journalisticPipeline');

function rewriteHeadline(title = '') {
  return normalizeTitle(title);
}

function createHeadlineRegistry(existingArticles = []) {
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
    select: {
      id: true,
      title: true,
      summary: true,
      source_url: true,
    },
  });
  const headlineRegistry = createHeadlineRegistry(recentArticles);

  const generatedArticles = await buildArticlesFromTopics(rawArticles, {
    headlineExists: (title) => headlineRegistry.exists(title),
  });
  let inserted = 0;
  let duplicatesSkipped = 0;
  const workingSet = [...recentArticles];

  for (const processed of generatedArticles) {
    try {
      const duplicate = isDuplicate({
        title: processed.title,
        source_url: processed.source_url,
      }, workingSet, 0.86);
      if (duplicate) {
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

      const saved = await prisma.article.upsert({
        where: { source_url: processed.source_url },
        update: {
          title: processed.title,
          slug: processed.slug || slugify(processed.title || 'story'),
          summary: processed.summary,
          ai_summary: processed.subheadline,
          content: processed.content || processed.summary || processed.subheadline || processed.title,
          word_count: Number(processed.word_count || 0) || null,
          raw_content: processed.raw_content,
          image_url: processed.image_url,
          image_storage_url: processed.image_storage_url,
          category: processed.category,
          source: processed.source,
          published_at: new Date(processed.published_at || new Date().toISOString()),
          shares: processed.shares,
          views: processed.views,
        },
        create: {
          title: processed.title,
          slug: processed.slug || slugify(processed.title || 'story'),
          summary: processed.summary,
          ai_summary: processed.subheadline,
          content: processed.content || processed.summary || processed.subheadline || processed.title,
          word_count: Number(processed.word_count || 0) || null,
          raw_content: processed.raw_content,
          image_url: processed.image_url,
          image_storage_url: processed.image_storage_url,
          category: processed.category,
          source: processed.source,
          source_url: processed.source_url,
          published_at: new Date(processed.published_at || new Date().toISOString()),
          shares: processed.shares,
          views: processed.views,
        },
        select: {
          id: true,
          title: true,
          source_url: true,
          summary: true,
          word_count: true,
        },
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
  classifyCategory,
  createHeadlineRegistry,
  rewriteHeadline,
  processRawArticle,
  processPendingArticles,
};
