const newsHandler = require("./news");

module.exports = async (req, res) => {

  if (!["GET","POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let key = "";

  // 1️⃣ from query
  if (req.query && req.query.key) {
    key = req.query.key;
  }

  // 2️⃣ fallback from URL
  if (!key && req.url) {
    const url = new URL(req.url, "http://localhost");
    key = url.searchParams.get("key") || "";
  }

  // 3️⃣ fallback from body
  if (!key && req.body && req.body.key) {
    key = req.body.key;
  }

  key = key.trim();
  const envSecret = (process.env.INGEST_SECRET || "").trim();

  if (key !== envSecret) {
    return res.status(403).json({
      ok:false,
      message:"Unauthorized request"
    });
  }

  console.log("Sunwire ingestion authorized");

  try {

    await newsHandler.runPipeline();

    return res.status(200).json({
      ok:true,
      message:"Pipeline executed successfully"
    });

  } catch(err) {

    console.error(err);

    return res.status(500).json({
      ok:false,
      message:"Pipeline failed"
    });

  }

};