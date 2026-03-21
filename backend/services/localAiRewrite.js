const axios = require('axios');
const {
  cleanText,
  countWords,
  stripSourceBoilerplate,
} = require('../../lib/article/shared');

const DEFAULT_AI_PROVIDER = 'ollama';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.1:8b';
const OLLAMA_CHAT_PATH = '/api/chat';
const OLLAMA_TIMEOUT_MS = 300000;
const MAX_REWRITE_INPUT_CHARS = 18000;
const MAX_OLLAMA_INPUT_CHARS = 4200;
const IMPORTANT_SENTENCE_LIMIT = 24;
const OLLAMA_NUM_PREDICT = 360;
const MIN_REWRITTEN_WORDS = 140;
const PREFERRED_REWRITE_WORDS = 220;
const MIN_REWRITTEN_PARAGRAPHS = 2;

const CLEANUP_LINE_PATTERNS = [
  /^\s*(advertisement|ad|sponsored)\s*$/i,
  /^\s*read more\b.*$/i,
  /^\s*click here\b.*$/i,
  /^\s*watch\b.*$/i,
  /^\s*listen\b.*$/i,
  /^\s*subscribe\b.*$/i,
  /^\s*follow us\b.*$/i,
  /^\s*sign up\b.*$/i,
  /^\s*newsletter\b.*$/i,
  /^\s*skip to content\b.*$/i,
  /^\s*share\b.*$/i,
];

const ASSISTANT_JUNK_PATTERNS = [
  /^\s*here is the rewritten article\b.*$/i,
  /^\s*sure,\s*here'?s\b.*$/i,
  /^\s*let me know\b.*$/i,
  /^\s*i can also\b.*$/i,
  /^\s*here'?s\b.*$/i,
  /^\s*certainly\b.*$/i,
  /^\s*assistant\s*:\s*.*$/i,
];

function getLocalAiConfig() {
  const provider = String(process.env.AI_PROVIDER || DEFAULT_AI_PROVIDER).trim().toLowerCase() || DEFAULT_AI_PROVIDER;
  const baseUrl = String(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_OLLAMA_BASE_URL;
  const model = String(process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL;

  return {
    provider,
    baseUrl,
    model,
    chatUrl: `${baseUrl}${OLLAMA_CHAT_PATH}`,
  };
}

function isLocalAiRewriteEnabled() {
  return getLocalAiConfig().provider === DEFAULT_AI_PROVIDER;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTemperature(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getOllamaRuntimeConfig() {
  const timeoutMs = parsePositiveInt(process.env.OLLAMA_TIMEOUT_MS, OLLAMA_TIMEOUT_MS);
  return {
    timeoutMs,
    inputChars: parsePositiveInt(process.env.OLLAMA_INPUT_CHARS, MAX_OLLAMA_INPUT_CHARS),
    sentenceLimit: parsePositiveInt(process.env.OLLAMA_SENTENCE_LIMIT, IMPORTANT_SENTENCE_LIMIT),
    numPredict: parsePositiveInt(process.env.OLLAMA_NUM_PREDICT, OLLAMA_NUM_PREDICT),
    numCtx: parsePositiveInt(process.env.OLLAMA_NUM_CTX, 4096),
    temperature: parseTemperature(process.env.OLLAMA_TEMPERATURE, 0.7),
    preferredMinWords: parsePositiveInt(process.env.OLLAMA_PREFERRED_MIN_WORDS, PREFERRED_REWRITE_WORDS),
    retry: {
      timeoutMs,
      inputChars: Math.max(1200, Math.floor(MAX_OLLAMA_INPUT_CHARS * 0.8)),
      sentenceLimit: Math.max(12, Math.floor(IMPORTANT_SENTENCE_LIMIT * 0.8)),
      numPredict: Math.max(260, Math.floor(OLLAMA_NUM_PREDICT * 0.8)),
      numCtx: 3072,
      temperature: 0.6,
      preferredMinWords: parsePositiveInt(process.env.OLLAMA_PREFERRED_MIN_WORDS, PREFERRED_REWRITE_WORDS),
    },
  };
}

function normalizeRewriteOutput(text = '') {
  let cleaned = String(text || '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/\r/g, '')
    .replace(/^\s*(?:sure,\s*)?here'?s(?:\s+the\s+rewritten\s+article)?\s*:?\s*/i, '')
    .replace(/^\s*assistant\s*:\s*/i, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .trim();

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim());

  while (lines.length && (!lines[0] || ASSISTANT_JUNK_PATTERNS.some((pattern) => pattern.test(lines[0])))) {
    lines.shift();
  }

  if (lines.length > 1 && /^(?:#{1,6}\s*.+|[A-Z0-9][A-Za-z0-9'",:()\- ]{12,120})$/.test(lines[0])) {
    lines.shift();
  }

  cleaned = lines
    .filter((line) => !line || !ASSISTANT_JUNK_PATTERNS.some((pattern) => pattern.test(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
}

function logFallbackTriggered() {
  console.log('FINAL RESULT: FALLBACK TRIGGERED');
}

function cleanArticleTextForRewrite(text = '') {
  const stripped = String(stripSourceBoilerplate(text || ''))
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+\b/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n');

  const paragraphs = stripped
    .replace(/\r/g, '')
    .split(/\n{1,}/)
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => line.length > 25)
    .filter((line) => !CLEANUP_LINE_PATTERNS.some((pattern) => pattern.test(line)));

  const deduped = [];
  const seen = new Set();
  for (const paragraph of paragraphs) {
    const key = paragraph.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(paragraph);
  }

  return deduped.join('\n\n').slice(0, MAX_REWRITE_INPUT_CHARS).trim();
}

function extractImportantContent(text = '', options = {}) {
  const normalized = cleanText(String(text || '').replace(/\s+/g, ' '));
  if (!normalized) return '';
  const maxChars = parsePositiveInt(options.inputChars, MAX_OLLAMA_INPUT_CHARS);
  const sentenceLimit = parsePositiveInt(options.sentenceLimit, IMPORTANT_SENTENCE_LIMIT);

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanText(sentence))
    .filter(Boolean);

  if (!sentences.length) {
    return normalized.slice(0, maxChars).trim();
  }

  return sentences
    .slice(0, sentenceLimit)
    .join(' ')
    .slice(0, maxChars)
    .trim();
}

function buildRewritePrompt(cleanedArticle = '', options = {}, runtime = {}) {
  const preferredMinWords = parsePositiveInt(runtime.preferredMinWords, PREFERRED_REWRITE_WORDS);
  const preferredMaxWords = Math.max(preferredMinWords + 80, preferredMinWords + 120);
  return {
    system: [
      'Rewrite the article in a clear, engaging, SEO-friendly way.',
      'Keep meaning same.',
      'Avoid plagiarism.',
      'Use only facts from the source.',
      'Preserve names, dates, numbers, and quotes.',
      `Write at least ${preferredMinWords} words, ideally ${preferredMinWords}-${preferredMaxWords} words.`,
      'Return only the rewritten article body in 4 to 6 short paragraphs.',
      'Do not write a short summary.',
      'Do not use bullets or headings.',
    ].join(' '),
    user: cleanedArticle,
  };
}

function validateRewrittenArticle(text = '') {
  const content = normalizeRewriteOutput(text);
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => cleanText(paragraph))
    .filter(Boolean);
  const contentLines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const wordCount = countWords(content);
  const reasons = [];

  if (!content) reasons.push('article_content_missing');
  if (content && wordCount < MIN_REWRITTEN_WORDS) reasons.push(`final_word_count_below_${MIN_REWRITTEN_WORDS}`);
  if (paragraphs.length < MIN_REWRITTEN_PARAGRAPHS) reasons.push('paragraphs_missing');
  if (contentLines.some((line) => ASSISTANT_JUNK_PATTERNS.some((pattern) => pattern.test(line)))) reasons.push('assistant_style_junk');

  return {
    ok: reasons.length === 0,
    content,
    wordCount,
    paragraphCount: paragraphs.length,
    reasons,
  };
}

function stringifyForLog(value) {
  if (value == null) return value;
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function logOllamaRequestFailure(error, config) {
  console.error('ollama_request_failed', {
    requestUrl: config.chatUrl,
    modelName: config.model,
    timeout: config.timeoutMs || OLLAMA_TIMEOUT_MS,
    isChatEndpoint: config.chatUrl.endsWith(OLLAMA_CHAT_PATH),
    axiosMessage: axios.isAxiosError(error)
      ? error.message
      : String(error?.message || error || 'Unknown Ollama request error'),
    responseStatus: error?.response?.status ?? null,
    responseBody: stringifyForLog(error?.response?.data),
  });
}

async function requestOllamaRewrite(config, prompt, runtime) {
  const response = await axios.post(
    config.chatUrl,
    {
      model: config.model,
      stream: false,
      messages: [
        {
          role: 'user',
          content: `${prompt.system}\n\n${prompt.user}`,
        },
      ],
      options: {
        num_predict: runtime.numPredict,
        num_ctx: runtime.numCtx,
        temperature: runtime.temperature,
      },
    },
    {
      timeout: runtime.timeoutMs,
    }
  );

  return (
    response?.data?.message?.content ||
    response?.data?.response ||
    ''
  );
}

async function rewriteArticleLocally(sourceContent = '', options = {}) {
  const config = getLocalAiConfig();
  const runtime = getOllamaRuntimeConfig(config.model);
  if (config.provider !== DEFAULT_AI_PROVIDER) {
    logFallbackTriggered();
    return null;
  }

  const cleanedArticle = cleanArticleTextForRewrite(sourceContent);
  if (!cleanedArticle) {
    logFallbackTriggered();
    return null;
  }

  let importantContent = extractImportantContent(cleanedArticle, runtime);
  if (!importantContent) {
    logFallbackTriggered();
    return null;
  }

  console.log('ollama_request_content_lengths', {
    originalLength: cleanedArticle.length,
    trimmedLength: importantContent.length,
  });

  try {
    let aiText = '';
    let validation = null;
    try {
      const prompt = buildRewritePrompt(importantContent, options, runtime);
      aiText = await requestOllamaRewrite(config, prompt, runtime);
    } catch (error) {
      if (!runtime.retry || !axios.isAxiosError(error) || !/timeout/i.test(error.message || '')) {
        throw error;
      }

      console.log('Retrying Ollama rewrite with smaller prompt for model:', config.model);
      importantContent = extractImportantContent(cleanedArticle, runtime.retry);
      if (!importantContent) {
        throw error;
      }

      const retryPrompt = buildRewritePrompt(importantContent, options, runtime.retry);
      aiText = await requestOllamaRewrite(config, retryPrompt, runtime.retry);
    }

    console.log('AI RAW OUTPUT:\n', aiText);
    console.log('WORD COUNT:', countWords(aiText));

    const normalized = normalizeRewriteOutput(aiText);
    validation = validateRewrittenArticle(normalized);

    if (validation.ok && validation.wordCount < parsePositiveInt(runtime.preferredMinWords, PREFERRED_REWRITE_WORDS) && runtime.retry) {
      console.log('Rewrite shorter than preferred target, retrying for longer output.');
      const longerPrompt = buildRewritePrompt(importantContent, options, {
        ...runtime.retry,
        preferredMinWords: parsePositiveInt(runtime.preferredMinWords, PREFERRED_REWRITE_WORDS),
      });
      const retryText = await requestOllamaRewrite(config, longerPrompt, runtime.retry);
      console.log('AI RAW OUTPUT (LENGTH RETRY):\n', retryText);
      console.log('WORD COUNT (LENGTH RETRY):', countWords(retryText));

      const retryNormalized = normalizeRewriteOutput(retryText);
      const retryValidation = validateRewrittenArticle(retryNormalized);
      if (retryValidation.ok && retryValidation.wordCount >= validation.wordCount) {
        validation = retryValidation;
      }
    }

    if (!validation.ok) {
      console.log('Rewrite rejected:', validation.reasons);
      logFallbackTriggered();
      return null;
    }

    return validation.content;
  } catch (error) {
    logOllamaRequestFailure(error, { ...config, timeoutMs: runtime.timeoutMs });
    logFallbackTriggered();
    return null;
  }
}

module.exports = {
  DEFAULT_AI_PROVIDER,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_CHAT_PATH,
  cleanArticleTextForRewrite,
  extractImportantContent,
  getLocalAiConfig,
  isLocalAiRewriteEnabled,
  rewriteArticleLocally,
  validateRewrittenArticle,
};
