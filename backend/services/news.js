const { ADMIN_EMAIL } = require("../utils/adminAuth");

function getPublicPipelineState() {
  return {
    mode: "manual-only",
    adminEmail: ADMIN_EMAIL,
    automationEnabled: false,
    ingestionEndpointEnabled: false,
    lastFetchAt: null,
    lastProcessAt: null,
    lastTrendingUpdateAt: null,
    sourcesOnline: [],
    sourcesFailed: [],
    pendingRawArticles: [],
  };
}

async function getNewsroomStats({ prisma, databaseReachable = false } = {}) {
  if (!prisma || !databaseReachable) {
    return {
      articlesTotal: 0,
      manualArticlesTotal: 0,
      featuredArticlesLive: 0,
      latestArticleAt: null,
      lastManualPublishAt: null,
    };
  }

  const now = new Date();
  const [articlesTotal, manualArticlesTotal, featuredArticlesLive, latestArticle, lastManualArticle] = await Promise.all([
    prisma.article.count(),
    prisma.article.count({ where: { manual_upload: true } }),
    prisma.article.count({
      where: {
        is_featured: true,
        featured_until: {
          gt: now,
        },
      },
    }),
    prisma.article.findFirst({
      select: {
        published_at: true,
        created_at: true,
      },
      orderBy: [
        { published_at: "desc" },
        { created_at: "desc" },
      ],
    }),
    prisma.article.findFirst({
      where: { manual_upload: true },
      select: {
        published_at: true,
        created_at: true,
      },
      orderBy: [
        { published_at: "desc" },
        { created_at: "desc" },
      ],
    }),
  ]);

  return {
    articlesTotal,
    manualArticlesTotal,
    featuredArticlesLive,
    latestArticleAt: latestArticle?.published_at?.toISOString?.() || latestArticle?.created_at?.toISOString?.() || null,
    lastManualPublishAt: lastManualArticle?.published_at?.toISOString?.() || lastManualArticle?.created_at?.toISOString?.() || null,
  };
}

module.exports = {
  getNewsroomStats,
  getPublicPipelineState,
};
