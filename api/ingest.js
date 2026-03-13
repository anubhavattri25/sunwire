const newsHandler = require("./news");

module.exports = async (req, res) => {
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const pipeline = newsHandler.getPublicPipelineState();
  res.setHeader("Cache-Control", "no-store");
  res.status(202).json({
    ok: true,
    generatedAt: new Date().toISOString(),
    message: "On-demand ingestion is disabled on the request path. Use the backend cron job or worker.",
    pipeline,
  });
};
