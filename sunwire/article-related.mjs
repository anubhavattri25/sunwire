export async function loadRelatedStories(options = {}) {
  const {
    category = "latest",
    currentUrl = "",
    currentTitle = "",
    currentTags = [],
    fetchJson,
    containers = {},
    helpers = {},
  } = options;

  if (typeof fetchJson !== "function") throw new Error("Missing fetchJson helper");

  const {
    sidebarTrendingList,
    sidebarLatestList,
    sidebarRelatedList,
    relatedGrid,
  } = containers;

  const {
    cleanText = (value = "") => String(value || "").trim(),
    normalizeDeskFilter = (value = "") => value,
    displayDeskLabel = (value = "") => value,
    dedupeStories = (items = []) => items,
    storyKey = (story = {}) => story.id || story.url || story.title,
    buildArticleHref = (story = {}) => story.url || "/",
    storyImage = (story = {}) => story.image || "",
    applyResponsiveImage = () => {},
    timeAgo = () => "just now",
    normalizeTag = (value = "") => cleanText(String(value || "").toLowerCase()),
  } = helpers;

  const renderStoryLinks = (el, stories = [], emptyText = "No stories available.") => {
    if (!el) return;
    el.innerHTML = "";
    if (!stories.length) {
      const li = document.createElement("li");
      li.textContent = emptyText;
      el.appendChild(li);
      return;
    }

    stories.forEach((story) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = buildArticleHref(story);
      a.innerHTML = `<strong>${cleanText(story.title || "Story")}</strong><span>${displayDeskLabel(story.category || "latest")} · ${timeAgo(story.injected_at || story.published_at || story.publishedAt || "")}</span>`;
      li.appendChild(a);
      el.appendChild(li);
    });
  };

  const renderRelatedGrid = (stories = []) => {
    if (!relatedGrid) return;
    relatedGrid.innerHTML = "";
    if (!stories.length) {
      relatedGrid.innerHTML = "<p>No related stories available right now.</p>";
      return;
    }

    stories.forEach((story) => {
      const article = document.createElement("article");
      article.className = "related-card";

      const mediaLink = document.createElement("a");
      mediaLink.className = "related-card__media";
      mediaLink.href = buildArticleHref(story);

      const image = document.createElement("img");
      applyResponsiveImage(image, storyImage(story, normalizeDeskFilter(story.category || "latest")), {
        alt: cleanText(story.title || "Story image"),
        width: 1600,
        height: 1000,
        sizes: "(max-width: 960px) 100vw, 25vw",
      });
      mediaLink.appendChild(image);

      const tag = document.createElement("span");
      tag.className = "related-card__tag";
      tag.textContent = displayDeskLabel(story.category || "latest");

      const headline = document.createElement("a");
      headline.className = "related-card__headline";
      headline.href = buildArticleHref(story);
      headline.textContent = cleanText(story.title || "Story");

      const meta = document.createElement("div");
      meta.className = "related-card__meta";
      meta.textContent = timeAgo(story.injected_at || story.published_at || story.publishedAt || "");

      article.appendChild(mediaLink);
      article.appendChild(tag);
      article.appendChild(headline);
      article.appendChild(meta);
      relatedGrid.appendChild(article);
    });
  };

  const fetchNews = async (filter = "all", pageSize = 10) => {
    const params = new URLSearchParams({
      filter: filter === "latest" || filter === "india-pulse" || filter === "war-conflict" || filter === "politics" || filter === "startups-funding"
        ? "all"
        : filter,
      page: "1",
      pageSize: String(pageSize),
    });
    const data = await fetchJson(`/api/news?${params.toString()}`, { ttlMs: 2 * 60 * 1000 });
    return Array.isArray(data?.stories) ? data.stories : [];
  };

  const [allStories, categoryStories] = await Promise.all([
    fetchNews("all", 24).catch(() => []),
    category === "latest" ? Promise.resolve([]) : fetchNews(category, 16).catch(() => []),
  ]);

  const filteredAllStories = dedupeStories(allStories)
    .filter((story) => (story.sourceUrl || story.url || "") !== currentUrl)
    .filter((story) => cleanText(story.title || "").toLowerCase() !== cleanText(currentTitle || "").toLowerCase());
  const targetTags = (Array.isArray(currentTags) ? currentTags : [])
    .map((tag) => normalizeTag(tag))
    .filter(Boolean);

  const filteredCategoryStories = dedupeStories(categoryStories.length ? categoryStories : filteredAllStories.filter((story) => (
    normalizeDeskFilter(story.category || "latest") === normalizeDeskFilter(category)
  )))
    .filter((story) => (story.sourceUrl || story.url || "") !== currentUrl)
    .filter((story) => cleanText(story.title || "").toLowerCase() !== cleanText(currentTitle || "").toLowerCase());
  const latestStories = [...filteredAllStories].sort((a, b) =>
    new Date(b.injected_at || b.published_at || b.publishedAt || 0).getTime()
      - new Date(a.injected_at || a.published_at || a.publishedAt || 0).getTime()
  );
  const scoreByTags = (story = {}) => {
    const storyTags = [
      ...(Array.isArray(story.tags) ? story.tags : []),
      ...(Array.isArray(story.keywords) ? story.keywords : []),
    ]
      .map((tag) => normalizeTag(tag))
      .filter(Boolean);
    if (!targetTags.length || !storyTags.length) return 0;
    const shared = targetTags.filter((tag) => storyTags.includes(tag));
    return shared.length / Math.max(targetTags.length, storyTags.length);
  };
  const tagRankedStories = [...filteredAllStories]
    .map((story) => ({
      ...story,
      tagScore: scoreByTags(story),
    }))
    .filter((story) => story.tagScore > 0)
    .sort((a, b) => b.tagScore - a.tagScore);

  const used = new Set();
  const selectUnique = (stories = [], count = 4) => stories.filter((story) => {
    const key = storyKey(story);
    if (!key || used.has(key)) return false;
    used.add(key);
    return true;
  }).slice(0, count);

  renderStoryLinks(sidebarTrendingList, selectUnique(filteredAllStories, 4), "No trending stories available.");
  renderStoryLinks(sidebarLatestList, selectUnique(latestStories, 4), "No latest stories available.");
  renderStoryLinks(sidebarRelatedList, selectUnique(tagRankedStories.length ? tagRankedStories : filteredCategoryStories, 6), "No related stories available.");
  renderRelatedGrid(selectUnique(tagRankedStories.length ? tagRankedStories : (filteredCategoryStories.length ? filteredCategoryStories : filteredAllStories), 6));
}
