const { stringSimilarity } = require('string-similarity-js');

function normalizeForSimilarity(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDuplicate(candidate, existingArticles = [], threshold = 0.88) {
  const sourceUrl = candidate.source_url || candidate.sourceUrl || '';
  const candidateTitle = normalizeForSimilarity(candidate.title || '');

  return existingArticles.find((article) => {
    if (sourceUrl && article.source_url === sourceUrl) return true;
    const existingTitle = normalizeForSimilarity(article.title || '');
    if (!candidateTitle || !existingTitle) return false;
    return stringSimilarity(candidateTitle, existingTitle) >= threshold;
  }) || null;
}

module.exports = {
  isDuplicate,
  normalizeForSimilarity,
};
