const newsHandler = require("./news");

module.exports = async (req, res) => {

  if (!["GET","POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // safest way for Vercel
  const key =
    (req.query && req.query.key) ||
    (req.body && req.body.key) ||
    "";

  const envSecret = process.env.INGEST_SECRET || "";

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

  } catch(err){

    console.error(err);

    return res.status(500).json({
      ok:false,
      message:"Pipeline failed"
    });

  }

};