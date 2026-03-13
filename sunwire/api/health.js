const newsHandler = require("./news");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const state = newsHandler.getPublicPipelineState();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      pipeline: state,
    });
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({
      ok: false,
      generatedAt: new Date().toISOString(),
      error: error.message || String(error),
    });
  }
};
