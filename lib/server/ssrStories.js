async function getStoriesForSsr({ pageSize = 250, reason = "ssr" } = {}) {
  const { runIngestion } = require("../../api/news");

  const snapshot = await runIngestion({
    limit: pageSize,
    forceRefresh: false,
    reason,
  });

  return {
    generatedAt: snapshot.generatedAt || "",
    stories: snapshot.stories || [],
    sourceMode: "ingestion",
  };
}

module.exports = {
  getStoriesForSsr,
};