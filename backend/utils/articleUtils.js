function normalizeTitle(title = "") {
  return title.trim().replace(/\s+/g, " ");
}

function classifyCategory(article = {}) {
  const text = (article.title || "").toLowerCase();

  if (text.includes("ai") || text.includes("openai")) return "AI";
  if (text.includes("tech") || text.includes("software")) return "Tech";
  if (text.includes("cricket") || text.includes("football")) return "Sports";
  if (text.includes("movie") || text.includes("film")) return "Entertainment";

  return "General";
}

module.exports = {
  normalizeTitle,
  classifyCategory,
};