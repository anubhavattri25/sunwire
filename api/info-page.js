const fs = require("fs");
const path = require("path");

const PAGE_MAP = {
  "about-us": "about-us.html",
  "contact-us": "contact-us.html",
  "privacy-policy": "privacy-policy.html",
  "terms-and-conditions": "terms-and-conditions.html",
};

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  const page = String(req.query?.page || "").trim();
  const fileName = PAGE_MAP[page];
  if (!fileName) {
    res.status(404).send("Not found");
    return;
  }

  const filePath = path.join(__dirname, "..", fileName);

  try {
    const html = await fs.promises.readFile(filePath, "utf8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.status(200).send(html);
  } catch (error) {
    res.status(500).send(error.message || "Internal server error");
  }
};
