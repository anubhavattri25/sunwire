const prisma = require("../backend/config/database");
const { ingestNewsSources } = require("../backend/services/newsIngestor");

module.exports = async function handler(req, res) {
  try {
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

    const stories = await prisma.article.findMany({
      orderBy: { published_at: "desc" },
      take: 100,
    });

    res.setHeader("Cache-Control", "no-store");

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      totalStories: stories.length,
      totalPages: 1,
      page: 1,
      pageSize: stories.length,
      filter: "all",
      stories,
    });

  } catch (err) {
    res.status(500).json({
      error: "Pipeline failed",
      message: err.message,
    });
  }
};