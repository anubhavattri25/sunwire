const newsHandler = require("../lib/server/ingest");

module.exports = async (req, res) => {
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const snapshot = await newsHandler.runIngestion({
      limit: 100,
      forceRefresh: req.query.refresh === "1",
      reason: "api_request",
    });

    res.setHeader("Cache-Control", "no-store");

    res.status(200).json({
      generatedAt: snapshot.generatedAt,
      totalStories: snapshot.stories.length,
      totalPages: 1,
      page: 1,
      pageSize: snapshot.stories.length,
      filter: "all",
      stories: snapshot.stories,
      sourceMode: "ingestion",
    });

  } catch (err) {
    res.status(500).json({
      error: "Pipeline failed",
      message: err.message,
    });
  }
};