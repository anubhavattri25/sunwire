function normalizeForSimilarity(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildBigrams(value = '') {
  const normalized = ` ${normalizeForSimilarity(value)} `;
  const map = new Map();

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const gram = normalized.slice(index, index + 2);
    map.set(gram, (map.get(gram) || 0) + 1);
  }

  return map;
}

function stringSimilarity(left = '', right = '') {
  const normalizedLeft = normalizeForSimilarity(left);
  const normalizedRight = normalizeForSimilarity(right);

  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const leftBigrams = buildBigrams(normalizedLeft);
  const rightBigrams = buildBigrams(normalizedRight);

  let overlap = 0;
  let leftCount = 0;
  let rightCount = 0;

  leftBigrams.forEach((count, gram) => {
    leftCount += count;
    overlap += Math.min(count, rightBigrams.get(gram) || 0);
  });

  rightBigrams.forEach((count) => {
    rightCount += count;
  });

  if (!leftCount || !rightCount) return 0;

  return (2 * overlap) / (leftCount + rightCount);
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
