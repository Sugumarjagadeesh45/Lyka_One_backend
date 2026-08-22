'use strict';

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = process.env.NODE_ENV === 'test' ? 'warn' : 'debug';

function log(level, message) {
  if (LOG_LEVELS[level] <= LOG_LEVELS[currentLevel]) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level.toUpperCase()}] ${message}`;
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

const logger = {
  error: (msg) => log('error', msg),
  warn:  (msg) => log('warn',  msg),
  info:  (msg) => log('info',  msg),
  debug: (msg) => log('debug', msg),
};

module.exports = logger;
