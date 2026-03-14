const newsHandler = require("../backend/services/news");

module.exports = async (req, res) => {
  try {
    if (!["GET", "POST"].includes(req.method)) {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const key = req.query.key;

    if (key !== process.env.INGEST_SECRET) {
      return res.status(403).json({
        ok: false,
        message: "Unauthorized request"
      });
    }

    console.log("GitHub triggered Sunwire ingestion");

    await newsHandler.runPipeline();

    res.setHeader("Cache-Control", "no-store");

    return res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      message: "Sunwire ingestion pipeline executed successfully",
      pipeline: newsHandler.getPublicPipelineState()
    });

  } catch (err) {
    console.error("Ingestion error:", err);

    return res.status(500).json({
      ok: false,
      error: "Pipeline execution failed",
      details: err.message
    });
  }
};