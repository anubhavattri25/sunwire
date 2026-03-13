const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '..', 'logs', 'news_pipeline.log');

function ensureLogFile() {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, '');
  }
}

function logEvent(event, payload = {}) {
  ensureLogFile();
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    payload,
  });
  fs.appendFileSync(logPath, `${line}\n`, 'utf8');
}

module.exports = {
  logEvent,
  logPath,
};
