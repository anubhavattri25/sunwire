const fs = require("fs");
const path = require("path");
const prisma = require("../backend/config/database");
const { scrapeArticle } = require("../backend/utils/articleScraper");
const { generateSummary } = require("../backend/services/summaryGenerator");
const { countWords, summaryFromText } = require("../lib/article/shared");
const {
  cleanArticleTextForRewrite,
  getLocalAiConfig,
  isLocalAiRewriteEnabled,
  rewriteArticleLocally,
  validateRewrittenArticle,
} = require("../backend/services/localAiRewrite");

const JUNK_PATTERNS = [
  /will be added to your daily email digest/i,
  /posts from this author/i,
  /posts from this topic/i,
  /\bshare\b.*\bgift\b/i,
  /^close\b/i,
  /<figure[\s>]/i,
  /<img[\s>]/i,
  /<figcaption[\s>]/i,
];

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
  const args = { slug: "", all: false, limit: 50, dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--all") args.all = true;
    if (token === "--dry-run") args.dryRun = true;
    if (token === "--slug") args.slug = String(argv[index + 1] || "").trim();
    if (token === "--limit") args.limit = Math.max(1, Number.parseInt(argv[index + 1] || "50", 10) || 50);
  }

  return args;
}

function isPolluted(value = "") {
  const text = String(value || "");
  return JUNK_PATTERNS.some((pattern) => pattern.test(text));
}

function parseRawContent(value = "") {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function main() {
  loadEnvFile(".env.vercel.local");
  loadEnvFile(".env.vercel.production");

  const args = parseArgs(process.argv.slice(2));
  const aiConfig = getLocalAiConfig();
  const baseWhere = {
    OR: [
      { source: { equals: "The Verge", mode: "insensitive" } },
      { source_url: { contains: "theverge.com" } },
    ],
  };
  const where = args.slug
    ? {
      AND: [
        baseWhere,
        {
          OR: [
            { slug: { contains: args.slug } },
            { title: { contains: args.slug.replace(/-/g, " ") } },
            { source_url: { contains: args.slug } },
          ],
        },
      ],
    }
    : baseWhere;

  const articles = await prisma.article.findMany({
    where,
    orderBy: [{ published_at: "desc" }],
    take: args.limit,
    select: {
      id: true,
      title: true,
      slug: true,
      summary: true,
      content: true,
      raw_content: true,
      source_url: true,
    },
  });

  const candidates = args.all
    ? articles
    : articles.filter((article) => isPolluted(article.summary) || isPolluted(article.content));

  console.log(`Found ${articles.length} Verge articles, ${candidates.length} candidate(s) to repair.`);

  for (const article of candidates) {
    try {
      const scraped = await scrapeArticle(article.source_url);
      const sourceBody = cleanArticleTextForRewrite(scraped.content);
      if (!sourceBody) {
        console.log(`Skipping ${article.id}: no clean body extracted.`);
        continue;
      }

      let nextBody = sourceBody;
      let rewriteStatus = "rewrite_disabled_provider";
      let rewriteError = `provider:${aiConfig.provider}`;

      if (isLocalAiRewriteEnabled()) {
        const rewritten = await rewriteArticleLocally(sourceBody, {
          topic: article.title,
          source: "The Verge",
        });

        if (rewritten) {
          const validated = validateRewrittenArticle(rewritten);
          if (validated.ok) {
            nextBody = validated.content;
            rewriteStatus = "ai_rewritten";
            rewriteError = "";
            console.log(`Rewrite succeeded for ${article.id} using ${aiConfig.model}.`);
          } else {
            rewriteStatus = "rewrite_fallback_source";
            rewriteError = validated.reasons.join(",");
            console.log(`Rewrite fallback for ${article.id}: ${rewriteError}.`);
          }
        } else {
          rewriteStatus = "rewrite_failed";
          rewriteError = "ollama_request_failed";
          console.log(`Rewrite failed for ${article.id}: ${rewriteError}. Falling back to cleaned source.`);
        }
      } else {
        console.log(`Rewrite skipped for ${article.id}: provider ${aiConfig.provider} is not enabled.`);
      }

      const generatedSummary = await generateSummary(nextBody, {
        title: article.title || "",
      }).catch(() => "");
      const nextSummary = generatedSummary || summaryFromText(nextBody, article.title || "");
      const metadata = parseRawContent(article.raw_content);
      const nextWordCount = countWords(nextBody);
      const nextMetadata = {
        ...metadata,
        sourceBody,
        body: nextBody,
        wordCount: nextWordCount,
        estimatedReadingTime: Math.max(2, Math.ceil(nextWordCount / 200)),
        rewriteStatus,
        rewriteError,
        rewriteProvider: aiConfig.provider,
        ai_rewritten: rewriteStatus === "ai_rewritten",
        rewriteModel: rewriteStatus === "ai_rewritten" ? aiConfig.model : "",
      };

      console.log(`Repairing ${article.id} ${article.source_url}`);

      if (!args.dryRun) {
        await prisma.article.update({
          where: { id: article.id },
          data: {
            summary: nextSummary,
            content: nextBody,
            word_count: nextWordCount,
            raw_content: JSON.stringify(nextMetadata),
          },
        });
      }
    } catch (error) {
      console.log(`Failed ${article.id}: ${error.message}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });
