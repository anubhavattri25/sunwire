const newsHandler = require("./news");

module.exports = async (req, res) => {

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = String(req.query.key || "").trim();
  const envSecret = String(process.env.INGEST_SECRET || "").trim();

  console.log("Incoming key:", key);
  console.log("Server secret:", envSecret);

  if (!key || key !== envSecret) {
    return res.status(403).json({
      ok: false,
      message: "Unauthorized request"
    });
  }

  console.log("✅ GitHub triggered Sunwire ingestion");

  try {
    await newsHandler.runPipeline();

    return res.status(200).json({
      ok: true,
      message: "Sunwire pipeline executed successfully"
    });

  } catch (error) {
    console.error("Pipeline error:", error);

    return res.status(500).json({
      ok: false,
      error: "Pipeline execution failed"
    });
  }
};