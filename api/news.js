const prisma = require("../backend/config/database");
const { ingestNewsSources } = require("../backend/services/newsIngestor");
const { queryStories } = require("../lib/server/backendCompat");

module.exports = async function handler(req, res) {
  try {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "DATABASE_URL is not configured." });
      return;
    }

    const refresh = req.query.refresh === "1";

    // Run ingestion when refresh=1
    if (refresh) {
      const articles = await ingestNewsSources();

      if (Array.isArray(articles) && articles.length) {
        await Promise.all(
          articles.map((article) =>
            prisma.article
              .create({ data: article })
              .catch(() => null)
          )
        );

      }
    }

    const payload = await queryStories({
      page: req.query.page,
      pageSize: req.query.pageSize,
      filter: req.query.filter || "all",
    });

    res.setHeader("Cache-Control", "no-store");

    res.status(200).json(payload);

  } catch (err) {
    res.status(500).json({
      error: "Pipeline failed",
      message: err.message,
    });
  }
};
