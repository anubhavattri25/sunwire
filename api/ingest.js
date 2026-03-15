const crypto = require("node:crypto");
const prisma = require("../backend/config/database");
const newsService = require("../backend/services/news");

function normalizeSecret(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readHeader(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value || "";
}

function readBodyKey(body) {
  if (!body) return "";

  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return normalizeSecret(parsed?.key);
    } catch (_) {
      return "";
    }
  }

  if (typeof body === "object") {
    return normalizeSecret(body.key);
  }

  return "";
}

function getRequestKey(req) {
  const headerKey = normalizeSecret(readHeader(req, "x-ingest-key"));
  if (headerKey) return headerKey;

  const authHeader = normalizeSecret(readHeader(req, "authorization"));
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return normalizeSecret(authHeader.slice("bearer ".length));
  }

  const queryKey = normalizeSecret(Array.isArray(req.query?.key) ? req.query.key[0] : req.query?.key);
  if (queryKey) return queryKey;

  if (req.url) {
    const url = new URL(req.url, "http://localhost");
    const urlKey = normalizeSecret(url.searchParams.get("key"));
    if (urlKey) return urlKey;
  }

  return readBodyKey(req.body);
}

function getConfiguredSecrets() {
  return [process.env.INGEST_SECRET, process.env.CRON_SECRET]
    .map(normalizeSecret)
    .filter(Boolean);
}

function secretsMatch(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const requestKey = getRequestKey(req);
  const configuredSecrets = getConfiguredSecrets();

  if (!configuredSecrets.length) {
    return res.status(503).json({
      ok: false,
      message: "Ingestion secret is not configured",
    });
  }

  const isAuthorized = requestKey && configuredSecrets.some((secret) => secretsMatch(requestKey, secret));

  if (!isAuthorized) {
    return res.status(403).json({
      ok: false,
      message: "Unauthorized request",
    });
  }

  console.log("Sunwire ingestion authorized");

  try {
    await newsService.runPipeline();

    return res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      message: "Pipeline executed successfully",
      pipeline: newsService.getPublicPipelineState(),
    });
  } catch (err) {
    console.error("Ingestion error:", err);

    return res.status(500).json({
      ok: false,
      message: "Pipeline failed",
      error: err.message,
    });
  } finally {
    await prisma.$disconnect().catch(() => null);
  }
};
