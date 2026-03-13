export const DISPLAY_TIMEZONE = "Asia/Kolkata";

export function scheduleIdleTask(callback) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 1200 });
    return;
  }

  window.setTimeout(callback, 1);
}

export function isElementNearViewport(element, offset = 320) {
  if (!element) return true;
  const bounds = element.getBoundingClientRect();
  return bounds.top <= window.innerHeight + offset;
}

export function cleanText(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function toTitleCase(value = "") {
  if (String(value).toLowerCase() === "ai") return "AI";

  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function fmtDate(isoString) {
  const timestamp = new Date(isoString);
  if (Number.isNaN(timestamp.getTime())) return "Unknown";

  return timestamp.toLocaleString("en-IN", {
    timeZone: DISPLAY_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function timeAgo(isoString) {
  const timestamp = new Date(isoString);
  if (Number.isNaN(timestamp.getTime())) return "just now";

  const minutes = Math.round((timestamp.getTime() - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");

  return formatter.format(Math.round(hours / 24), "day");
}

export function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function setMetaContent(selector, value = "") {
  const element = document.querySelector(selector);
  if (element) element.setAttribute("content", value);
}

export function setLinkHref(selector, value = "") {
  const element = document.querySelector(selector);
  if (element) element.setAttribute("href", value);
}

export function isUnsplashImage(url = "") {
  return /images\.unsplash\.com/i.test(String(url));
}

export function buildUnsplashVariant(url = "", width = 1200) {
  try {
    const variant = new URL(url);
    variant.searchParams.set("auto", "format");
    variant.searchParams.set("fm", "webp");
    variant.searchParams.set("fit", "crop");
    variant.searchParams.set("w", String(width));
    if (!variant.searchParams.get("q")) variant.searchParams.set("q", "80");
    return variant.toString();
  } catch (_) {
    return url;
  }
}

export function applyResponsiveImage(imageElement, src, options = {}) {
  if (!imageElement) return;

  const {
    alt = "",
    width = 1600,
    height = 900,
    sizes = "100vw",
    highPriority = false,
  } = options;

  imageElement.alt = alt;
  imageElement.width = width;
  imageElement.height = height;
  imageElement.decoding = "async";
  imageElement.loading = highPriority ? "eager" : "lazy";

  if (highPriority) {
    imageElement.fetchPriority = "high";
  } else {
    imageElement.removeAttribute("fetchpriority");
  }

  if (!isUnsplashImage(src)) {
    imageElement.src = src;
    imageElement.removeAttribute("srcset");
    imageElement.removeAttribute("sizes");
    return;
  }

  const widths = [320, 640, 960, 1280, 1600].filter((entry) => entry <= Math.max(width, 1600));
  imageElement.src = buildUnsplashVariant(src, Math.max(width, 1280));
  imageElement.srcset = widths.map((entry) => `${buildUnsplashVariant(src, entry)} ${entry}w`).join(", ");
  imageElement.sizes = sizes;
}
