const { ingestNewsSources } = require("./newsIngestor");
const { saveArticle } = require("./articleProcessor");
const { buildArticlesFromTopics } = require("./articleBuilder");

async function runPipeline() {
  try {
    console.log("🚀 Sunwire pipeline started");

    console.log("📰 Fetching raw news...");
    const rawArticles = await ingestNewsSources();

    if (!rawArticles || rawArticles.length === 0) {
      console.log("⚠️ No raw news fetched");
      return;
    }

    console.log("Raw articles fetched:", rawArticles.length);

    console.log("🧠 Building journalistic articles...");
    const articles = await buildArticlesFromTopics(rawArticles);

    console.log("Generated articles:", articles.length);

    for (const article of articles) {
      console.log("💾 Saving:", article.title);
      await saveArticle(article);
    }

    console.log("✅ Sunwire pipeline finished");

  } catch (err) {
    console.error("❌ Pipeline failed:", err);
    throw err;
  }
}

runPipeline()
  .then(() => {
    console.log("🏁 Pipeline completed");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Fatal error:", err);
    process.exit(1);
  });

module.exports = { runPipeline };