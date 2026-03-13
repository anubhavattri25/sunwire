const prisma = require('../config/database');
const { articleSelect } = require('../models/Article');
const { logEvent } = require('../utils/logger');
const { pipelineState } = require('./newsIngestor');

function recencyBoost(date) {
  const publishedAt = new Date(date);
  if (Number.isNaN(publishedAt.getTime())) return 0;
  const ageMs = Date.now() - publishedAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 1) return 20;
  if (ageHours < 3) return 10;
  return 0;
}

function calculateTrendingScore(article = {}) {
  const viewsLastHour = Number(article.views || 0);
  const shares = Number(article.shares || 0);
  return (viewsLastHour * 3) + (shares * 4) + recencyBoost(article.published_at || article.created_at);
}

async function updateTrendingScores() {
  logEvent('scheduler.trending.start');
  const articles = await prisma.article.findMany({ select: articleSelect });
  if (!articles.length) {
    pipelineState.lastTrendingUpdateAt = new Date().toISOString();
    logEvent('trending.updated', { updated: 0 });
    return 0;
  }

  const updates = articles.map((article) => prisma.article.update({
    where: { id: article.id },
    data: { trending_score: calculateTrendingScore(article) },
  }));

  await prisma.$transaction(updates);
  pipelineState.lastTrendingUpdateAt = new Date().toISOString();
  logEvent('trending.updated', { updated: articles.length });
  return articles.length;
}

module.exports = {
  calculateTrendingScore,
  updateTrendingScores,
};
