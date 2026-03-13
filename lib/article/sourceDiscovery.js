const {
  cleanDeepBody,
  cleanText,
  compareTitleSimilarity,
  decodeXml,
  dedupeBy,
  detectDominantScript,
  domainFromUrl,
  extractTopicKeywords,
  extractBodyFromJina,
  fetchJsonNoCache,
  fetchTextNoCache,
  isLowValueTrendText,
  safeJsonParse,
  scoreCandidate,
  scoreRelevanceToTitle,
  sentenceLooksFactual,
  sentenceMatchesTopic,
  sentenceMatchesScript,
  storyQueryTokens,
  stripHtml,
  stripSourceBoilerplate,
  validateTopicCoverage,
} = require("./shared");

function buildBaseUrl(req) {
  const host = cleanText(req.headers["x-forwarded-host"] || req.headers.host || "");
  if (!host) return "";
  const protocol = cleanText(req.headers["x-forwarded-proto"] || "").toLowerCase() || "https";
  return `${protocol}://${host}`;
}

async function fetchSiteCoverage(req, title = "", currentUrl = "") {
  const baseUrl = buildBaseUrl(req);
  if (!baseUrl) return [];

  try {
    const payload = await fetchJsonNoCache(`${baseUrl}/api/news?filter=all&page=1&pageSize=80&limit=200`, {
      timeoutMs: 2200,
    });
    const siteStories = Array.isArray(payload?.stories) ? payload.stories : [];
    const tokens = storyQueryTokens(title);

    return siteStories
      .map((story) => ({
        title: cleanText(story.title || ""),
        summary: cleanText(story.summary || ""),
        source: cleanText(story.source || ""),
        sourceUrl: story.sourceUrl || story.url || "",
        category: cleanText(story.category || ""),
        score: scoreCandidate(story, tokens),
        similarity: compareTitleSimilarity(title, story.title || ""),
      }))
      .filter((story) => story.sourceUrl && story.sourceUrl !== currentUrl)
      .filter((story) => story.similarity >= 0.45 || story.score >= 12)
      .sort((left, right) => (right.similarity - left.similarity) || (right.score - left.score))
      .slice(0, 6);
  } catch (_) {
    return [];
  }
}

function extractTag(block = "", tagName = "") {
  const match = block.match(new RegExp(`<${tagName}(?:[^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return decodeXml(stripHtml(match?.[1] || ""));
}

function parseGoogleNewsRss(xml = "") {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => match[1])
    .map((block) => ({
      title: extractTag(block, "title"),
      url: extractTag(block, "link"),
      source: extractTag(block, "source"),
      summary: extractTag(block, "description"),
    }))
    .filter((item) => item.title);
}

async function fetchGoogleNewsSignals(title = "") {
  const exactTitle = cleanText(title).replace(/\s+/g, " ").trim();
  const broadTitle = storyQueryTokens(title).slice(0, 8).join(" ");
  const queries = [`"${exactTitle}"`, broadTitle].filter(Boolean);

  for (let index = 0; index < queries.length; index += 1) {
    try {
      const query = encodeURIComponent(queries[index]);
      const xml = await fetchTextNoCache(
        `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`,
        { timeoutMs: 2200 }
      );
      const items = parseGoogleNewsRss(xml)
        .map((item) => ({ ...item, similarity: compareTitleSimilarity(title, item.title || "") }))
        .filter((item) => item.similarity >= (index === 0 ? 0.55 : 0.35))
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 5);
      if (items.length) return items;
    } catch (_) {
      // Try the next query shape.
    }
  }

  return [];
}

function dedupeRelated(items = []) {
  return dedupeBy(
    items,
    (item) => `${cleanText(item?.title || "").toLowerCase()}|${cleanText(item?.url || "")}`
  ).filter((item) => cleanText(item?.title || "") && cleanText(item?.url || ""));
}

function fallbackRelated(title = "", sourceUrl = "") {
  const fallbackQuery = encodeURIComponent(cleanText(title).slice(0, 80));
  return dedupeRelated([
    { title: "Search on Google News", url: `https://news.google.com/search?q=${fallbackQuery}` },
    { title: "Search on Reddit", url: `https://www.reddit.com/search/?q=${fallbackQuery}` },
    { title: "Search on Hacker News", url: `https://hn.algolia.com/?query=${fallbackQuery}` },
    { title: "Search on DEV Community", url: `https://dev.to/search?q=${fallbackQuery}` },
  ]).filter((item) => item.url !== sourceUrl).slice(0, 5);
}

async function fetchRelated(title = "", sourceUrl = "") {
  const keywordQuery = storyQueryTokens(title).slice(0, 6).join(" ");
  const query = encodeURIComponent(keywordQuery || cleanText(title).split(" ").slice(0, 5).join(" "));
  if (!query) return [];

  const [hackerNews, devTo, reddit] = await Promise.allSettled([
    fetchJsonNoCache(`https://hn.algolia.com/api/v1/search?query=${query}&tags=story&hitsPerPage=8`, { timeoutMs: 2200 }),
    fetchJsonNoCache(`https://dev.to/api/articles?per_page=6&tag=${encodeURIComponent(keywordQuery.split(" ")[0] || "news")}`, { timeoutMs: 2200 }),
    fetchJsonNoCache(`https://www.reddit.com/search.json?q=${query}&sort=relevance&t=month&limit=8`, { timeoutMs: 2200 }),
  ]);

  const relatedItems = dedupeRelated([
    ...(hackerNews.status === "fulfilled"
      ? (hackerNews.value.hits || []).map((item) => ({
        title: cleanText(item.title || item.story_title || ""),
        url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
        source: "Hacker News",
        summary: "",
      }))
      : []),
    ...(devTo.status === "fulfilled"
      ? (devTo.value || []).map((item) => ({
        title: cleanText(item.title || ""),
        url: item.url || "",
        source: "DEV Community",
        summary: cleanText(item.description || ""),
      }))
      : []),
    ...(reddit.status === "fulfilled"
      ? (reddit.value.data?.children || []).map((child) => child.data).map((item) => ({
        title: cleanText(item.title || ""),
        url: item.url || "",
        source: "Reddit",
        summary: cleanText(item.selftext || ""),
      }))
      : []),
  ])
    .filter((item) => item.url !== sourceUrl)
    .map((item) => ({ ...item, similarity: compareTitleSimilarity(title, item.title || "") }))
    .filter((item) => item.similarity >= 0.55)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 5);

  return relatedItems.length ? relatedItems : fallbackRelated(title, sourceUrl);
}

async function fetchReaderExtract(url = "") {
  if (!/^https?:\/\//i.test(url)) return { url, body: "" };

  try {
    const normalizedUrl = url.replace(/^https?:\/\//i, "");
    const extractedText = await fetchTextNoCache(`https://r.jina.ai/http://${normalizedUrl}`, { timeoutMs: 2600 });
    return { url, body: cleanDeepBody(extractBodyFromJina(extractedText)) };
  } catch (_) {
    return { url, body: "" };
  }
}

function extractJsonLdBlocks(html = "") {
  return [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => safeJsonParse(match[1]))
    .filter(Boolean)
    .flatMap((item) => (Array.isArray(item) ? item : [item]));
}

function walkJsonLdArticles(value, items = []) {
  if (!value || typeof value !== "object") return items;
  if (Array.isArray(value)) {
    value.forEach((entry) => walkJsonLdArticles(entry, items));
    return items;
  }

  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (types.some((entry) => /article|newsarticle|reportage/i.test(String(entry || "")))) {
    items.push(value);
  }

  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === "object") walkJsonLdArticles(entry, items);
  });

  return items;
}

function extractMetaContent(html = "", matcher) {
  const match = String(html).match(matcher);
  return cleanText(stripSourceBoilerplate(decodeXml(match?.[1] || "")));
}

function selectRelevantText(text = "", title = "", script = "latin", maxSentences = 10) {
  const topicKeywords = extractTopicKeywords(title, text);
  return dedupeBy(
    cleanText(stripSourceBoilerplate(text))
      ? stripSourceBoilerplate(text)
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => cleanText(sentence))
        .filter(Boolean)
        .filter((sentence) => sentenceMatchesScript(sentence, script))
        .filter((sentence) => sentenceLooksFactual(sentence))
        .filter((sentence) => !/^\d{1,2}:\d{2}\s*(am|pm)\b/i.test(sentence))
        .filter((sentence) => scoreRelevanceToTitle(title, sentence) >= 4)
        .filter((sentence) => sentenceMatchesTopic(sentence, topicKeywords, 1))
      : [],
    (sentence) => sentence.toLowerCase()
  ).slice(0, maxSentences).join(" ");
}

function extractPrimaryArticleFromHtml(html = "", title = "") {
  const script = detectDominantScript(title);
  const topicKeywords = extractTopicKeywords(title, html);
  const jsonLdArticles = walkJsonLdArticles(extractJsonLdBlocks(html));

  const articleBodies = jsonLdArticles
    .map((entry) => selectRelevantText(entry.articleBody || entry.description || "", title, script, 14))
    .filter(Boolean)
    .filter((entry) => sentenceMatchesScript(entry, script))
    .sort((left, right) => right.length - left.length);

  const descriptions = [
    ...jsonLdArticles.map((entry) => selectRelevantText(entry.description || "", title, script, 3)),
    extractMetaContent(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
    extractMetaContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
  ]
    .map((entry) => selectRelevantText(entry, title, script, 3) || cleanText(entry))
    .filter(Boolean);

  const headline = cleanText(
    jsonLdArticles.map((entry) => cleanText(entry.headline || "")).find(Boolean)
    || extractMetaContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  );

  const paragraphs = [...String(html).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanText(stripSourceBoilerplate(decodeXml(stripHtml(match[1] || "")))))
    .filter((paragraph) => paragraph.length > 70)
    .filter((paragraph) => sentenceMatchesScript(paragraph, script))
    .filter((paragraph) => sentenceLooksFactual(paragraph))
    .filter((paragraph) => scoreRelevanceToTitle(title, paragraph) >= 4)
    .filter((paragraph) => sentenceMatchesTopic(paragraph, topicKeywords, 1))
    .filter((paragraph) => !/subscribe|advertisement|read more|follow us|click here|watch live/i.test(paragraph));

  const body = cleanDeepBody(
    dedupeBy(paragraphs, (paragraph) => paragraph.toLowerCase()).slice(0, 18).join("\n\n")
    || articleBodies[0]
    || ""
  );

  return {
    title: headline,
    summary: descriptions.find((entry) => sentenceMatchesScript(entry, script)) || "",
    body: validateTopicCoverage(body, topicKeywords) ? body : "",
  };
}

function buildSourcePackets({
  originalTitle,
  originalSource,
  originalUrl,
  originalBody,
  originalSummary,
  siteCoverage,
  siteExtracts,
  googleSignals,
}) {
  const packets = [];
  const topicKeywords = extractTopicKeywords(originalTitle, `${originalSummary || ""} ${originalBody || ""}`);

  if (originalBody || originalSummary) {
    packets.push({
      kind: "primary",
      source: originalSource || "Original Source",
      title: cleanText(originalTitle),
      url: originalUrl,
      summary: cleanText(originalSummary),
      body: cleanDeepBody(originalBody),
    });
  }

  for (const story of siteCoverage) {
    const extract = siteExtracts.find((entry) => entry.url === story.sourceUrl);
    packets.push({
      kind: "coverage",
      source: story.source || domainFromUrl(story.sourceUrl),
      title: cleanText(story.title),
      url: story.sourceUrl,
      summary: cleanText(story.summary),
      body: cleanDeepBody(extract?.body || ""),
    });
  }

  for (const signal of googleSignals) {
    packets.push({
      kind: "signal",
      source: signal.source || "Google News",
      title: cleanText(signal.title),
      url: cleanText(signal.url),
      summary: cleanText(signal.summary),
      body: "",
    });
  }

  return dedupeBy(
    packets
      .filter((packet) => (packet.body || packet.summary || packet.title) && !isLowValueTrendText(packet.summary))
      .filter((packet) => {
        const packetText = `${packet.title || ""} ${packet.summary || ""} ${packet.body || ""}`;
        return validateTopicCoverage(packetText, topicKeywords)
          || sentenceMatchesTopic(packet.title || "", topicKeywords, 1);
      })
      .filter((packet) => packet.kind !== "signal" || compareTitleSimilarity(originalTitle, packet.title || "") >= 0.45),
    (packet) => `${packet.source}|${packet.url || packet.title}`.toLowerCase()
  ).slice(0, 6);
}

module.exports = {
  buildSourcePackets,
  dedupeRelated,
  extractPrimaryArticleFromHtml,
  fallbackRelated,
  fetchGoogleNewsSignals,
  fetchReaderExtract,
  fetchRelated,
  fetchSiteCoverage,
};
