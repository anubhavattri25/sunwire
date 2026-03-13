const {
  cleanText,
  extractTopicKeywords,
  sentenceLooksFactual,
  sentenceMatchesTopic,
  toSentences,
} = require('../../lib/article/shared');

function cleanContent(content = '') {
  return cleanText(String(content).replace(/<[^>]+>/g, ' '));
}

function heuristicSummary(content = '', title = '') {
  const cleaned = cleanContent(content);
  const topicKeywords = extractTopicKeywords(title, cleaned);
  const sentences = toSentences(cleaned)
    .map((sentence) => cleanText(sentence))
    .filter(Boolean)
    .filter((sentence) => sentenceLooksFactual(sentence))
    .filter((sentence) => sentenceMatchesTopic(sentence, topicKeywords, 1));

  const chosen = [];
  for (const sentence of sentences) {
    if (chosen.length >= 2) break;
    if (chosen.some((entry) => entry.toLowerCase() === sentence.toLowerCase())) continue;
    chosen.push(sentence);
  }

  return chosen.join(' ').split(/\s+/).slice(0, 60).join(' ').trim();
}

async function generateSummary(content = '', options = {}) {
  return heuristicSummary(content, options.title || '');
}

module.exports = {
  generateSummary,
};
