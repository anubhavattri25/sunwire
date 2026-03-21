const fs = require("fs");
const path = require("path");
const prisma = require("../backend/config/database");
const { scrapeArticle } = require("../backend/utils/articleScraper");
const { cleanArticleTextForRewrite } = require("../backend/services/localAiRewrite");
const { buildArticlesFromTopics, saveArticle } = require("../backend/services/articleProcessor");

function loadEnvFile(filename) {
  const filePath = path.join(__dirname, "..", filename);
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, "$1");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv = []) {
  const args = {
    limit: 1,
    loop: false,
    sleepMs: 0,
    mode: "all",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--limit") {
      args.limit = Math.max(1, Number.parseInt(argv[index + 1] || "1", 10) || 1);
    }
    if (token === "--loop") {
      args.loop = true;
    }
    if (token === "--sleep-ms") {
      args.sleepMs = Math.max(0, Number.parseInt(argv[index + 1] || "0", 10) || 0);
    }
    if (token === "--mode") {
      const mode = String(argv[index + 1] || "all").trim().toLowerCase();
      if (["all", "images", "rewrite"].includes(mode)) {
        args.mode = mode;
      }
    }
  }

  return args;
}

function wait(ms = 0) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRawMetadata(value = "") {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function isRealImage(value = "") {
  const image = String(value || "").trim();
  return Boolean(image) && !/placehold\.co/i.test(image);
}

function needsRewrite(article = {}) {
  const metadata = parseRawMetadata(article.raw_content);
  return !(metadata.ai_rewritten || metadata.rewriteStatus === "ai_rewritten");
}

function needsImage(article = {}) {
  return !isRealImage(article.image_url);
}

function isCandidate(article = {}, mode = "all") {
  if (mode === "images") return needsImage(article);
  if (mode === "rewrite") return needsRewrite(article);
  return needsImage(article) || needsRewrite(article);
}

async function chooseBestSourcePacket(article = {}) {
  const sourceUrl = String(article.source_url || "").trim();
  const storedContent = cleanArticleTextForRewrite(article.content || article.summary || "");
  let imageUrl = String(article.image_url || "").trim();
  let content = storedContent;

  if (!/^https?:\/\//i.test(sourceUrl)) {
    return { content, image_url: imageUrl };
  }

  try {
    const scraped = await scrapeArticle(sourceUrl);
    const scrapedContent = cleanArticleTextForRewrite(scraped.content || "");
    if (scrapedContent.length > content.length) {
      content = scrapedContent;
    }
    if (isRealImage(scraped.imageUrl)) {
      imageUrl = scraped.imageUrl;
    }
  } catch (error) {
    console.log("SCRAPE FAILED:", article.title, error.message);
  }

  return { content, image_url: imageUrl };
}

async function fetchCandidates(limit = 1, mode = "all") {
  const rows = await prisma.article.findMany({
    orderBy: [
      { created_at: "desc" },
    ],
    select: {
      id: true,
      title: true,
      summary: true,
      content: true,
      raw_content: true,
      image_url: true,
      category: true,
      source: true,
      source_url: true,
      published_at: true,
      views: true,
      shares: true,
    },
  });

  return rows.filter((row) => isCandidate(row, mode)).slice(0, limit);
}

async function processArticle(row = {}, mode = "all") {
  const sourcePacket = await chooseBestSourcePacket(row);
  const bestContent = sourcePacket.content || cleanArticleTextForRewrite(row.content || row.summary || "");
  const imageUrl = sourcePacket.image_url || row.image_url || "";
  const shouldRewrite = mode !== "images" && needsRewrite(row);

  if (!bestContent && !imageUrl) {
    console.log("SKIP:", row.title, "no usable content or image");
    return { updated: false, reason: "empty_source" };
  }

  if (!shouldRewrite && mode === "images") {
    const saved = await saveArticle({
      id: row.id,
      title: row.title,
      slug: row.slug,
      summary: row.summary,
      content: row.content,
      image_url: imageUrl,
      category: row.category,
      source: row.source,
      source_url: row.source_url,
      published_at: row.published_at,
      views: row.views,
      shares: row.shares,
      raw_content: row.raw_content,
      existing_id: row.id,
    });
    console.log("IMAGE UPDATED:", saved.title);
    return { updated: true, reason: "image_only" };
  }

  const [rebuilt] = await buildArticlesFromTopics([{
    title: row.title,
    summary: row.summary,
    content: bestContent || row.content || row.summary,
    image_url: imageUrl,
    category: row.category,
    source: row.source,
    source_url: row.source_url,
    published_at: row.published_at,
    views: row.views,
    shares: row.shares,
  }]);

  if (!rebuilt) {
    console.log("SKIP:", row.title, "rebuild returned null");
    return { updated: false, reason: "rebuild_null" };
  }

  rebuilt.existing_id = row.id;
  rebuilt.image_url = imageUrl || rebuilt.image_url || "";

  const saved = await saveArticle(rebuilt);
  const metadata = parseRawMetadata(saved.raw_content);
  console.log(
    "UPDATED:",
    saved.title,
    `rewrite=${metadata.rewriteStatus || "unknown"}`,
    `image=${isRealImage(saved.image_url) ? "yes" : "no"}`
  );

  return { updated: true, reason: metadata.rewriteStatus || "updated" };
}

async function main() {
  loadEnvFile(".env.vercel.local");
  loadEnvFile(".env.vercel.production");

  const args = parseArgs(process.argv.slice(2));
  do {
    const candidates = await fetchCandidates(args.limit, args.mode);
    console.log(`Selected ${candidates.length} candidate(s) for mode=${args.mode}`);
    if (!candidates.length) break;

    for (const row of candidates) {
      try {
        await processArticle(row, args.mode);
      } catch (error) {
        console.log("FAILED:", row.title, error.message);
      }
    }

    await wait(args.sleepMs);
  } while (args.loop);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect().catch(() => null);
    });
}

module.exports = {
  parseArgs,
  parseRawMetadata,
  needsRewrite,
  needsImage,
  fetchCandidates,
  processArticle,
  main,
};
