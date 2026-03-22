const fs = require("fs");
const fsPromises = require("fs/promises");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 3000);
const CATEGORY_FILTERS = new Set(["general", "ai", "tech", "entertainment", "sports", "business", "politics", "jobs", "food"]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function loadEnvFile(filePath = "") {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) return;

      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;

      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    });
  } catch (_) {
    // Optional local env file.
  }
}

loadEnvFile(path.join(ROOT_DIR, ".env"));
loadEnvFile(path.join(ROOT_DIR, "backend", ".env"));

const HANDLERS = {
  "/api/article": require("./api/article"),
  "/api/article-page": require("./api/article-page"),
  "/api/article-redirect": require("./api/article-redirect"),
  "/api/health": require("./api/health"),
  "/api/ingest": require("./api/ingest"),
  "/api/news": require("./api/news"),
  "/api/news-sitemap": require("./api/news-sitemap"),
  "/api/page": require("./api/page"),
  "/api/sidebar": require("./api/sidebar"),
  "/api/sitemap": require("./api/sitemap"),
};

function appendQuery(targetPath, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${targetPath}?${query}` : targetPath;
}

function resolveRoute(pathname = "", searchParams = new URLSearchParams()) {
  if (pathname === "/sitemap.xml") {
    return appendQuery("/api/sitemap", Object.fromEntries(searchParams.entries()));
  }

  if (pathname === "/news-sitemap.xml") {
    return appendQuery("/api/news-sitemap", Object.fromEntries(searchParams.entries()));
  }

  if (pathname === "/article") {
    return appendQuery("/api/article-redirect", Object.fromEntries(searchParams.entries()));
  }

  const articlePageMatch = pathname.match(/^\/article\/([^/]+)$/);
  if (articlePageMatch) {
    const params = Object.fromEntries(searchParams.entries());
    params.slug = params.slug || articlePageMatch[1];
    return appendQuery("/api/article-page", params);
  }

  const newsLegacyMatch = pathname.match(/^\/news\/([^/]+)(?:\/.*)?$/);
  if (newsLegacyMatch) {
    const params = Object.fromEntries(searchParams.entries());
    params.id = params.id || newsLegacyMatch[1];
    return appendQuery("/api/article-redirect", params);
  }

  const pageMatch = pathname.match(/^\/page\/(\d+)$/);
  if (pageMatch) {
    const params = Object.fromEntries(searchParams.entries());
    params.page = params.page || pageMatch[1];
    return appendQuery("/api/page", params);
  }

  const categoryPageMatch = pathname.match(/^\/(general|ai|tech|entertainment|sports|business|politics|jobs|food)\/page\/(\d+)$/);
  if (categoryPageMatch) {
    const params = Object.fromEntries(searchParams.entries());
    params.filter = params.filter || categoryPageMatch[1];
    params.page = params.page || categoryPageMatch[2];
    return appendQuery("/api/page", params);
  }

  if (CATEGORY_FILTERS.has(pathname.slice(1))) {
    const params = Object.fromEntries(searchParams.entries());
    params.filter = params.filter || pathname.slice(1);
    return appendQuery("/api/page", params);
  }

  const articleMatch = pathname.match(/^\/(general|ai|tech|entertainment|sports|business|politics|jobs|food|latest)\/([^/]+)$/);
  if (articleMatch) {
    const params = Object.fromEntries(searchParams.entries());
    params.category = params.category || articleMatch[1];
    params.slug = params.slug || articleMatch[2];
    return appendQuery("/api/article-page", params);
  }

  if (pathname === "/") {
    return appendQuery("/api/page", Object.fromEntries(searchParams.entries()));
  }

  return appendQuery(pathname, Object.fromEntries(searchParams.entries()));
}

function enhanceResponse(res) {
  const nativeSetHeader = res.setHeader.bind(res);
  res.setHeader = (key, value) => {
    nativeSetHeader(key, value);
    return res;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  };
  res.send = (payload = "") => {
    if (Buffer.isBuffer(payload)) {
      res.end(payload);
      return;
    }
    if (typeof payload === "object" && payload !== null) {
      res.json(payload);
      return;
    }
    res.end(String(payload));
  };
  return res;
}

async function serveStatic(pathname = "", res) {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidatePaths = pathname === "/"
    ? [relativePath]
    : [relativePath, `${relativePath}.html`, path.join(relativePath, "index.html")];

  for (const candidatePath of candidatePaths) {
    const filePath = path.join(ROOT_DIR, candidatePath);
    const normalizedPath = path.normalize(filePath);

    if (!normalizedPath.startsWith(path.normalize(ROOT_DIR))) {
      res.statusCode = 403;
      res.end("Forbidden");
      return true;
    }

    try {
      const stat = await fsPromises.stat(normalizedPath);
      if (!stat.isFile()) continue;
      const ext = path.extname(normalizedPath).toLowerCase();
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
      res.end(await fsPromises.readFile(normalizedPath));
      return true;
    } catch (_) {
      // Try the next candidate path.
    }
  }

  return false;
}

async function serveNotFound(res) {
  const filePath = path.join(ROOT_DIR, "templates", "404.html");
  try {
    const content = await fsPromises.readFile(filePath);
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(content);
  } catch (_) {
    res.statusCode = 404;
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const rewrittenPath = resolveRoute(requestUrl.pathname, requestUrl.searchParams);
  const handlerUrl = new URL(rewrittenPath, `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathname = handlerUrl.pathname;

  if (!HANDLERS[pathname]) {
    const served = await serveStatic(pathname, res);
    if (!served) await serveNotFound(res);
    return;
  }

  const handlerReq = Object.assign(req, {
    query: Object.fromEntries(handlerUrl.searchParams.entries()),
  });
  const handlerRes = enhanceResponse(res);

  try {
    await HANDLERS[pathname](handlerReq, handlerRes);
  } catch (error) {
    if (!handlerRes.headersSent) {
      handlerRes.status(500).send("Internal server error");
      console.error(error);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Sunwire local server running at http://localhost:${PORT}`);
});
