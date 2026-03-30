const crypto = require("node:crypto");
const axios = require("axios");
const { SITE, buildArticleUrl } = require("../../lib/seo");
const { logEvent } = require("./logger");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const SEARCH_CONSOLE_API_BASE = "https://www.googleapis.com/webmasters/v3";
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const SEARCH_CONSOLE_TOKEN_CACHE = globalThis.__SUNWIRE_SEARCH_CONSOLE_TOKEN_CACHE__ || new Map();

globalThis.__SUNWIRE_SEARCH_CONSOLE_TOKEN_CACHE__ = SEARCH_CONSOLE_TOKEN_CACHE;

function normalizeEnvString(value = "") {
  return String(value || "").trim().replace(/^"(.*)"$/, "$1");
}

function normalizePrivateKey(value = "") {
  return normalizeEnvString(value).replace(/\\n/g, "\n");
}

function normalizeSiteUrl(value = "") {
  const normalized = normalizeEnvString(value);
  if (!normalized) return `${SITE.origin}/`;
  if (normalized.startsWith("sc-domain:")) return normalized;

  try {
    const parsed = new URL(normalized);
    return `${parsed.origin}/`;
  } catch (_) {
    return normalized;
  }
}

function defaultSitemapUrls() {
  return [
    `${SITE.origin}/sitemap.xml`,
    `${SITE.origin}/news-sitemap.xml`,
  ];
}

function getSitemapUrls() {
  const configured = normalizeEnvString(process.env.SEARCH_CONSOLE_SITEMAPS || "");
  if (!configured) return defaultSitemapUrls();

  return configured
    .split(",")
    .map((entry) => normalizeEnvString(entry))
    .filter(Boolean);
}

function getSearchConsoleConfig() {
  const clientEmail = normalizeEnvString(
    process.env.SEARCH_CONSOLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL
  );
  const privateKey = normalizePrivateKey(
    process.env.SEARCH_CONSOLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
  const siteUrl = normalizeSiteUrl(process.env.SEARCH_CONSOLE_SITE_URL || "");
  const sitemapUrls = getSitemapUrls();

  if (!clientEmail || !privateKey) {
    return null;
  }

  return {
    clientEmail,
    privateKey,
    siteUrl,
    sitemapUrls,
  };
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createSignedJwt(config = {}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + (60 * 60);
  const header = base64UrlEncode(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
  }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: config.clientEmail,
    scope: SEARCH_CONSOLE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: expiresAt,
    iat: issuedAt,
  }));
  const unsignedToken = `${header}.${payload}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsignedToken)
    .sign(config.privateKey, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${unsignedToken}.${signature}`;
}

async function fetchAccessToken(config = {}) {
  const cacheKey = `${config.clientEmail}:${config.siteUrl}`;
  const cached = SEARCH_CONSOLE_TOKEN_CACHE.get(cacheKey);
  if (cached && Number(cached.expiresAt || 0) > (Date.now() + TOKEN_REFRESH_SKEW_MS)) {
    return cached.accessToken;
  }

  const assertion = createSignedJwt(config);
  const response = await axios.post(
    GOOGLE_TOKEN_URL,
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
    {
      timeout: 12000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const accessToken = normalizeEnvString(response.data?.access_token || "");
  const expiresInSeconds = Number(response.data?.expires_in || 3600) || 3600;
  if (!accessToken) {
    throw new Error("search_console_access_token_missing");
  }

  SEARCH_CONSOLE_TOKEN_CACHE.set(cacheKey, {
    accessToken,
    expiresAt: Date.now() + (expiresInSeconds * 1000),
  });

  return accessToken;
}

async function submitSitemap(config = {}, accessToken = "", sitemapUrl = "") {
  const endpoint = `${SEARCH_CONSOLE_API_BASE}/sites/${encodeURIComponent(config.siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
  const response = await axios.put(endpoint, null, {
    timeout: 12000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });

  if (response.status >= 200 && response.status < 300) {
    logEvent("seo.search_console.sitemap_submitted", {
      siteUrl: config.siteUrl,
      sitemapUrl,
      status: response.status,
    });
    return true;
  }

  logEvent("seo.search_console.sitemap_submit_failed", {
    siteUrl: config.siteUrl,
    sitemapUrl,
    status: response.status,
    response: response.data || null,
  });
  return false;
}

async function submitSearchConsoleSitemaps() {
  const config = getSearchConsoleConfig();
  if (!config) {
    logEvent("seo.search_console.skipped", {
      reason: "missing_service_account_config",
    });
    return {
      ok: false,
      skipped: true,
      submitted: 0,
    };
  }

  try {
    const accessToken = await fetchAccessToken(config);
    const results = await Promise.all(config.sitemapUrls.map((sitemapUrl) => (
      submitSitemap(config, accessToken, sitemapUrl)
    )));
    const submitted = results.filter(Boolean).length;

    logEvent("seo.search_console.completed", {
      siteUrl: config.siteUrl,
      submitted,
      attempted: config.sitemapUrls.length,
    });

    return {
      ok: submitted > 0,
      skipped: false,
      submitted,
    };
  } catch (error) {
    logEvent("seo.search_console.error", {
      siteUrl: config.siteUrl,
      message: error.message,
    });
    return {
      ok: false,
      skipped: false,
      submitted: 0,
      error: error.message,
    };
  }
}

function buildPublishedArticleUrl(article = {}) {
  const id = normalizeEnvString(article.id || "");
  const slug = normalizeEnvString(article.slug || "");
  const title = normalizeEnvString(article.title || article.headline || "");
  const category = normalizeEnvString(article.category || "latest");

  if (!id && !slug && !title) return "";

  return buildArticleUrl({
    id,
    slug,
    title,
    category,
  });
}

async function requestPublishedArticleIndexing(article = {}) {
  const articleUrl = buildPublishedArticleUrl(article);

  try {
    const sitemapResult = await submitSearchConsoleSitemaps();
    const result = {
      ...sitemapResult,
      articleUrl,
      requestedAt: new Date().toISOString(),
    };

    logEvent("seo.article_indexing.requested", {
      articleUrl,
      ok: result.ok,
      skipped: result.skipped,
      submitted: result.submitted,
      error: result.error || "",
    });

    return result;
  } catch (error) {
    const result = {
      ok: false,
      skipped: false,
      submitted: 0,
      articleUrl,
      requestedAt: new Date().toISOString(),
      error: error.message || "search_console_request_failed",
    };

    logEvent("seo.article_indexing.error", result);
    return result;
  }
}

module.exports = {
  requestPublishedArticleIndexing,
  submitSearchConsoleSitemaps,
  pingGoogleSitemaps: submitSearchConsoleSitemaps,
};
