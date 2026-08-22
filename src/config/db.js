'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function connectDB(uri) {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    logger.info(`[DB] MongoDB connected: ${mongoose.connection.host}`);
  } catch (err) {
    logger.error('[DB] Connection failed: ' + err.message);
    process.exit(1);
  }
}

mongoose.connection.on('disconnected', () => {
  logger.warn('[DB] MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('[DB] MongoDB reconnected');
});

module.exports = { connectDB };
