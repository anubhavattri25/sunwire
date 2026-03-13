const cron = require('node-cron');
const { ingestNewsSources } = require('../services/newsIngestor');
const { logEvent } = require('../utils/logger');

function startFetchNewsJob() {
  return cron.schedule('*/5 * * * *', async () => {
    try {
      await ingestNewsSources();
    } catch (error) {
      logEvent('scheduler.fetch.error', { message: error.message });
    }
  }, { scheduled: true, timezone: 'UTC' });
}

module.exports = {
  startFetchNewsJob,
};
