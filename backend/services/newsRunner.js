const { runPipeline } = require("./journalisticPipeline");

(async () => {
  try {
    console.log("🚀 Starting Sunwire ingestion...");

    await runPipeline();

    console.log("✅ Pipeline finished successfully");
    process.exit(0);

  } catch (err) {
    console.error("❌ Pipeline failed:", err);
    process.exit(1);
  }
})();