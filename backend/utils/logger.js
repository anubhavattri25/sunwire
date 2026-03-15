const fs = require('fs');
const os = require('os');
const path = require('path');

const defaultLogDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'sunwire')
  : path.join(__dirname, '..', 'logs');
const logPath = process.env.SUNWIRE_LOG_PATH || path.join(defaultLogDir, 'news_pipeline.log');

function ensureLogFile() {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '');
    }
    return true;
  } catch (_) {
    return false;
  }
}

function logEvent(event, payload = {}) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    payload,
  });

  if (!ensureLogFile()) {
    console.log(line);
    return;
  }

  try {
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch (_) {
    console.log(line);
  }
}

module.exports = {
  logEvent,
  logPath,
};
