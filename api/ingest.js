module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(410).json({
    ok: false,
    generatedAt: new Date().toISOString(),
    mode: "manual-only",
    message: "Automated ingestion is disabled. Publish news from /admin/news.",
  });
};
