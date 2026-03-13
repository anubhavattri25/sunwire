const {
  buildStoryTags,
  cleanText,
  containsBannedGenerationPhrase,
  countWords,
  dedupeBy,
  detectDominantScript,
  domainFromUrl,
  extractTopicKeywords,
  isLowValueTrendText,
  scoreRelevanceToTitle,
  sentenceLooksFactual,
  sentenceMatchesTopic,
  sentenceMatchesScript,
  stripSourceBoilerplate,
  textSimilarity,
  toSentences,
  validateTopicCoverage,
} = require("./shared");

const INDIA_KEYWORDS = /\b(india|indian|inr|rs\.?|rupee|delhi|mumbai|bengaluru|bangalore|hyderabad|kolkata|chennai|pune)\b/i;
const PRICE_TOKEN_PATTERN = /\b(?:inr|rs\.?|usd|eur|\$)\s?\d[\d,]*(?:\.\d+)?\b/gi;
const NUMBER_TOKEN_PATTERN = /\b\d[\d,.:/%-]*\b/g;

function upperFirst(text = "") {
  const value = cleanText(text);
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function sentenceToClause(text = "") {
  return cleanText(text).replace(/[.!?]+$/g, "");
}

function trimToLength(text = "", maxLength = 150) {
  const value = cleanText(text);
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 90 ? lastSpace : maxLength).trim()}...`;
}

function humanizeTag(tag = "") {
  const value = cleanText(tag).replace(/[-_]+/g, " ");
  return value ? value.replace(/\b\w/g, (char) => char.toUpperCase()) : "";
}

function normalizeCategoryLabel(value = "") {
  const category = cleanText(value).toLowerCase();
  if (category === "ai") return "AI";
  if (category === "business" || category === "startups-funding") return "Business";
  if (category === "all" || category === "latest") return "Latest";
  return upperFirst(category || "latest");
}

function formatPublishedLabel(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not specified";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function sentenceWordCount(text = "") {
  return countWords(cleanText(text));
}

function extractPriceTokens(text = "") {
  return [...new Set(
    (String(text).match(PRICE_TOKEN_PATTERN) || [])
      .map((entry) => cleanText(entry.toUpperCase()))
      .filter(Boolean)
  )].slice(0, 4);
}

function extractNumberTokens(text = "") {
  return [...new Set(
    (String(text).match(NUMBER_TOKEN_PATTERN) || [])
      .map((entry) => cleanText(entry))
      .filter(Boolean)
  )].slice(0, 6);
}

function sanitizeCandidateSentence(sentence = "", title = "", packetTitle = "") {
  let value = cleanText(stripSourceBoilerplate(sentence))
    .replace(/\s{2,}/g, " ")
    .trim();

  const titleOptions = dedupeBy(
    [packetTitle, title].map((entry) => cleanText(entry)).filter(Boolean),
    (entry) => entry.toLowerCase()
  ).sort((left, right) => right.length - left.length);

  for (const option of titleOptions) {
    if (
      option
      && value.toLowerCase().startsWith(option.toLowerCase())
      && value.length > option.length + 20
    ) {
      value = value.slice(option.length).replace(/^[\s:;,.!?-]+/, "").trim();
    }
  }

  value = cleanText(value);
  if (!value) return "";
  if (isLowValueTrendText(value)) return "";
  if (containsBannedGenerationPhrase(value)) return "";
  if (/^(read more|watch|listen|subscribe|sign up|follow us|advertisement)\b/i.test(value)) return "";
  if (value.length < 30) return "";
  if (!sentenceLooksFactual(value)) return "";
  if (
    textSimilarity(value, packetTitle || title) >= 0.92
    && value.split(/\s+/).filter(Boolean).length <= Math.max((packetTitle || title).split(/\s+/).filter(Boolean).length + 4, 14)
  ) {
    return "";
  }

  return upperFirst(value);
}

function dedupeSentences(items = []) {
  const output = [];
  for (const item of items.map((entry) => ({ ...entry, text: cleanText(entry.text || "") })).filter((entry) => entry.text)) {
    if (output.some((existing) => textSimilarity(existing.text, item.text) >= 0.85)) continue;
    output.push(item);
  }
  return output;
}

function buildSentenceCandidates(packets = [], title = "") {
  const script = detectDominantScript(title || packets.map((packet) => packet.title || "").join(" "));
  const topicKeywords = extractTopicKeywords(
    title || packets.map((packet) => packet.title || "").join(" "),
    packets.map((packet) => `${packet.title || ""} ${packet.summary || ""} ${packet.body || ""}`).join(" ")
  );
  const candidates = [];

  packets.forEach((packet, packetIndex) => {
    const packetTitle = cleanText(packet.title || "");
    const packetSource = cleanText(packet.source || "Unknown Source");
    const packetText = `${packet.summary || ""}\n${packet.body || ""}`;

    toSentences(packetText).forEach((sentence, sentenceIndex) => {
      const cleanedSentence = sanitizeCandidateSentence(sentence, title, packetTitle);
      if (!cleanedSentence || !sentenceMatchesScript(cleanedSentence, script)) return;
      if (!sentenceMatchesTopic(cleanedSentence, topicKeywords, 1)) return;

      const score = Math.max(
        scoreRelevanceToTitle(title, cleanedSentence),
        scoreRelevanceToTitle(packetTitle || title, cleanedSentence)
      ) + (packet.kind === "primary" ? 4 : 0) + (/\d/.test(cleanedSentence) ? 2 : 0) - Math.min(sentenceIndex, 4);

      if (score < 4) return;
      candidates.push({
        text: cleanedSentence,
        source: packetSource,
        kind: packet.kind || "",
        packetIndex,
        score,
      });
    });
  });

  return dedupeSentences(candidates)
    .sort((left, right) => right.score - left.score)
    .slice(0, 36);
}

function pickDistinctSentences(candidates = [], maxItems = 3) {
  const chosen = [];

  for (const candidate of candidates) {
    if (chosen.length >= maxItems) break;
    if (chosen.some((entry) => textSimilarity(entry.text, candidate.text) >= 0.8)) continue;
    if (chosen.length === 0 || !chosen.some((entry) => entry.source === candidate.source)) {
      chosen.push(candidate);
    }
  }

  for (const candidate of candidates) {
    if (chosen.length >= maxItems) break;
    if (chosen.some((entry) => textSimilarity(entry.text, candidate.text) >= 0.8)) continue;
    chosen.push(candidate);
  }

  return chosen.slice(0, maxItems);
}

function fallbackSentences(text = "", title = "") {
  const topicKeywords = extractTopicKeywords(title, text);
  return dedupeSentences(
    toSentences(text)
      .map((sentence, index) => ({
        text: sanitizeCandidateSentence(sentence, title, title),
        source: "fallback",
        score: 10 - index,
      }))
      .filter((entry) => entry.text)
      .filter((entry) => sentenceMatchesTopic(entry.text, topicKeywords, 1))
  );
}

function buildAllSentenceCandidates(packets = [], title = "", fallbackSummary = "") {
  return dedupeSentences([
    ...buildSentenceCandidates(packets, title),
    ...fallbackSentences(fallbackSummary, title),
  ]).sort((left, right) => (right.score || 0) - (left.score || 0));
}

function buildSummaryFromPackets(packets = [], title = "", fallbackSummary = "") {
  const chosen = pickDistinctSentences(buildSentenceCandidates(packets, title), 3);
  if (chosen.length) return cleanText(chosen.map((item) => item.text).join(" ")).slice(0, 520);

  const fallback = pickDistinctSentences(fallbackSentences(fallbackSummary, title), 3);
  return cleanText(fallback.map((item) => item.text).join(" ")).slice(0, 520);
}

function buildFallbackKeyPoints(packets = [], title = "", fallbackSummary = "") {
  const rankedCandidates = buildSentenceCandidates(packets, title);
  const chosen = pickDistinctSentences(rankedCandidates, 5);

  if (chosen.length) {
    return chosen
      .map((entry) => sentenceToClause(entry.text))
      .filter(Boolean)
      .slice(0, 5);
  }

  return pickDistinctSentences(fallbackSentences(fallbackSummary, title), 5)
    .map((entry) => sentenceToClause(entry.text))
    .filter(Boolean)
    .slice(0, 5);
}

function buildFallbackArticle(packets = [], title = "", fallbackSummary = "") {
  const rankedCandidates = buildSentenceCandidates(packets, title);
  const details = pickDistinctSentences(rankedCandidates, 4);
  if (details.length) return details.map((entry) => cleanText(entry.text)).join("\n\n");

  return pickDistinctSentences(fallbackSentences(fallbackSummary, title), 4)
    .map((entry) => cleanText(entry.text))
    .join("\n\n");
}

function buildDeepDiveParagraphs(candidates = [], fallbackSummary = "") {
  const pool = dedupeSentences(
    candidates
      .map((entry) => ({
        ...entry,
        text: cleanText(entry.text || entry),
      }))
      .filter((entry) => entry.text)
  );
  const paragraphs = [];
  let current = [];
  let currentWords = 0;

  for (const entry of pool) {
    const sentence = cleanText(entry.text || "");
    const words = sentenceWordCount(sentence);
    if (!sentence || words < 8) continue;

    if (
      current.length >= 3
      || (current.length >= 2 && currentWords + words > 92)
    ) {
      paragraphs.push(current.join(" "));
      current = [];
      currentWords = 0;
      if (paragraphs.length >= 4) break;
    }

    current.push(sentence);
    currentWords += words;
  }

  if (current.length && paragraphs.length < 4) paragraphs.push(current.join(" "));
  if (paragraphs.length >= 3) return paragraphs.slice(0, 4);

  const fallbackParagraphs = cleanText(fallbackSummary) ? [cleanText(fallbackSummary)] : [];
  return dedupeBy([...paragraphs, ...fallbackParagraphs], (entry) => entry.toLowerCase()).slice(0, 4);
}

function buildIndiaPulseText({
  category = "latest",
  candidates = [],
  packets = [],
  fallbackSummary = "",
  tags = [],
  primarySource = "",
} = {}) {
  const indiaSpecific = dedupeSentences(
    candidates.filter((entry) => INDIA_KEYWORDS.test(entry.text || ""))
  )
    .map((entry) => cleanText(entry.text))
    .slice(0, 2);
  const combinedText = cleanText([
    fallbackSummary,
    packets.map((packet) => `${packet.title || ""} ${packet.summary || ""} ${packet.body || ""}`).join(" "),
  ].join(" "));
  const priceTokens = extractPriceTokens(combinedText);
  const localFocusByCategory = {
    ai: "For Indian developers and enterprise buyers, the immediate watchpoints are regional rollout timing, API access, compliance, and any official INR billing.",
    tech: "For Indian consumers and buyers, the practical issues are launch timing, after-sales support, carrier or retail availability, and GST-inclusive INR pricing.",
    entertainment: "For viewers in India, the main questions are theatrical or OTT availability, dubbing and subtitle support, and whether pricing lands in INR on local platforms.",
    sports: "For Indian fans, the real impact sits in match timing, streaming access, sponsorship relevance, and how quickly the story changes the local sports conversation.",
    business: "For Indian founders and market watchers, the focus is on whether the move changes pricing power, hiring, partnerships, and the competitive picture in the local market.",
    latest: "For Indian users, the immediate practical read is local availability, support coverage, regulatory clarity, and whether official pricing appears in INR rather than rough conversions.",
  };
  const categoryKey = cleanText(category).toLowerCase();
  const localFocus = localFocusByCategory[categoryKey] || localFocusByCategory.latest;
  const pricingLine = priceTokens.length
    ? `The verified material references price points such as ${priceTokens.join(", ")}, but an India-specific INR figure is not clearly confirmed in the source set yet.`
    : "The verified source material does not clearly confirm India-specific pricing in INR or a formal local rollout timeline yet.";
  const sourceNote = primarySource
    ? `That makes the primary-source listing from ${primarySource} the document Indian readers should track for the next concrete update.`
    : "That means Indian readers should track official listings instead of relying on recycled pricing claims.";

  return cleanText([
    ...indiaSpecific,
    pricingLine,
    localFocus,
    sourceNote,
    tags.length ? `In the Indian market, the most important watchwords remain ${tags.slice(0, 3).map(humanizeTag).join(", ")}.` : "",
  ].join(" "));
}

function buildBackgroundItems({
  title = "",
  related = [],
  packets = [],
  tags = [],
} = {}) {
  const items = dedupeBy([
    ...packets
      .filter((packet) => packet.kind && packet.kind !== "primary")
      .map((packet) => ({
        title: cleanText(packet.title || ""),
        context: trimToLength(cleanText(packet.summary || packet.body || `${packet.source || "Coverage"} tracked a related development tied to ${tags.slice(0, 2).map(humanizeTag).join(" and ") || "the story"}.`), 190),
        url: cleanText(packet.url || ""),
        source: cleanText(packet.source || ""),
      })),
    ...related.map((item) => ({
      title: cleanText(item.title || ""),
      context: trimToLength(cleanText(item.summary || `${item.source || "Related coverage"} offers earlier context around ${tags.slice(0, 2).map(humanizeTag).join(" and ") || "the same topic"}.`), 190),
      url: cleanText(item.url || ""),
      source: cleanText(item.source || ""),
    })),
  ], (item) => `${item.title.toLowerCase()}|${item.url.toLowerCase()}`)
    .filter((item) => item.title)
    .filter((item) => textSimilarity(item.title, title) < 0.82);

  while (items.length < 2) {
    const fallbackLabel = items.length === 0 ? "Earlier context" : "Previous checkpoint";
    items.push({
      title: `${fallbackLabel} on ${humanizeTag(tags[items.length] || tags[0] || "the story")}`,
      context: items.length === 0
        ? "Previous coverage set the baseline for the current update by outlining the first verified claims, players, and timelines linked to the story."
        : "That earlier checkpoint matters because it helps separate the latest development from the broader sequence of announcements, reactions, and market responses.",
      url: "",
      source: "",
    });
  }

  return items.slice(0, 2);
}

function buildFactSheetRows({
  title = "",
  category = "latest",
  publishedAt = "",
  packets = [],
  tags = [],
  source = "",
  sourceUrl = "",
  indiaPulse = "",
} = {}) {
  const combinedText = cleanText(packets.map((packet) => `${packet.title || ""} ${packet.summary || ""} ${packet.body || ""}`).join(" "));
  const numericTokens = extractNumberTokens(`${title} ${combinedText}`);
  const priceTokens = extractPriceTokens(`${title} ${combinedText}`);
  const primaryLabel = source || domainFromUrl(sourceUrl) || "Sunwire Desk";

  return [
    { label: "Story focus", value: trimToLength(title, 80) || "Latest development" },
    { label: "Desk", value: normalizeCategoryLabel(category) },
    { label: "Primary source", value: primaryLabel },
    { label: "Published", value: formatPublishedLabel(publishedAt) },
    { label: "Key numbers", value: numericTokens.length ? numericTokens.join(", ") : "No major numeric disclosures verified" },
    { label: "Pricing watch", value: priceTokens.length ? priceTokens.join(", ") : "INR pricing not confirmed" },
    { label: "Top tags", value: tags.length ? tags.map(humanizeTag).join(", ") : "Context in progress" },
    { label: "India pulse", value: trimToLength(indiaPulse || "India-specific availability or INR pricing is still being tracked.", 110) },
  ].filter((row) => cleanText(row.value));
}

function buildMetaDescription({ title = "", summary = "", deepDive = [], indiaPulse = "" } = {}) {
  const candidate = cleanText([
    summary,
    Array.isArray(deepDive) ? deepDive[0] : "",
    indiaPulse,
  ].join(" "));
  return trimToLength(candidate || title, 150);
}

function buildPrimarySource(packets = [], requestedSource = "", requestedUrl = "") {
  const primaryPacket = packets.find((packet) => packet.kind === "primary" && cleanText(packet.url || ""));
  const sourceUrl = cleanText(primaryPacket?.url || requestedUrl || "");
  const sourceName = cleanText(primaryPacket?.source || requestedSource || domainFromUrl(sourceUrl) || "Original Source");
  return {
    name: sourceName,
    url: sourceUrl,
  };
}

function buildLongformBody({ deepDive = [], indiaPulse = "", background = [] } = {}) {
  return cleanText([
    ...(Array.isArray(deepDive) ? deepDive : []),
    indiaPulse,
    ...background.map((item) => `${item.title}. ${item.context}`),
  ].join("\n\n"));
}

function buildStructuredArticle(packets = [], title = "", fallbackSummary = "", options = {}) {
  const keyPoints = buildFallbackKeyPoints(packets, title, fallbackSummary)
    .filter(Boolean)
    .slice(0, 5);
  const normalizedKeyPoints = keyPoints.length >= 3 ? keyPoints : [];
  const allCandidates = buildAllSentenceCandidates(packets, title, fallbackSummary);
  const detailBody = buildFallbackArticle(packets, title, fallbackSummary);
  const detailSentences = dedupeSentences([
    ...allCandidates,
    ...detailBody
      .split(/\n{2,}/)
      .map((entry, index) => ({
        text: cleanText(entry),
        score: 50 - index,
      })),
  ])
    .map((entry) => cleanText(entry.text || ""))
    .filter(Boolean)
    .slice(0, 18);
  const summary = cleanText(
    buildSummaryFromPackets(packets, title, fallbackSummary)
    || normalizedKeyPoints.slice(0, 2).map((entry) => `${entry}.`).join(" ")
  );
  const providedTags = Array.isArray(options.tags)
    ? options.tags.map((tag) => cleanText(tag).toLowerCase()).filter(Boolean)
    : [];
  const tags = dedupeBy([
    ...providedTags,
    ...buildStoryTags(
      title,
      summary,
      normalizedKeyPoints.join(". "),
      detailSentences.join(". "),
      fallbackSummary
    ),
  ], (entry) => entry.toLowerCase()).slice(0, 5);
  const deepDive = buildDeepDiveParagraphs(
    allCandidates.length ? allCandidates : detailSentences.map((entry, index) => ({ text: entry, score: 20 - index })),
    detailBody || fallbackSummary
  );
  const primarySource = buildPrimarySource(packets, options.source, options.sourceUrl);
  const indiaPulse = buildIndiaPulseText({
    category: options.category,
    candidates: allCandidates,
    packets,
    fallbackSummary,
    tags,
    primarySource: primarySource.name,
  });
  const background = buildBackgroundItems({
    title,
    related: Array.isArray(options.related) ? options.related : [],
    packets,
    tags,
  });
  const factSheet = buildFactSheetRows({
    title,
    category: options.category,
    publishedAt: options.publishedAt,
    packets,
    tags,
    source: primarySource.name,
    sourceUrl: primarySource.url,
    indiaPulse,
  });
  const body = buildLongformBody({ deepDive, indiaPulse, background });
  const metaDescription = buildMetaDescription({ title, summary, deepDive, indiaPulse });
  const wordCount = countWords([
    title,
    summary,
    normalizedKeyPoints.join(" "),
    deepDive.join(" "),
    indiaPulse,
    background.map((item) => `${item.title} ${item.context}`).join(" "),
    factSheet.map((row) => `${row.label} ${row.value}`).join(" "),
  ].join(" "));
  const estimatedReadingTime = Math.max(2, Math.ceil(wordCount / 200));
  const combinedText = cleanText([
    title,
    normalizedKeyPoints.join(". "),
    detailSentences.join(". "),
    deepDive.join(". "),
    indiaPulse,
    background.map((item) => `${item.title}. ${item.context}`).join(" "),
  ].join(" "));
  const topicKeywords = extractTopicKeywords(title, combinedText);
  const isValid = normalizedKeyPoints.length >= 3
    && deepDive.length >= 3
    && Boolean(indiaPulse)
    && background.length >= 2
    && factSheet.length >= 4
    && wordCount >= 400
    && validateTopicCoverage(combinedText, topicKeywords);

  return {
    summary,
    keyPoints: normalizedKeyPoints,
    body,
    deepDive,
    indiaPulse,
    background,
    factSheet,
    tags,
    metaDescription,
    wordCount,
    estimatedReadingTime,
    primarySource,
    isValid,
  };
}

module.exports = {
  buildFallbackArticle,
  buildFallbackKeyPoints,
  buildStructuredArticle,
  buildSummaryFromPackets,
};
