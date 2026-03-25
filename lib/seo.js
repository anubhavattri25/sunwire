const path = require("path");
const fs = require("fs");
const { buildResponsiveImageConfig } = require("./server/storyImages");

const SITE = {
  name: "Sunwire",
  domain: "sunwire.in",
  origin: "https://sunwire.in",
  defaultTitle: "Sunwire - Latest AI, Tech, Entertainment and Sports News",
  defaultDescription: "Sunwire delivers fresh AI, technology, entertainment, sports, and business news with concise summaries and practical insights.",
  defaultOgDescription: "Fresh AI, tech, entertainment, sports, and business stories with practical summaries and daily highlights.",
  socialImage: "https://sunwire.in/social-card.svg",
  logo: "https://sunwire.in/logo.png",
  founder: "Anubhav Attri",
  newsroomAuthor: "Sunwire News Desk",
};

const DEFAULT_GA_MEASUREMENT_ID = "G-GK3J8G4KTV";
const ADSENSE_HEAD_SCRIPT = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5608383950266105" crossorigin="anonymous"></script>';

const FILTER_METADATA = {
  all: {
    label: "Latest",
    title: SITE.defaultTitle,
    description: SITE.defaultDescription,
  },
  latest: {
    label: "Latest",
    title: SITE.defaultTitle,
    description: SITE.defaultDescription,
  },
  general: {
    label: "General",
    title: "General News | Sunwire",
    description: "Latest general news and major headlines curated for Indian readers on Sunwire.",
  },
  ai: {
    label: "AI",
    title: "AI News | Sunwire",
    description: "Latest AI news, model launches, developer tools, chips, and practical coverage curated by Sunwire.",
  },
  tech: {
    label: "Tech",
    title: "Tech News | Sunwire",
    description: "Latest technology news across software, platforms, cloud, cybersecurity, chips, and product launches on Sunwire.",
  },
  entertainment: {
    label: "Entertainment",
    title: "Entertainment News | Sunwire",
    description: "Latest entertainment news covering films, streaming, creators, music, celebrity culture, and releases on Sunwire.",
  },
  sports: {
    label: "Sports",
    title: "Sports News | Sunwire",
    description: "Latest sports news with fast reads across cricket, football, major tournaments, athletes, and match momentum on Sunwire.",
  },
  business: {
    label: "Business",
    title: "Business News | Sunwire",
    description: "Latest business news on startups, funding, markets, earnings, platform economics, and company moves on Sunwire.",
  },
  politics: {
    label: "Politics",
    title: "Politics News | Sunwire",
    description: "Latest politics news covering ministers, policy, elections, government, and power moves on Sunwire.",
  },
  jobs: {
    label: "Jobs",
    title: "Jobs News | Sunwire",
    description: "Latest jobs and hiring news covering recruitment, vacancies, careers, and government opportunities on Sunwire.",
  },
  food: {
    label: "Food",
    title: "Food News | Sunwire",
    description: "Latest food news covering recipes, dining, restaurants, ingredients, chefs, and Indian cooking on Sunwire.",
  },
  "startups-funding": {
    label: "Startups & Funding",
    title: "Startups & Funding News | Sunwire",
    description: "Latest startup funding, venture, earnings, and market coverage with concise business updates from Sunwire.",
  },
};

const SECTION_PATHS = {
  all: "/",
  latest: "/",
  general: "/general",
  ai: "/ai",
  tech: "/tech",
  entertainment: "/entertainment",
  sports: "/sports",
  business: "/business",
  politics: "/politics",
  jobs: "/jobs",
  food: "/food",
};

function cleanText(text = "") {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(text = "") {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonLd(value) {
  return `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
}

function toAbsoluteUrl(value = "") {
  const input = String(value || "").trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  if (input.startsWith("/")) return `${SITE.origin}${input}`;
  return `${SITE.origin}/${input.replace(/^\/+/, "")}`;
}

function originForUrl(value = "") {
  try {
    return new URL(value).origin;
  } catch (_) {
    return "";
  }
}

function decodeParam(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (_) {
    return String(value || "");
  }
}

function slugify(value = "") {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return normalized || "story";
}

function normalizeFilter(filter = "all") {
  const value = String(filter || "all").toLowerCase();
  if (value === "india-pulse" || value === "war-conflict") return "all";
  if (value === "startups-funding") return "business";
  return FILTER_METADATA[value] ? value : "all";
}

function normalizePageNumber(page = 1) {
  return Math.max(1, Number(page) || 1);
}

function buildSectionPath(filter = "all", page = 1) {
  const normalizedFilter = normalizeFilter(filter);
  const safePage = normalizePageNumber(page);
  const basePath = SECTION_PATHS[normalizedFilter] || "/";

  if (safePage <= 1) return basePath;
  if (normalizedFilter === "all") return `/page/${safePage}`;
  return `${basePath}/page/${safePage}`;
}

function buildSectionUrl(filter = "all", page = 1) {
  return toAbsoluteUrl(buildSectionPath(filter, page));
}

function buildCanonicalUrl(pathname = "/", params = {}) {
  const url = new URL(pathname, SITE.origin);
  Object.entries(params).forEach(([key, value]) => {
    const normalized = cleanText(value);
    if (!normalized) return;
    url.searchParams.set(key, normalized);
  });
  url.hash = "";
  return url.toString();
}

function buildArticleCanonical(query = {}) {
  const articleId = cleanText(decodeParam(query.id || ""));
  const articleTitle = cleanText(decodeParam(query.t || query.title || ""));
  const articleCategory = cleanText(decodeParam(query.c || query.category || ""));
  const articleSlug = cleanText(decodeParam(query.slug || ""));
  if (articleId || articleSlug || articleTitle) {
    return buildArticleUrl({
      id: articleId,
      slug: articleSlug,
      title: articleTitle,
      category: articleCategory,
    });
  }

  const ordered = {};
  ["id", "u", "t", "s", "c", "p", "m", "i"].forEach((key) => {
    const rawValue = query[key];
    if (rawValue == null || rawValue === "") return;
    ordered[key] = decodeParam(rawValue);
  });
  return Object.keys(ordered).length ? buildCanonicalUrl("/", ordered) : SITE.origin;
}

function pageSuffix(page = 1) {
  return page > 1 ? ` - Page ${page}` : "";
}

function articleCategoryPath(category = "all") {
  const normalizedCategory = normalizeFilter(category);
  return normalizedCategory === "all" ? "latest" : normalizedCategory;
}

function buildArticleSlug(input = {}) {
  return slugify(input.slug || input.title || input.headline || input.id || "story");
}

function buildArticlePath(input = {}) {
  const articleSlug = buildArticleSlug(input);
  if (!articleSlug) return "/";
  return `/article/${articleSlug}`;
}

function buildArticleUrl(input = {}) {
  return toAbsoluteUrl(buildArticlePath(input));
}

function buildBreadcrumbList(items = []) {
  if (!Array.isArray(items) || items.length < 2) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.item,
    })),
  };
}

function buildOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    url: SITE.origin,
    logo: {
      "@type": "ImageObject",
      url: SITE.logo,
    },
    founder: {
      "@type": "Person",
      name: SITE.founder,
    },
  };
}

function buildWebsiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.origin,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE.origin}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

function buildHomeState(query = {}) {
  const filter = normalizeFilter(query.filter || "all");
  const page = normalizePageNumber(query.page || 1);
  const searchQuery = cleanText(query.q || "");
  const metadata = FILTER_METADATA[filter] || FILTER_METADATA.all;
  const indexable = !searchQuery;
  const canonical = buildSectionUrl(filter, page);
  const titleBase = filter === "all" ? SITE.defaultTitle : metadata.title;
  const title = indexable
    ? `${titleBase}${pageSuffix(page)}`
    : `Search results for "${searchQuery}" | Sunwire`;
  const description = indexable
    ? `${metadata.description}${page > 1 ? ` Page ${page} of Sunwire coverage.` : ""}`
    : `Search results for ${searchQuery} on Sunwire.`;
  const breadcrumbs = [];

  if (filter !== "all") {
    breadcrumbs.push({ name: "Home", item: SITE.origin });
    breadcrumbs.push({ name: metadata.label, item: buildSectionUrl(filter, 1) });
    if (page > 1) {
      breadcrumbs.push({ name: `Page ${page}`, item: canonical });
    }
  } else if (page > 1) {
    breadcrumbs.push({ name: "Home", item: SITE.origin });
    breadcrumbs.push({ name: `Page ${page}`, item: canonical });
  }

  const jsonLd = [
    buildOrganizationJsonLd(),
    buildWebsiteJsonLd(),
  ];

  if (indexable) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: cleanText(title),
      description: cleanText(description),
      url: canonical,
      isPartOf: {
        "@type": "WebSite",
        name: SITE.name,
        url: SITE.origin,
      },
    });
  }

  const breadcrumbJsonLd = buildBreadcrumbList(breadcrumbs);
  if (breadcrumbJsonLd) jsonLd.push(breadcrumbJsonLd);

  return {
    type: "website",
    title,
    description,
    canonical,
    robots: indexable ? "index, follow, max-image-preview:large" : "noindex, follow",
    ogImage: SITE.socialImage,
    filter,
    page,
    searchQuery,
    jsonLd,
    breadcrumbs,
    prevUrl: indexable && page > 1
      ? buildSectionUrl(filter, page - 1)
      : "",
    nextUrl: "",
  };
}

function normalizeIsoDate(value = "") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function buildArticleState(query = {}) {
  const title = cleanText(decodeParam(query.t || "")) || "Story";
  const source = cleanText(decodeParam(query.s || "")) || SITE.newsroomAuthor;
  const category = normalizeFilter(query.c || "all");
  const publishedAt = normalizeIsoDate(decodeParam(query.p || ""));
  const modifiedAt = normalizeIsoDate(decodeParam(query.modifiedAt || query.updatedAt || query.dateModified || "")) || publishedAt;
  const summary = cleanText(decodeParam(query.m || "")) || "Read the full story on SunWire.";
  const description = summary.slice(0, 160);
  const image = toAbsoluteUrl(decodeParam(query.i || "")) || SITE.socialImage;
  const canonical = buildArticleCanonical(query);
  const articleTitle = `${title} | Sunwire`;
  const articleSection = FILTER_METADATA[category]?.label || "Latest";
  const hasIdentity = Boolean(cleanText(query.id || query.u || query.t || query.slug || ""));
  const authorName = cleanText(decodeParam(query.authorName || query.author || "")) || SITE.newsroomAuthor;
  const keywords = cleanText(decodeParam(query.tags || ""))
    .split(",")
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .slice(0, 5);
  const wordCount = Number(query.wordCount || 0) || undefined;
  const articleBody = cleanText(decodeParam(query.articleBody || ""));
  const primarySourceUrl = toAbsoluteUrl(decodeParam(query.primarySourceUrl || ""));
  const breadcrumbs = [
    { name: "Home", item: SITE.origin },
    {
      name: articleSection,
      item: buildSectionUrl(category, 1),
    },
    { name: title, item: canonical },
  ];
  const jsonLd = [
    buildOrganizationJsonLd(),
    buildWebsiteJsonLd(),
    buildBreadcrumbList(breadcrumbs),
    {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: title,
      description,
      image: image ? [image] : undefined,
      datePublished: publishedAt || undefined,
      dateModified: modifiedAt || publishedAt || undefined,
      author: {
        "@type": "Person",
        name: authorName,
      },
      publisher: {
        "@type": "Organization",
        name: SITE.name,
        logo: {
          "@type": "ImageObject",
          url: SITE.logo,
        },
      },
      articleSection,
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": canonical,
      },
      url: canonical,
      keywords: keywords.length ? keywords.join(", ") : undefined,
      wordCount,
      articleBody: articleBody || undefined,
      sameAs: primarySourceUrl || undefined,
    },
  ].filter(Boolean);

  return {
    hasIdentity,
    title: articleTitle,
    headline: title,
    ogTitle: title,
    description,
    canonical,
    robots: hasIdentity ? "index, follow, max-image-preview:large" : "noindex, follow",
    ogImage: image,
    ogImageWidth: Number(query.ogImageWidth || 1200) || 1200,
    ogImageHeight: Number(query.ogImageHeight || 675) || 675,
    source,
    authorName,
    publishedAt,
    modifiedAt,
    articleSection,
    jsonLd,
    breadcrumbs,
  };
}

function injectHead(html, state = {}) {
  let output = String(html || "");
  const analyticsHead = buildAnalyticsHead(process.env.GA_MEASUREMENT_ID || DEFAULT_GA_MEASUREMENT_ID);

  const replacements = [
    [/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(state.title || SITE.defaultTitle)}</title>`],
    [/<meta name="description" content="[^"]*"\s*\/?>/i, `<meta name="description" content="${escapeHtml(state.description || SITE.defaultDescription)}" />`],
    [/<meta name="robots" content="[^"]*"\s*\/?>/i, `<meta name="robots" content="${escapeHtml(state.robots || "index, follow, max-image-preview:large")}" />`],
    [/<link rel="canonical" href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${escapeHtml(state.canonical || SITE.origin)}" />`],
    [/<meta property="og:type" content="[^"]*"\s*\/?>/i, `<meta property="og:type" content="${escapeHtml(state.type === "article" ? "article" : "website")}" />`],
    [/<meta property="og:title" content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${escapeHtml(state.ogTitle || state.title || SITE.defaultTitle)}" />`],
    [/<meta property="og:description" content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${escapeHtml(state.description || SITE.defaultOgDescription)}" />`],
    [/<meta property="og:url" content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${escapeHtml(state.canonical || SITE.origin)}" />`],
    [/<meta property="og:site_name" content="[^"]*"\s*\/?>/i, `<meta property="og:site_name" content="${escapeHtml(SITE.name)}" />`],
    [/<meta property="og:image" content="[^"]*"(?:\s+id="[^"]*")?\s*\/?>/i, `<meta property="og:image" content="${escapeHtml(state.ogImage || SITE.socialImage)}" />`],
    [/<meta name="twitter:title" content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${escapeHtml(state.title || SITE.defaultTitle)}" />`],
    [/<meta name="twitter:description" content="[^"]*"\s*\/?>/i, `<meta name="twitter:description" content="${escapeHtml(state.description || SITE.defaultOgDescription)}" />`],
    [/<meta name="twitter:image" content="[^"]*"(?:\s+id="[^"]*")?\s*\/?>/i, `<meta name="twitter:image" content="${escapeHtml(state.ogImage || SITE.socialImage)}" />`],
  ];

  replacements.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });

  if (analyticsHead && !/googletagmanager\.com\/gtag\/js\?id=/i.test(output)) {
    output = output.replace(/<head>/i, `<head>${analyticsHead}`);
  }

  if (state.enableAdsense && !/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-5608383950266105/i.test(output)) {
    output = output.replace(/<\/head>/i, `${ADSENSE_HEAD_SCRIPT}</head>`);
  }

  const resourceHints = [];
  const preloadImageConfig = buildResponsiveImageConfig(state.preloadImage || state.ogImage || "", {
    width: Number(state.preloadImageWidth || 1600) || 1600,
    height: Number(state.preloadImageHeight || 900) || 900,
    sizes: state.preloadImageSizes || "100vw",
  });
  const imageUrl = toAbsoluteUrl(preloadImageConfig.preloadHref || preloadImageConfig.src || state.ogImage || "");
  const imageOrigin = originForUrl(imageUrl);
  if (imageOrigin && imageOrigin !== SITE.origin) {
    resourceHints.push(`<link rel="preconnect" href="${escapeHtml(imageOrigin)}" crossorigin />`);
  }
  if (state.type === "article" && imageUrl && imageUrl !== SITE.socialImage) {
    resourceHints.push([
      `<link rel="preload" as="image" href="${escapeHtml(imageUrl)}"`,
      preloadImageConfig.preloadSrcset
        ? ` imagesrcset="${escapeHtml(preloadImageConfig.preloadSrcset)}"`
        : "",
      preloadImageConfig.preloadSizes
        ? ` imagesizes="${escapeHtml(preloadImageConfig.preloadSizes)}"`
        : "",
      " />",
    ].join(""));
  }

  output = output.replace(
    /<\/head>/i,
    [
      ...resourceHints,
      state.publishedAt ? `<meta property="article:published_time" content="${escapeHtml(state.publishedAt)}" />` : "",
      state.modifiedAt ? `<meta property="article:modified_time" content="${escapeHtml(state.modifiedAt)}" />` : "",
      state.authorName ? `<meta name="author" content="${escapeHtml(state.authorName)}" />` : "",
      state.ogImageWidth ? `<meta property="og:image:width" content="${escapeHtml(String(state.ogImageWidth))}" />` : "",
      state.ogImageHeight ? `<meta property="og:image:height" content="${escapeHtml(String(state.ogImageHeight))}" />` : "",
      state.prevUrl ? `<link rel="prev" href="${escapeHtml(state.prevUrl)}" />` : "",
      state.nextUrl ? `<link rel="next" href="${escapeHtml(state.nextUrl)}" />` : "",
      ...(state.jsonLd || []).map((item) => safeJsonLd(item)),
      "</head>",
    ].filter(Boolean).join(""),
  );

  output = output.replace(
    /<\/body>/i,
    `${buildAnalyticsBootstrap(process.env.GA_MEASUREMENT_ID || DEFAULT_GA_MEASUREMENT_ID)}</body>`,
  );

  return output;
}

function buildAnalyticsHead(measurementId = "") {
  return "";
}

function buildAnalyticsBootstrap(measurementId = "") {
  const id = cleanText(measurementId);
  if (!id) return "";
  return [
    "<script>",
    "(function(){",
    `var measurementId=${JSON.stringify(id)};`,
    "function boot(){",
    "if(window.__SUNWIRE_ANALYTICS_BOOTED||!measurementId)return;",
    "window.__SUNWIRE_ANALYTICS_BOOTED=true;",
    "window.__SUNWIRE_GA_ID=measurementId;",
    "window.dataLayer=window.dataLayer||[];",
    "window.gtag=window.gtag||function(){dataLayer.push(arguments);};",
    "var gtagScript=document.createElement('script');",
    "gtagScript.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(measurementId);",
    "gtagScript.async=true;",
    "document.head.appendChild(gtagScript);",
    "window.gtag('js',new Date());",
    "window.gtag('config',measurementId,{send_page_view:false,anonymize_ip:true});",
    "var analyticsScript=document.createElement('script');",
    "analyticsScript.src='/analytics.js';",
    "analyticsScript.defer=true;",
    "document.body.appendChild(analyticsScript);",
    "}",
    "if(document.readyState==='complete'){window.setTimeout(boot,1);}else{window.addEventListener('load',function(){window.setTimeout(boot,1);},{once:true});}",
    "})();",
    "</script>",
  ].join("");
}

function minifyHtml(html = "") {
  return String(html || "")
    .replace(/>\s+</g, "><")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const TEMPLATE_ROOT = path.resolve(__dirname, "..", "templates");
const templateCache = new Map();

[
  "index.html",
  "article.html",
  "404.html",
].forEach((filename) => {
  try {
    const filePath = path.join(TEMPLATE_ROOT, filename);
    templateCache.set(filePath, fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    // Fall back to on-demand reads if a template is unavailable during startup.
  }
});

function readTemplate(filename = "") {
  const filePath = path.join(TEMPLATE_ROOT, filename);
  const cached = templateCache.get(filePath);
  if (cached) return cached;
  const template = fs.readFileSync(filePath, "utf8");
  templateCache.set(filePath, template);
  return template;
}

module.exports = {
  SITE,
  cleanText,
  escapeHtml,
  normalizeFilter,
  normalizePageNumber,
  buildCanonicalUrl,
  buildSectionPath,
  buildSectionUrl,
  articleCategoryPath,
  buildArticleSlug,
  buildArticlePath,
  buildArticleUrl,
  buildArticleCanonical,
  buildHomeState,
  buildArticleState,
  injectHead,
  minifyHtml,
  readTemplate,
  slugify,
  decodeParam,
  FILTER_METADATA,
};
