const { buildNewsSitemapXml, fetchAllStories } = require("../lib/server/sitemap");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const payload = await fetchAllStories();
    const xml = buildNewsSitemapXml(payload.stories);

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");
    res.status(200).send(xml);
  } catch (_) {
    const xml = buildNewsSitemapXml([]);

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).send(xml);
  }
};
