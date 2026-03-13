const cron = require('node-cron');
const { updateTrendingScores } = require('../services/trendingCalculator');
const { invalidateCache } = require('../utils/cache');
const { logEvent } = require('../utils/logger');

function startUpdateTrendingJob() {
  return cron.schedule('*/15 * * * *', async () => {
    try {
      await updateTrendingScores();
      await invalidateCache('sunwire:trending:*');
    } catch (error) {
      logEvent('scheduler.trending.error', { message: error.message });
    }
  }, { scheduled: true, timezone: 'UTC' });
}

module.exports = {
  startUpdateTrendingJob,
};
