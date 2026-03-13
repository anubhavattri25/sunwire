const cron = require('node-cron');
const { processPendingArticles } = require('../services/articleProcessor');
const { logEvent } = require('../utils/logger');

function startProcessArticlesJob() {
  return cron.schedule('*/10 * * * *', async () => {
    try {
      await processPendingArticles();
    } catch (error) {
      logEvent('scheduler.process.error', { message: error.message });
    }
  }, { scheduled: true, timezone: 'UTC' });
}

module.exports = {
  startProcessArticlesJob,
};
