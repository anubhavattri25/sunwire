const newsHandler = require("./news");

module.exports = async (req, res) => {

  if (!["GET","POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // safer parsing for Vercel
  const url = new URL(req.url, "http://localhost");
  const key = (url.searchParams.get("key") || "").trim();

  const envSecret = (process.env.INGEST_SECRET || "").trim();

  console.log("Incoming key:", key);
  console.log("Server secret length:", envSecret.length);

  if (!key || key !== envSecret) {
    return res.status(403).json({
      ok:false,
      message:"Unauthorized request"
    });
  }

  console.log("GitHub triggered Sunwire ingestion");

  try {
    await newsHandler.runPipeline();

    return res.status(200).json({
      ok:true,
      message:"Pipeline executed successfully"
    });

  } catch(err) {

    console.error("Pipeline error:", err);

    return res.status(500).json({
      ok:false,
      message:"Pipeline failed"
    });

  }

};