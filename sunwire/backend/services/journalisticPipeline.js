const { fetchNews } = require("./newsIngestor");
const { saveArticle } = require("./articleProcessor");
const { buildArticlesFromTopics } = require("./journalisticPipeline"); // topic builder
const { logEvent } = require("../utils/logger");

async function runPipeline() {
  try {
    console.log("🚀 Sunwire pipeline started");

    console.log("📰 Fetching raw news...");
    const rawArticles = await fetchNews();

    if (!rawArticles || rawArticles.length === 0) {
      console.log("⚠️ No news fetched.");
      return;
    }

    console.log("Articles fetched:", rawArticles.length);

    console.log("🧠 Building topic clusters...");
    const articles = await buildArticlesFromTopics(rawArticles);

    if (!articles || articles.length === 0) {
      console.log("⚠️ No publishable articles created.");
      return;
    }

    console.log("Articles ready for publishing:", articles.length);

    for (const article of articles) {
      console.log("💾 Saving article:", article.title);

      try {
        await saveArticle(article);
      } catch (err) {
        console.error("Failed to save article:", article.title, err.message);

        logEvent("workflow.article.save_failed", {
          title: article.title,
          message: err.message,
        });
      }
    }

    console.log("✅ Pipeline finished successfully");
  } catch (err) {
    console.error("❌ Pipeline failed:", err);

    logEvent("workflow.pipeline.failed", {
      message: err.message,
    });

    throw err;
  }
}

runPipeline()
  .then(() => {
    console.log("🏁 Pipeline complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Fatal pipeline error:", err);
    process.exit(1);
  });