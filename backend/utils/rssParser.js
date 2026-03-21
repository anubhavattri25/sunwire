const Parser = require("rss-parser");
const axios = require("axios");
const cheerio = require("cheerio");
const {
  cleanText,
  decodeXml,
  fetchTextNoCache,
  summaryFromText,
  stripSourceBoilerplate,
} = require("../../lib/article/shared");
const { extractArticleFromHtml, isTheVergeUrl } = require("./articleScraper");

const parser = new Parser({
  timeout: 10000,
  customFields: {
    item: ["media:content", "media:thumbnail", "content:encoded", "description"],
  },
});

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const ARTICLE_ROOT_SELECTORS = [
  "article",
  "main article",
  "[itemprop='articleBody']",
  "[data-testid='article-body']",
  "[data-component='text-block']",
  ".article-body",
  ".story-body",
  ".story-content",
  ".caas-body",
  ".content__article-body",
  ".zn-body__paragraph",
  ".story__content",
  ".post-content",
  ".entry-content",
  ".ArticleBody-articleBody",
  ".RichTextStoryBody",
  ".article-content",
  ".article__content",
  ".body__inner-container",
  ".main-content",
  "#main-content",
];

const SCRAPE_BLOCKLIST = [
  /^(advertisement|ad|follow us|sign up|subscribe|listen|watch|read more)$/i,
  /cookie/i,
  /newsletter/i,
  /terms of use/i,
  /privacy policy/i,
  /all rights reserved/i,
  /join our/i,
  /supported by/i,
  /download the app/i,
];

function isHttpUrl(value = "") {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function isGoogleNewsUrl(value = "") {
  try {
    const parsed = new URL(value);
    return /(^|\.)news\.google\.com$/i.test(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function normalizeAbsoluteUrl(url = "", base = "") {
  try {
    return new URL(url, base).toString();
  } catch (_) {
    return cleanText(url);
  }
}

function cleanParagraphText(value = "") {
  return cleanText(stripSourceBoilerplate(decodeXml(String(value || ""))))
    .replace(/\s{2,}/g, " ")
    .trim();
}

function shouldKeepParagraph(value = "") {
  const text = cleanParagraphText(value);
  if (!text || text.length < 60) return false;
  if (SCRAPE_BLOCKLIST.some((pattern) => pattern.test(text))) return false;
  if (/^(photo|image|video):/i.test(text)) return false;
  return true;
}

function dedupeParagraphs(paragraphs = []) {
  const output = [];
  const seen = new Set();

  for (const paragraph of paragraphs) {
    const cleaned = cleanParagraphText(paragraph);
    if (!shouldKeepParagraph(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }

  return output;
}

function extractParagraphs($, root) {
  const container = root && root.length ? root : $("body");
  const paragraphs = dedupeParagraphs(
    container
      .find("p, li")
      .toArray()
      .map((element) => $(element).text())
  );

  if (paragraphs.length) return paragraphs;

  const fallbackText = cleanParagraphText(container.text());
  return shouldKeepParagraph(fallbackText) ? [fallbackText] : [];
}

function scoreCandidateRoot($, element) {
  const root = $(element);
  const paragraphs = extractParagraphs($, root);
  if (!paragraphs.length) return 0;

  const text = paragraphs.join(" ");
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const paragraphCount = paragraphs.length;
  const linkWordCount = cleanText(root.find("a").text()).split(/\s+/).filter(Boolean).length;

  return wordCount + (paragraphCount * 24) - Math.min(linkWordCount, Math.floor(wordCount / 3));
}

function chooseBestArticleRoot($) {
  const candidates = [];
  const seen = new Set();

  ARTICLE_ROOT_SELECTORS.forEach((selector) => {
    $(selector).each((_, element) => {
      const root = $(element);
      const signature = `${element.tagName}|${root.attr("class") || ""}|${root.attr("id") || ""}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      candidates.push({
        root,
        score: scoreCandidateRoot($, element),
      });
    });
  });

  return candidates
    .sort((left, right) => right.score - left.score)[0]?.root || null;
}

function extractJsonLdArticles($) {
  const items = [];

  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const parsed = JSON.parse($(element).contents().text());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];

      while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== "object") continue;

        const types = Array.isArray(current["@type"]) ? current["@type"] : [current["@type"]];
        if (types.some((entry) => /article|newsarticle|reportage/i.test(String(entry || "")))) {
          items.push(current);
        }

        Object.values(current).forEach((value) => {
          if (!value || typeof value !== "object") return;
          if (Array.isArray(value)) {
            value.forEach((entry) => queue.push(entry));
            return;
          }
          queue.push(value);
        });
      }
    } catch (_) {
      // Ignore malformed JSON-LD blocks.
    }
  });

  return items;
}

function extractArticleBodyWithCheerio(html = "", options = {}) {
  const pageHtml = String(html || "");
  if (!pageHtml.trim()) {
    return {
      title: cleanText(options.title || ""),
      summary: "",
      body: "",
      imageUrl: "",
    };
  }

  const $ = cheerio.load(pageHtml);
  $("script, style, noscript, iframe, svg, form, nav, header, footer, aside").remove();

  const targetedExtraction = extractArticleFromHtml(pageHtml, options.url || "");
  const jsonLdArticles = extractJsonLdArticles($);
  const jsonLdBody = jsonLdArticles
    .map((entry) => cleanText(entry.articleBody || ""))
    .find((entry) => entry.split(/\s+/).filter(Boolean).length >= 200);

  const bestRoot = chooseBestArticleRoot($);
  const paragraphBody = extractParagraphs($, bestRoot).join("\n\n");
  const fallbackBody = extractParagraphs($, $("main, body").first()).join("\n\n");
  const preferredBody = isTheVergeUrl(options.url || "") ? targetedExtraction.content : "";
  const body = cleanText(stripSourceBoilerplate(preferredBody || jsonLdBody || paragraphBody || fallbackBody))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const metaDescription = $("meta[property='og:description']").attr("content")
    || $("meta[name='description']").attr("content")
    || jsonLdArticles.map((entry) => cleanText(entry.description || "")).find(Boolean)
    || "";
  const title = cleanText(
    $("meta[property='og:title']").attr("content")
    || jsonLdArticles.map((entry) => cleanText(entry.headline || "")).find(Boolean)
    || $("h1").first().text()
    || options.title
    || ""
  );

  return {
    title,
    summary: cleanText(metaDescription || summaryFromText(body, "")),
    body,
    imageUrl: normalizeAbsoluteUrl(
      $("meta[property='og:image']").attr("content")
      || $("meta[name='twitter:image']").attr("content")
      || "",
      options.url
    ),
  };
}

function extractGoogleArticleId(url = "") {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const marker = parts.findIndex((segment) => segment === "articles" || segment === "read");
    if (marker === -1) return "";
    return parts[marker + 1] || "";
  } catch (_) {
    return "";
  }
}

function decodeGoogleArticleIdFromBase64(articleId = "") {
  if (!articleId) return "";

  try {
    const normalized = articleId.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
    const match = decoded.match(/https?:\/\/[^\s"'<>\u0000-\u001f]+/i);
    return match?.[0] || "";
  } catch (_) {
    return "";
  }
}

async function fetchGoogleDecodeParams(url = "") {
  const response = await axios.get(url, {
    timeout: 10000,
    headers: REQUEST_HEADERS,
  });
  const $ = cheerio.load(String(response.data || ""));
  const node = $("c-wiz > div[data-n-a-sg][data-n-a-ts]").first();
  const signature = node.attr("data-n-a-sg") || "";
  const timestamp = node.attr("data-n-a-ts") || "";

  if (!signature || !timestamp) {
    throw new Error("Google News decode params missing");
  }

  return { signature, timestamp };
}

function extractBatchDecodedUrl(responseText = "") {
  const match = String(responseText || "").match(/"garturlres","(.*?)"/);
  if (!match?.[1]) return "";

  try {
    return JSON.parse(`"${match[1].replace(/"/g, "\\\"")}"`);
  } catch (_) {
    return "";
  }
}

async function decodeGoogleArticleIdViaBatch(url = "", articleId = "") {
  if (!url || !articleId) return "";

  const { signature, timestamp } = await fetchGoogleDecodeParams(url);
  const rpcRequest = [[
    "Fbv4je",
    JSON.stringify([
      "garturlreq",
      [
        ["en-US", "US", ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"], null, null, 1, 1, "US:en", null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]],
        articleId,
        Number(timestamp),
        signature,
      ],
    ]),
    null,
    "generic",
  ]];
  const payload = `f.req=${encodeURIComponent(JSON.stringify([rpcRequest]))}`;

  const response = await axios.post(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
    payload,
    {
      timeout: 10000,
      headers: {
        ...REQUEST_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
    }
  );

  return extractBatchDecodedUrl(response.data);
}

async function resolveGoogleNewsUrl(url = "") {
  if (!isGoogleNewsUrl(url)) return cleanText(url);

  try {
    const parsed = new URL(url);
    const queryUrl = parsed.searchParams.get("url");
    if (isHttpUrl(queryUrl)) return queryUrl;
  } catch (_) {
    // Fall through to ID decoding.
  }

  const articleId = extractGoogleArticleId(url);
  const decodedFromBase64 = decodeGoogleArticleIdFromBase64(articleId);
  if (isHttpUrl(decodedFromBase64) && !isGoogleNewsUrl(decodedFromBase64)) {
    return decodedFromBase64;
  }

  try {
    const decodedFromBatch = await decodeGoogleArticleIdViaBatch(url, articleId);
    if (isHttpUrl(decodedFromBatch) && !isGoogleNewsUrl(decodedFromBatch)) {
      return decodedFromBatch;
    }
  } catch (_) {
    // Fall through to redirect resolution.
  }

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: REQUEST_HEADERS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const finalUrl = response.request?.res?.responseUrl || "";
    if (isHttpUrl(finalUrl) && !isGoogleNewsUrl(finalUrl)) return finalUrl;
  } catch (_) {
    // Return the original URL below.
  }

  return cleanText(url);
}

async function fetchPublisherArticle(url = "", options = {}) {
  if (!isHttpUrl(url)) {
    return {
      url: cleanText(url),
      title: cleanText(options.title || ""),
      summary: "",
      body: "",
      imageUrl: "",
    };
  }

  const response = await axios.get(url, {
    timeout: 12000,
    headers: REQUEST_HEADERS,
    maxRedirects: 5,
  });
  const finalUrl = response.request?.res?.responseUrl || url;
  const extracted = extractArticleBodyWithCheerio(response.data, {
    ...options,
    url: finalUrl,
  });

  return {
    url: finalUrl,
    ...extracted,
  };
}

async function parseRssFeed(url) {
  const xml = await fetchTextNoCache(url, {
    timeoutMs: 10000,
    headers: REQUEST_HEADERS,
  });
  return parser.parseString(xml);
}

module.exports = {
  extractArticleBodyWithCheerio,
  fetchPublisherArticle,
  isGoogleNewsUrl,
  parseRssFeed,
  resolveGoogleNewsUrl,
};
