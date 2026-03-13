const { getBackendCompatiblePayload } = require("./backendCompat");

async function getStoriesForSsr({ pageSize = 250, reason = "ssr" } = {}) {
  const backendPayload = await getBackendCompatiblePayload({
    page: 1,
    pageSize,
    filter: "all",
  }).catch(() => null);

  if (Array.isArray(backendPayload?.stories) && backendPayload.stories.length) {
    return {
      generatedAt: backendPayload.generatedAt || "",
      stories: backendPayload.stories,
      sourceMode: backendPayload.sourceMode || "backend",
    };
  }

  return {
    generatedAt: "",
    stories: [],
    sourceMode: "database_only",
  };
}

module.exports = {
  getStoriesForSsr,
};
