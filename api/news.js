const { ingestNewsSources } = require("../backend/services/newsIngestor");
const prisma = require("../backend/config/database");

module.exports = async function handler(req, res) {
  try {
    const refresh = req.query.refresh === "1";

    // If refresh requested → run ingestion pipeline
    if (refresh) {
      const rawArticles = await ingestNewsSources();

      // store articles in database
      for (const article of rawArticles) {
        await prisma.article.create({
          data: article,
        }).catch(() => {});
      }
    }

    // fetch from database
    const stories = await prisma.article.findMany({
      orderBy: { published_at: "desc" },
      take: 100,
    });

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      totalStories: stories.length,
      totalPages: 1,
      page: 1,
      pageSize: stories.length,
      filter: "all",
      stories,
    });

  } catch (error) {
    res.status(500).json({
      error: "Pipeline failed",
      message: error.message,
    });
  }
};