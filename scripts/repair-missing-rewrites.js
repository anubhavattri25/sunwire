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
  const args = { limit: 2, loop: false, sleepMs: 0 };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--limit") {
      args.limit = Math.max(1, Number.parseInt(argv[index + 1] || "2", 10) || 2);
    }
    if (token === "--loop") {
      args.loop = true;
    }
    if (token === "--sleep-ms") {
      args.sleepMs = Math.max(0, Number.parseInt(argv[index + 1] || "0", 10) || 0);
    }
  }

  return args;
}

function wait(ms = 0) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chooseBestContent(article = {}) {
  const storedContent = cleanArticleTextForRewrite(article.content || article.summary || "");
  const sourceUrl = String(article.source_url || "").trim();

  if (!/^https?:\/\//i.test(sourceUrl)) {
    return storedContent;
  }

  try {
    const scraped = await scrapeArticle(sourceUrl);
    const scrapedContent = cleanArticleTextForRewrite(scraped.content || "");
    return scrapedContent.length > storedContent.length ? scrapedContent : storedContent;
  } catch (_) {
    return storedContent;
  }
}

async function main() {
  loadEnvFile(".env.vercel.local");
  loadEnvFile(".env.vercel.production");

  const args = parseArgs(process.argv.slice(2));
  do {
    const brokenRows = await prisma.article.findMany({
      where: {
        OR: [
          { raw_content: null },
          { raw_content: "" },
          { word_count: null },
        ],
      },
      orderBy: [{ created_at: "desc" }],
      take: args.limit,
      select: {
        title: true,
        summary: true,
        content: true,
        image_url: true,
        category: true,
        source: true,
        source_url: true,
        published_at: true,
        views: true,
        shares: true,
      },
    });

    console.log(`Broken rows selected: ${brokenRows.length}`);
    if (!brokenRows.length) break;

    for (const row of brokenRows) {
      const bestContent = await chooseBestContent(row);
      if (!bestContent) {
        console.log(`Skipping ${row.title}: no usable content`);
        continue;
      }

      const [rebuilt] = await buildArticlesFromTopics([{
        title: row.title,
        summary: row.summary,
        content: bestContent,
        image_url: row.image_url,
        category: row.category,
        source: row.source,
        source_url: row.source_url,
        published_at: row.published_at,
        views: row.views,
        shares: row.shares,
      }]);

      if (!rebuilt) {
        console.log(`Skipping ${row.title}: rebuild returned null`);
        continue;
      }

      await saveArticle(rebuilt);
      console.log(`Updated ${row.title}`);
    }

    await wait(args.sleepMs);
  } while (args.loop);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });
