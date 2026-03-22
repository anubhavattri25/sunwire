const fs = require("fs");
const path = require("path");

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
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv = []) {
  const args = {
    categories: ["jobs", "food"],
    targetPerCategory: 5,
    rssLimit: 1,
    maxRuns: 1,
    sourceTimeoutMs: 45000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--categories") {
      const value = String(argv[index + 1] || "").trim();
      if (value) {
        args.categories = value
          .split(",")
          .map((entry) => String(entry || "").trim().toLowerCase())
          .filter(Boolean);
      }
    }
    if (token === "--target-per-category") {
      args.targetPerCategory = Math.max(1, Number.parseInt(argv[index + 1] || "5", 10) || 5);
    }
    if (token === "--rss-limit") {
      args.rssLimit = Math.max(1, Number.parseInt(argv[index + 1] || "8", 10) || 8);
    }
    if (token === "--max-runs") {
      args.maxRuns = Math.max(1, Number.parseInt(argv[index + 1] || "3", 10) || 3);
    }
    if (token === "--source-timeout-ms") {
      args.sourceTimeoutMs = Math.max(5000, Number.parseInt(argv[index + 1] || "45000", 10) || 45000);
    }
  }

  return args;
}

function normalizeCategories(categories = []) {
  return [...new Set(
    categories
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  )];
}

async function main() {
  loadEnvFile(".env.vercel.local");
  loadEnvFile(".env.vercel.production");

  const prisma = require("../backend/config/database");
  const {
    fetchSource,
    getSourceConfig,
    prioritizeArticles,
  } = require("../backend/services/newsIngestor");
  const { processPendingArticles } = require("../backend/services/articleProcessor");

  const args = parseArgs(process.argv.slice(2));
  const categories = normalizeCategories(args.categories);

  if (categories.length === 0) {
    throw new Error("No categories provided.");
  }

  process.env.SUNWIRE_SOURCE_CATEGORIES = categories.join(",");
  process.env.SUNWIRE_RSS_ITEM_LIMIT = String(args.rssLimit);
  process.env.SUNWIRE_SKIP_AI_CATEGORY_CLASSIFICATION = "1";
  process.env.SUNWIRE_SKIP_SEARCH_INDEXING = "1";

  async function fetchSourceWithTimeout(source) {
    return Promise.race([
      fetchSource(source),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`source_timeout:${source.name}`));
        }, args.sourceTimeoutMs);
      }),
    ]);
  }

  async function getCategorySnapshot() {
    const rows = await Promise.all(categories.map(async (category) => {
      const count = await prisma.article.count({ where: { category } });
      const latest = await prisma.article.findMany({
        where: { category },
        orderBy: [{ published_at: "desc" }, { created_at: "desc" }],
        take: 5,
        select: {
          title: true,
          source: true,
          published_at: true,
          category: true,
        },
      });

      return {
        category,
        count,
        latest,
      };
    }));

    return rows;
  }

  function hasTarget(snapshot = []) {
    return snapshot.every((entry) => entry.count >= args.targetPerCategory);
  }

  function summarize(snapshot = []) {
    return snapshot.map((entry) => ({
      category: entry.category,
      count: entry.count,
      latestTitles: entry.latest.map((item) => item.title),
    }));
  }

  let before = await getCategorySnapshot();
  console.log("CATEGORY SNAPSHOT BEFORE:", JSON.stringify(summarize(before), null, 2));

  for (let attempt = 1; attempt <= args.maxRuns; attempt += 1) {
    if (hasTarget(before)) {
      break;
    }

    const currentByCategory = new Map(before.map((entry) => [entry.category, entry.count]));
    const sourceTargets = new Map(
      categories.map((category) => {
        const missingCount = Math.max(0, args.targetPerCategory - (currentByCategory.get(category) || 0));
        return [category, missingCount > 0 ? missingCount + 1 : 0];
      })
    );
    const sourceConfig = getSourceConfig().filter((source) => categories.includes(String(source.category || "").trim().toLowerCase()));
    const selectedArticles = [];
    const selectedCounts = new Map(categories.map((category) => [category, 0]));

    console.log(`RUN ${attempt}/${args.maxRuns}: fetching minimum raw stories for ${categories.join(", ")} with RSS limit ${args.rssLimit}`);

    for (const source of sourceConfig) {
      const category = String(source.category || "").trim().toLowerCase();
      if (!categories.includes(category)) {
        continue;
      }

      if ((selectedCounts.get(category) || 0) >= (sourceTargets.get(category) || 0)) {
        continue;
      }

      try {
        const result = await fetchSourceWithTimeout(source);
        const articles = Array.isArray(result.articles) ? result.articles : [];
        const remaining = Math.max(0, (sourceTargets.get(category) || 0) - (selectedCounts.get(category) || 0));
        const accepted = articles.slice(0, remaining);

        selectedArticles.push(...accepted);
        selectedCounts.set(category, (selectedCounts.get(category) || 0) + accepted.length);

        console.log(`SOURCE ${source.name}: fetched=${articles.length} accepted=${accepted.length} category=${category}`);
      } catch (error) {
        console.log(`SOURCE ${source.name}: skipped=${error.message} category=${category}`);
      }
    }

    const result = selectedArticles.length > 0
      ? await processPendingArticles(prioritizeArticles(selectedArticles))
      : { processed: 0, inserted: 0, duplicatesSkipped: 0 };
    console.log("PIPELINE RESULT:", JSON.stringify(result || {}, null, 2));

    const after = await getCategorySnapshot();
    console.log("CATEGORY SNAPSHOT AFTER RUN:", JSON.stringify(summarize(after), null, 2));

    const progressed = after.some((entry, index) => entry.count > (before[index]?.count || 0));
    before = after;

    if (hasTarget(after)) {
      break;
    }

    if (!progressed) {
      console.log("No category count improvement detected; stopping early.");
      break;
    }
  }

  const finalSnapshot = await getCategorySnapshot();
  console.log("CATEGORY SNAPSHOT FINAL:", JSON.stringify(summarize(finalSnapshot), null, 2));

  const success = hasTarget(finalSnapshot);
  await prisma.$disconnect();
  process.exit(success ? 0 : 1);
}

main().catch(async (error) => {
  console.error("ingest-selected-categories failed:", error);
  try {
    const prisma = require("../backend/config/database");
    await prisma.$disconnect();
  } catch (_) {
    // ignore disconnect failures during cleanup
  }
  process.exit(1);
});
