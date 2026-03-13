const { fetchNews } = require("./newsIngestor");
const { saveArticle } = require("./articleProcessor");

async function runPipeline() {
  try {
    console.log("🚀 Sunwire pipeline started");

    console.log("📰 Fetching news...");
    const articles = await fetchNews();

    if (!articles || articles.length === 0) {
      console.log("⚠️ No news fetched.");
      return;
    }

    console.log("Articles fetched:", articles.length);

    for (const article of articles) {
      console.log("💾 Saving article:", article.title);
      await saveArticle(article);
    }

    console.log("✅ Pipeline finished successfully");

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