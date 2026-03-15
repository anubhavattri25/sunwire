const { pipelineState } = require("./newsIngestor");

function runPipeline(...args) {
  const journalisticPipeline = require("./journalisticPipeline");
  return journalisticPipeline.runPipeline(...args);
}

function getPublicPipelineState() {
  return {
    lastFetchAt: pipelineState.lastFetchAt,
    lastProcessAt: pipelineState.lastProcessAt,
    lastTrendingUpdateAt: pipelineState.lastTrendingUpdateAt,
    sourcesOnline: Array.isArray(pipelineState.sourcesOnline)
      ? [...pipelineState.sourcesOnline]
      : [],
    sourcesFailed: Array.isArray(pipelineState.sourcesFailed)
      ? [...pipelineState.sourcesFailed]
      : [],
    pendingRawArticles: Array.isArray(pipelineState.pendingRawArticles)
      ? [...pipelineState.pendingRawArticles]
      : [],
  };
}

module.exports = {
  runPipeline,
  getPublicPipelineState,
};
