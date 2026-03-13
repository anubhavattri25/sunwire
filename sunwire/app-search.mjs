function fallbackCleanText(text = "") {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findStoriesForQuery(stories = [], query = "", helpers = {}) {
  const cleanText = helpers.cleanText || fallbackCleanText;
  const dedupeStories = helpers.dedupeStories || ((items = []) => items);
  const getDisplayTimestamp = helpers.getDisplayTimestamp || ((story = {}) => (
    story.source_published_at || story.published_at || story.publishedAt || story.injected_at || ""
  ));

  const normalizedQuery = cleanText(query);
  const tokens = [...new Set(
    normalizedQuery
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 1)
  )];

  const scoreStory = (story = {}) => {
    const exactQuery = normalizedQuery.toLowerCase();
    if (!exactQuery) return -1;

    const title = cleanText(story.title).toLowerCase();
    const summary = cleanText(story.summary || story.description || "").toLowerCase();
    const source = cleanText(story.source).toLowerCase();
    const category = cleanText(story.category || story.displayCategory || "").toLowerCase();
    const haystack = `${title} ${summary} ${source} ${category}`.trim();

    let score = 0;
    if (title.includes(exactQuery)) score += 140;
    if (summary.includes(exactQuery)) score += 90;
    if (source.includes(exactQuery)) score += 40;
    if (category.includes(exactQuery)) score += 35;

    let matchedTokens = 0;
    tokens.forEach((token) => {
      const inTitle = title.includes(token);
      const inSummary = summary.includes(token);
      const inSource = source.includes(token);
      const inCategory = category.includes(token);
      if (inTitle || inSummary || inSource || inCategory) matchedTokens += 1;
      if (inTitle) score += 24;
      if (inSummary) score += 14;
      if (inSource) score += 6;
      if (inCategory) score += 6;
    });

    const allTokensMatched = tokens.length > 0 && matchedTokens === tokens.length;
    if (allTokensMatched) score += 40;
    if (!score && !haystack.includes(exactQuery)) return -1;
    if (!allTokensMatched && tokens.length > 1 && matchedTokens < Math.max(1, Math.ceil(tokens.length / 2))) {
      return -1;
    }

    return score;
  };

  return dedupeStories(stories)
    .map((story) => ({
      story,
      score: scoreStory(story),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const trendingDiff = Number(b.story.trendingScore || 0) - Number(a.story.trendingScore || 0);
      if (trendingDiff !== 0) return trendingDiff;
      return new Date(getDisplayTimestamp(b.story)).getTime()
        - new Date(getDisplayTimestamp(a.story)).getTime();
    })
    .map((entry) => entry.story);
}

export function buildSearchLayout(stories = [], query = "", options = {}) {
  const cleanText = options.cleanText || fallbackCleanText;
  const dedupeStories = options.dedupeStories || ((items = []) => items);
  const trendingCount = Number(options.trendingCount || 4);
  const rankedStories = dedupeStories(stories);
  const resultCount = rankedStories.length;

  return {
    hero: rankedStories[0] || null,
    trending: rankedStories.slice(1, trendingCount + 1),
    topSections: resultCount ? [{
      key: `search-${cleanText(query).toLowerCase()}`,
      title: "Search Results",
      eyebrow: `${resultCount} ${resultCount === 1 ? "story" : "stories"} for "${cleanText(query)}"`,
      hideAction: true,
      layout: "catalog",
      cardVariant: "dense",
      stories: rankedStories,
    }] : [],
    moreSections: [],
  };
}
