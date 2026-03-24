const Parser = require("rss-parser");
const axios = require("axios");
const cheerio = require("cheerio");
const { XMLParser, XMLValidator } = require("fast-xml-parser");
const {
  cleanText,
  decodeXml,
  fetchTextNoCache,
  summaryFromText,
  stripSourceBoilerplate,
} = require("../../lib/article/shared");
const { extractArticleFromHtml, isTheVergeUrl } = require("./articleScraper");

const parser = new Parser({
  timeout: 8000,
  customFields: {
    item: ["media:content", "media:thumbnail", "content:encoded", "description"],
  },
});
const tolerantXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  parseTagValue: false,
  trimValues: false,
});
const xmlValidationOptions = {
  allowBooleanAttributes: true,
};

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

function sanitizeXmlFeed(xml = "") {
  const trimmed = String(xml || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, "")
    .trim();
  const firstMarkupIndex = trimmed.indexOf("<");
  const markupOnly = firstMarkupIndex >= 0 ? trimmed.slice(firstMarkupIndex) : trimmed;
  return markupOnly.replace(
    /&(?!#\d+;|#x[\da-fA-F]+;|[a-zA-Z][a-zA-Z0-9]+;)/g,
    "&amp;"
  );
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readNodeText(value = "") {
  if (typeof value === "string" || typeof value === "number") {
    return cleanText(String(value));
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  return cleanText(
    value["#text"]
    || value.text
    || value.title
    || value.content
    || value.value
    || ""
  );
}

function firstNonEmptyValue(values = []) {
  for (const value of values) {
    const normalized = readNodeText(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeXmlLink(linkValue = "", baseUrl = "") {
  for (const candidate of toArray(linkValue)) {
    if (typeof candidate === "string") {
      const normalized = normalizeAbsoluteUrl(candidate, baseUrl);
      if (isHttpUrl(normalized)) return normalized;
      continue;
    }

    if (candidate && typeof candidate === "object") {
      const normalized = normalizeAbsoluteUrl(
        candidate.href || candidate.url || candidate.src || candidate["#text"] || "",
        baseUrl
      );
      if (isHttpUrl(normalized)) return normalized;
    }
  }

  return "";
}

function normalizeXmlMediaNode(value = "", baseUrl = "") {
  for (const candidate of toArray(value)) {
    if (typeof candidate === "string") {
      const normalized = normalizeAbsoluteUrl(candidate, baseUrl);
      if (isHttpUrl(normalized)) return normalized;
      continue;
    }

    if (candidate && typeof candidate === "object") {
      const normalized = normalizeAbsoluteUrl(
        candidate.url
        || candidate.href
        || candidate.src
        || candidate.content
        || candidate["#text"]
        || "",
        baseUrl
      );
      if (isHttpUrl(normalized)) return normalized;
    }
  }

  return "";
}

function normalizeParsedFeedItem(item = {}, baseUrl = "") {
  const link = normalizeXmlLink(item.link || item.guid || "", baseUrl);
  const enclosureUrl = normalizeXmlMediaNode(item.enclosure || "", baseUrl);
  const mediaContentUrl = normalizeXmlMediaNode(item["media:content"] || item.mediaContent || "", baseUrl);
  const mediaThumbUrl = normalizeXmlMediaNode(item["media:thumbnail"] || item.mediaThumbnail || "", baseUrl);
  const isoDate = firstNonEmptyValue([item.isoDate, item.published, item.updated, item.pubDate, item.date]);

  return {
    title: firstNonEmptyValue([item.title]),
    link,
    guid: firstNonEmptyValue([item.guid, link]),
    content: firstNonEmptyValue([item["content:encoded"], item.content, item["content:encodedSnippet"]]),
    contentSnippet: firstNonEmptyValue([item.contentSnippet, item.summary, item.description, item.subtitle]),
    summary: firstNonEmptyValue([item.summary, item.description, item.subtitle]),
    description: firstNonEmptyValue([item.description, item.summary, item.contentSnippet]),
    isoDate,
    pubDate: firstNonEmptyValue([item.pubDate, item.published, item.updated, isoDate]),
    enclosure: enclosureUrl ? { url: enclosureUrl } : undefined,
    "media:content": mediaContentUrl ? { url: mediaContentUrl } : undefined,
    "media:thumbnail": mediaThumbUrl ? { url: mediaThumbUrl } : undefined,
    creator: firstNonEmptyValue([item.creator, item.author?.name, item.author]),
    source: firstNonEmptyValue([item.source?.title, item.source]),
  };
}

function normalizeParsedFeed(parsed = {}, baseUrl = "") {
  const rssRoot = parsed.rss || parsed["rdf:RDF"] || null;
  if (rssRoot) {
    const channel = toArray(rssRoot.channel)[0] || rssRoot.channel || {};
    return {
      title: firstNonEmptyValue([channel.title]),
      items: toArray(channel.item).map((item) => normalizeParsedFeedItem(item, baseUrl)),
    };
  }

  const atomFeed = parsed.feed || {};
  return {
    title: firstNonEmptyValue([atomFeed.title]),
    items: toArray(atomFeed.entry).map((entry) => normalizeParsedFeedItem({
      title: entry.title,
      link: entry.link,
      guid: entry.id,
      content: entry.content,
      contentSnippet: entry.summary,
      summary: entry.summary,
      description: entry.summary,
      isoDate: entry.updated || entry.published,
      pubDate: entry.published || entry.updated,
      enclosure: entry.enclosure,
      "media:content": entry["media:content"],
      "media:thumbnail": entry["media:thumbnail"],
      author: entry.author,
      source: atomFeed.title,
    }, baseUrl)),
  };
}

function extractImageFromElement($, element, baseUrl = "") {
  const candidate = [
    $(element).attr("data-src"),
    $(element).attr("data-lazy-src"),
    $(element).attr("data-original"),
    $(element).attr("src"),
    $(element).find("img").first().attr("src"),
    $(element).find("img").first().attr("data-src"),
    $(element).find("img").first().attr("data-lazy-src"),
    $(element).find("img").first().attr("data-original"),
    $(element).find("img").first().attr("srcset"),
    $(element).find("img").first().attr("data-srcset"),
  ]
    .map((value) => String(value || "").split(",")[0].trim().split(/\s+/)[0])
    .find(Boolean);

  return normalizeAbsoluteUrl(candidate, baseUrl);
}

function extractDescriptionFromElement($, element) {
  return cleanText(
    $(element).find("p").first().text()
    || $(element).attr("title")
    || $(element).find("[itemprop='description']").first().text()
    || $(element).attr("aria-label")
    || ""
  );
}

function extractTitleAndLink($, element, baseUrl = "") {
  const anchorRoot = $(element).is("a[href]") ? $(element) : null;
  const heading = $(element).find("h1, h2, h3, h4").first();
  const headingAnchor = heading.find("a[href]").first();
  const firstAnchor = anchorRoot && anchorRoot.length ? anchorRoot : $(element).find("a[href]").first();
  const anchor = headingAnchor.length ? headingAnchor : firstAnchor;
  const href = normalizeAbsoluteUrl(anchor.attr("href") || "", baseUrl);
  const title = cleanText(
    heading.text()
    || anchor.attr("title")
    || anchor.attr("aria-label")
    || anchor.find("img").first().attr("alt")
    || anchor.text()
    || $(element).attr("title")
    || $(element).attr("aria-label")
    || $(element).find("img").first().attr("alt")
    || ""
  );

  return {
    title,
    link: isHttpUrl(href) ? href : "",
  };
}

function isLikelyArticleLink(url = "", baseUrl = "") {
  const normalized = normalizeAbsoluteUrl(url, baseUrl);
  if (!isHttpUrl(normalized)) return false;
  if (/\.(xml|rss|jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(normalized)) return false;
  return !/(\/tag\/|\/topic\/|\/author\/|\/category\/|\/privacy|\/terms|\/about|\/contact|\/feed\/?|\#)/i.test(normalized);
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
    timeout: 8000,
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
      timeout: 8000,
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
      timeout: 8000,
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
    timeout: 8000,
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

function validateXmlFeed(xml = "", url = "") {
  const result = XMLValidator.validate(String(xml || ""), xmlValidationOptions);
  if (result === true) return;

  const detail = typeof result === "object"
    ? `${result.err?.msg || "invalid xml"} at line ${result.err?.line || "?"}, col ${result.err?.col || "?"}`
    : "invalid xml";
  throw new Error(`RSS XML validation failed for ${url}: ${detail}`);
}

async function parseRssFeed(url) {
  const rawXml = await fetchTextNoCache(url, {
    timeoutMs: 8000,
    headers: REQUEST_HEADERS,
  });
  const xml = sanitizeXmlFeed(rawXml);
  validateXmlFeed(xml, url);

  try {
    return await parser.parseString(xml);
  } catch (error) {
    const parsed = tolerantXmlParser.parse(xml);
    const normalized = normalizeParsedFeed(parsed, url);
    if (Array.isArray(normalized.items) && normalized.items.length) {
      return normalized;
    }
    throw error;
  }
}

async function scrapeHomepageFeed(url = "", options = {}) {
  const limit = Math.max(1, Number.parseInt(options.limit || "10", 10) || 10);
  const response = await axios.get(url, {
    timeout: Number(options.timeoutMs || 12000),
    headers: REQUEST_HEADERS,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const finalUrl = response.request?.res?.responseUrl || url;
  const $ = cheerio.load(String(response.data || ""));
  $("script, style, noscript, iframe, svg, form").remove();

  const candidates = [];
  const seenLinks = new Set();
  const selectors = [
    "article",
    "main article",
    "[itemprop='itemListElement']",
    ".post",
    ".story",
    ".entry",
    ".jeg_post",
    "main li",
    "main > div",
  ];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      if (candidates.length >= limit * 4) return false;

      const { title, link } = extractTitleAndLink($, element, finalUrl);
      const normalizedLink = normalizeAbsoluteUrl(link, finalUrl);
      if (!title || title.length < 16) return;
      if (!isLikelyArticleLink(normalizedLink, finalUrl)) return;
      if (seenLinks.has(normalizedLink)) return;

      seenLinks.add(normalizedLink);
      candidates.push({
        title,
        link: normalizedLink,
        description: extractDescriptionFromElement($, element),
        imageUrl: extractImageFromElement($, element, finalUrl),
      });
    });

    if (candidates.length >= limit) break;
  }

  if (candidates.length < limit) {
    const anchorSelectors = [
      "h1 a[href]",
      "h2 a[href]",
      "h3 a[href]",
      "h4 a[href]",
      "a[href][title]",
      "a[href][aria-label]",
      "a[href] img[alt]",
      "a[href*='/news/']",
      "a[href*='/story']",
      "a[href*='/article']",
      "a[href*='/politics']",
      "a[href*='/sport']",
      "a[href*='/technology']",
      "a[href*='/recipe']",
      "a[href*='/job']",
      "a[href*='/career']",
    ];

    for (const selector of anchorSelectors) {
      $(selector).each((_, element) => {
        if (candidates.length >= limit * 5) return false;

        const anchor = $(element).is("a[href]") ? $(element) : $(element).closest("a[href]");
        if (!anchor.length) return;

        const parent = anchor.closest("article, li, div, section");
        const context = parent.length ? parent : anchor;
        const { title, link } = extractTitleAndLink($, anchor, finalUrl);
        const normalizedLink = normalizeAbsoluteUrl(link, finalUrl);
        if (!title || title.length < 16) return;
        if (!isLikelyArticleLink(normalizedLink, finalUrl)) return;
        if (seenLinks.has(normalizedLink)) return;

        seenLinks.add(normalizedLink);
        candidates.push({
          title,
          link: normalizedLink,
          description: extractDescriptionFromElement($, context),
          imageUrl: extractImageFromElement($, context, finalUrl),
        });
      });

      if (candidates.length >= limit) break;
    }
  }

  return candidates.slice(0, limit);
}

module.exports = {
  extractArticleBodyWithCheerio,
  fetchPublisherArticle,
  isGoogleNewsUrl,
  parseRssFeed,
  scrapeHomepageFeed,
  resolveGoogleNewsUrl,
};
