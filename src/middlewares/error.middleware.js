'use strict';

const logger = require('../utils/logger');

/**
 * Central Express error handler.
 * Must be registered as the last middleware in app.js.
 */
function errorMiddleware(err, req, res, next) {
  const status  = err.statusCode || 500;
  const message = err.message   || 'Internal server error';
  const code    = err.code      || 'SERVER_ERROR';

  if (status >= 500) {
    logger.error(`[ERROR] ${req.method} ${req.path} — ${message}`);
  } else {
    logger.warn(`[ERROR] ${req.method} ${req.path} — ${status} ${message}`);
  }

  res.status(status).json({ success: false, code, message });
}

module.exports = errorMiddleware;
