const { ingestNewsSources, pipelineState } = require("./newsIngestor");
const { processPendingArticles } = require("./articleProcessor");

async function runPipeline() {
  try {
    console.log("Sunwire pipeline started");

    console.log("Fetching raw news...");
    const rawArticles = await ingestNewsSources();

    if (!rawArticles || rawArticles.length === 0) {
      console.log("No raw news fetched");
      pipelineState.lastProcessAt = new Date().toISOString();
      return;
    }

    console.log("Raw articles fetched:", rawArticles.length);

    console.log("Rewriting and saving articles...");
    const result = await processPendingArticles(rawArticles);

    console.log("Processed articles:", result.processed);
    console.log("Saved articles:", result.inserted);
    console.log("Duplicates skipped:", result.duplicatesSkipped);

    pipelineState.lastProcessAt = new Date().toISOString();
    pipelineState.pendingRawArticles = [];

    console.log("Sunwire pipeline finished");
  } catch (err) {
    console.error("Pipeline failed:", err);
    throw err;
  }
}

if (require.main === module) {
  runPipeline()
    .then(() => {
      console.log("Pipeline completed");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}

module.exports = { runPipeline };
