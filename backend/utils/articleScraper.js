const axios = require("axios");
const cheerio = require("cheerio");

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const VERGE_CONTAINER_SELECTORS = [
  'div[data-chorus-optimize-field="body"]',
  ".c-entry-content",
  ".duet--article--article-body-component",
  '[itemprop="articleBody"]',
  '[class*="article-body"]',
];

const GENERIC_CONTAINER_SELECTORS = [
  '[itemprop="articleBody"]',
  '[data-testid="article-body"]',
  ".article-body",
  ".article-content",
  ".entry-content",
  ".post-content",
  "main article",
  "article",
];

const REMOVE_SELECTORS = [
  "header",
  "nav",
  "footer",
  "aside",
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  '[role="navigation"]',
  '[aria-hidden="true"]',
  "[hidden]",
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[style*="visibility:hidden"]',
  '[style*="visibility: hidden"]',
  '[class*="share"]',
  '[class*="social"]',
  '[class*="newsletter"]',
  '[class*="sidebar"]',
  '[class*="related"]',
  '[class*="promo"]',
  '[class*="advert"]',
  '[class*="cookie"]',
  '[class*="modal"]',
  '[class*="drawer"]',
  '[id*="share"]',
  '[id*="social"]',
  '[id*="newsletter"]',
  '[id*="sidebar"]',
  '[id*="related"]',
  '[id*="advert"]',
];

const JUNK_PATTERNS = [
  /^(advertisement|ad|share|gift|follow|subscribe|sign up|read more|most popular|top stories)$/i,
  /^(tech|reviews|science|entertainment|ai|policy|streaming|news)$/i,
  /^(disclosure|correction):/i,
  /^update,\s+[a-z]+\s+\d{1,2}/i,
  /^image:/i,
  /^photo:/i,
  /^video:/i,
  /all rights reserved/i,
  /privacy policy/i,
  /terms of use/i,
  /cookie settings/i,
  /follow topics and authors/i,
  /posts from this (author|topic) will be added/i,
  /daily email digest/i,
];

function cleanText(value = "") {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getHostname(url = "") {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

function normalizeAbsoluteUrl(url = "", base = "") {
  try {
    return new URL(url, base).toString();
  } catch (_) {
    return cleanText(url);
  }
}

function isTheVergeUrl(url = "") {
  return /(^|\.)theverge\.com$/i.test(getHostname(url));
}

function shouldDropElement($node) {
  const signature = [
    $node.attr("class") || "",
    $node.attr("id") || "",
    $node.attr("role") || "",
    $node.attr("aria-label") || "",
    $node.attr("data-testid") || "",
  ].join(" ").toLowerCase();

  return /(share|social|newsletter|sidebar|related|promo|advert|cookie|comment|follow|subscribe|drawer|modal|topic-chip|most-popular)/i.test(signature);
}

function isJunkParagraph(text = "") {
  const normalized = cleanText(text);
  if (!normalized) return true;
  if (normalized.length < 25) return true;
  if (JUNK_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (normalized.split(/\s+/).length < 5) return true;
  return false;
}

function dedupeParagraphs(paragraphs = []) {
  const output = [];
  const seen = new Set();

  for (const paragraph of paragraphs) {
    const cleaned = cleanText(paragraph);
    if (isJunkParagraph(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }

  return output;
}

function buildScopedDom(htmlFragments = []) {
  return cheerio.load(`<section id="article-root">${htmlFragments.join("\n")}</section>`);
}

function extractParagraphsFromMatches($, matches) {
  if (!matches?.length) return [];

  const fragments = matches.toArray().map((element) => $.html(element)).filter(Boolean);
  if (!fragments.length) return [];

  const $$ = buildScopedDom(fragments);
  const $scope = $$("#article-root");
  $scope.find(REMOVE_SELECTORS.join(", ")).remove();
  $scope.find("*").each((_, element) => {
    const $node = $$(element);
    if (shouldDropElement($node)) {
      $node.remove();
    }
  });

  return dedupeParagraphs(
    $scope
      .find("p")
      .toArray()
      .map((element) => $$(element).text())
  );
}

function extractJsonLdParagraphs($) {
  const paragraphs = [];

  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const payload = JSON.parse($(element).contents().text());
      const queue = Array.isArray(payload) ? [...payload] : [payload];

      while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== "object") continue;

        const articleBody = cleanText(current.articleBody || "");
        if (articleBody) {
          paragraphs.push(...articleBody.split(/\n+/));
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

  return dedupeParagraphs(paragraphs);
}

function extractArticleFromHtml(html = "", sourceUrl = "") {
  const pageHtml = String(html || "");
  if (!pageHtml.trim()) {
    return {
      selectorUsed: "",
      paragraphs: [],
      content: "",
    };
  }

  const $ = cheerio.load(pageHtml);
  const selectorGroups = isTheVergeUrl(sourceUrl)
    ? [VERGE_CONTAINER_SELECTORS, GENERIC_CONTAINER_SELECTORS]
    : [GENERIC_CONTAINER_SELECTORS];

  for (const selectors of selectorGroups) {
    for (const selector of selectors) {
      const paragraphs = extractParagraphsFromMatches($, $(selector));
      if (paragraphs.length) {
        return {
          selectorUsed: selector,
          paragraphs,
          content: paragraphs.join("\n\n"),
        };
      }
    }
  }

  const jsonLdParagraphs = extractJsonLdParagraphs($);
  return {
    selectorUsed: jsonLdParagraphs.length ? "jsonld.articleBody" : "",
    paragraphs: jsonLdParagraphs,
    content: jsonLdParagraphs.join("\n\n"),
  };
}

function extractImageUrlFromHtml(html = "", sourceUrl = "") {
  const $ = cheerio.load(String(html || ""));
  const candidate =
    $("meta[property='og:image']").attr("content")
    || $("meta[name='twitter:image']").attr("content")
    || $("meta[property='og:image:url']").attr("content")
    || $("article img").first().attr("src")
    || $("main img").first().attr("src")
    || $("img").first().attr("src")
    || "";

  return normalizeAbsoluteUrl(candidate, sourceUrl);
}

async function scrapeArticle(url) {
  if (!url || typeof url !== "string") {
    throw new Error("scrapeArticle requires a valid URL string");
  }

  let response;
  try {
    response = await axios.get(url, {
      timeout: 8000,
      headers: REQUEST_HEADERS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
  } catch (error) {
    throw new Error(`Failed to fetch article: ${error.message}`);
  }

  const finalUrl = response.request?.res?.responseUrl || url;
  const extracted = extractArticleFromHtml(response.data, finalUrl);

  if (!extracted.content) {
    throw new Error(`No article paragraphs found for ${finalUrl}`);
  }

  return {
    url: finalUrl,
    selectorUsed: extracted.selectorUsed,
    paragraphs: extracted.paragraphs,
    content: extracted.content,
    imageUrl: extractImageUrlFromHtml(response.data, finalUrl),
  };
}

module.exports = {
  cleanText,
  extractArticleFromHtml,
  isTheVergeUrl,
  scrapeArticle,
};
