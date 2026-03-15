const { cleanText, extractImageFromHtml, fetchTextNoCache } = require("../article/shared");
const { MAX_IMAGE_CACHE_SIZE, STORY_IMAGE_CACHE_TTL_MS } = require("./newsConfig");

const DEFAULT_FETCH_TIMEOUT_MS = 2500;
const DEFAULT_REMOTE_FETCH_LIMIT = 6;
const DEFAULT_CONCURRENCY = 3;
const STORY_IMAGE_CACHE = globalThis.__SUNWIRE_STORY_IMAGE_CACHE__ || new Map();
const PLACEHOLDER_PALETTES = [
  { background: "1E3A8A", foreground: "F8FAFC" },
  { background: "7C2D12", foreground: "FFFBEB" },
  { background: "14532D", foreground: "F7FEE7" },
  { background: "581C87", foreground: "FAF5FF" },
  { background: "0F766E", foreground: "F0FDFA" },
  { background: "9A3412", foreground: "FFF7ED" },
  { background: "1F2937", foreground: "F9FAFB" },
  { background: "831843", foreground: "FFF1F2" },
];

globalThis.__SUNWIRE_STORY_IMAGE_CACHE__ = STORY_IMAGE_CACHE;

function normalizeSourceUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function hashText(value = "") {
  return Array.from(String(value || "")).reduce(
    (hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0,
    7
  );
}

function hasRenderableStoryImage(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (/^data:image\//i.test(normalized)) return true;
  if (!/^https?:\/\//i.test(normalized)) return false;
  return !/\.svg(\?|$)/i.test(normalized);
}

function normalizeStoryImageUrl(candidate = "", baseUrl = "") {
  const normalized = String(candidate || "").trim();
  if (!normalized) return "";
  if (/^data:image\//i.test(normalized)) return normalized;

  try {
    const resolved = /^https?:\/\//i.test(normalized)
      ? normalized
      : new URL(normalized, baseUrl).toString();
    return hasRenderableStoryImage(resolved) ? resolved : "";
  } catch (_) {
    return "";
  }
}

function formatPlaceholderCategory(value = "") {
  return cleanText(String(value || "latest").replace(/[-_]+/g, " ")).toUpperCase();
}

function formatPlaceholderSource(value = "") {
  return cleanText(value || "Sunwire").slice(0, 28);
}

function formatPlaceholderTitle(value = "") {
  const title = cleanText(value || "Sunwire story");
  if (title.length <= 54) return title;
  return `${title.slice(0, 51).trim()}...`;
}

function buildStoryPlaceholderImage(story = {}) {
  const paletteSeed = [
    story.title,
    story.summary,
    story.category,
    story.source,
    story.sourceUrl,
    story.source_url,
  ].filter(Boolean).join("|");
  const palette = PLACEHOLDER_PALETTES[hashText(paletteSeed) % PLACEHOLDER_PALETTES.length];
  const text = [
    formatPlaceholderCategory(story.category || "latest"),
    formatPlaceholderTitle(story.title || "Sunwire story"),
    formatPlaceholderSource(story.source || "Sunwire"),
  ].join(" | ");

  return `https://placehold.co/1200x675/${palette.background}/${palette.foreground}?text=${encodeURIComponent(text)}`;
}

function pruneStoryImageCache() {
  if (STORY_IMAGE_CACHE.size <= MAX_IMAGE_CACHE_SIZE) return;
  const entries = [...STORY_IMAGE_CACHE.entries()].sort(
    (left, right) => Number(left?.[1]?.updatedAt || 0) - Number(right?.[1]?.updatedAt || 0)
  );
  const pruneCount = Math.max(1, STORY_IMAGE_CACHE.size - MAX_IMAGE_CACHE_SIZE);
  entries.slice(0, pruneCount).forEach(([key]) => STORY_IMAGE_CACHE.delete(key));
}

function getCachedStoryImage(sourceUrl = "") {
  const normalized = normalizeSourceUrl(sourceUrl);
  if (!normalized) return { found: false, value: "" };

  const entry = STORY_IMAGE_CACHE.get(normalized);
  if (!entry) return { found: false, value: "" };
  if (Number(entry.expiresAt || 0) <= Date.now()) {
    STORY_IMAGE_CACHE.delete(normalized);
    return { found: false, value: "" };
  }

  return { found: true, value: String(entry.value || "") };
}

function setCachedStoryImage(sourceUrl = "", value = "") {
  const normalized = normalizeSourceUrl(sourceUrl);
  if (!normalized) return;

  STORY_IMAGE_CACHE.set(normalized, {
    value: String(value || ""),
    updatedAt: Date.now(),
    expiresAt: Date.now() + STORY_IMAGE_CACHE_TTL_MS,
  });
  pruneStoryImageCache();
}

async function fetchStoryImageFromSource(sourceUrl = "", options = {}) {
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  if (!/^https?:\/\//i.test(normalizedSourceUrl)) return "";

  const cached = getCachedStoryImage(normalizedSourceUrl);
  if (cached.found) return cached.value;

  try {
    const html = await fetchTextNoCache(normalizedSourceUrl, {
      timeoutMs: Number(options.timeoutMs || DEFAULT_FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "SunwireBot/1.0 (+https://sunwire.in)",
      },
    });
    const image = normalizeStoryImageUrl(extractImageFromHtml(html), normalizedSourceUrl);
    setCachedStoryImage(normalizedSourceUrl, image);
    return image;
  } catch (_) {
    setCachedStoryImage(normalizedSourceUrl, "");
    return "";
  }
}

function withResolvedStoryImage(story = {}, image = "") {
  const resolved = hasRenderableStoryImage(image) ? image : buildStoryPlaceholderImage(story);
  return {
    ...story,
    image: resolved,
    image_url: String(story.image_url || "").trim() || resolved,
  };
}

async function resolveStoryImage(story = {}, options = {}) {
  const sourceUrl = normalizeSourceUrl(story.sourceUrl || story.source_url || story.url || "");
  const candidate = normalizeStoryImageUrl(
    story.image || story.image_url || story.image_storage_url || "",
    sourceUrl
  );
  if (candidate) return candidate;

  if (options.allowRemoteFetch !== false && /^https?:\/\//i.test(sourceUrl)) {
    const extracted = await fetchStoryImageFromSource(sourceUrl, options);
    if (extracted) return extracted;
  }

  return buildStoryPlaceholderImage(story);
}

async function runWithConcurrency(tasks = [], concurrency = DEFAULT_CONCURRENCY) {
  const safeConcurrency = Math.max(1, Number(concurrency) || DEFAULT_CONCURRENCY);
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, Math.max(tasks.length, 1)) }, () => worker())
  );

  return results;
}

async function enrichStoriesWithImages(stories = [], options = {}) {
  const input = Array.isArray(stories) ? stories : [];
  const allowRemoteFetch = options.allowRemoteFetch !== false;
  const remoteFetchLimit = Math.max(
    0,
    allowRemoteFetch
      ? Number.parseInt(options.remoteFetchLimit ?? DEFAULT_REMOTE_FETCH_LIMIT, 10) || DEFAULT_REMOTE_FETCH_LIMIT
      : 0
  );
  const fetchableIndexes = new Set();
  let budget = remoteFetchLimit;

  for (let index = 0; index < input.length; index += 1) {
    const story = input[index] || {};
    const sourceUrl = normalizeSourceUrl(story.sourceUrl || story.source_url || story.url || "");
    const existing = normalizeStoryImageUrl(
      story.image || story.image_url || story.image_storage_url || "",
      sourceUrl
    );

    if (existing || budget <= 0 || !/^https?:\/\//i.test(sourceUrl)) continue;
    fetchableIndexes.add(index);
    budget -= 1;
  }

  const tasks = input.map((story = {}, index) => async () => {
    const resolved = await resolveStoryImage(story, {
      ...options,
      allowRemoteFetch: fetchableIndexes.has(index),
    });
    return withResolvedStoryImage(story, resolved);
  });

  return runWithConcurrency(tasks, options.concurrency);
}

module.exports = {
  buildStoryPlaceholderImage,
  enrichStoriesWithImages,
  fetchStoryImageFromSource,
  hasRenderableStoryImage,
  normalizeStoryImageUrl,
  resolveStoryImage,
  withResolvedStoryImage,
};
