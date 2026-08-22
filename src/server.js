'use strict';

require('dotenv').config();
const http = require('http');

const env  = require('./config/env');
const app  = require('./app');
const { connectDB } = require('./config/db');
const { initSocket } = require('./socket/socket');
const logger = require('./utils/logger');

// Wire up io reference to controllers that need to emit events
const userController     = require('./controllers/user.controller');
const leadController     = require('./controllers/lead.controller');
const activityController = require('./controllers/activity.controller');

async function startServer() {
  // Connect to MongoDB first — fail fast on error
  await connectDB(env.MONGO_URI);

  const httpServer = http.createServer(app);

  // Initialize Socket.IO
  const io = initSocket(httpServer);

  // Share io instance with controllers that need to broadcast
  userController.setIo(io);
  leadController.setIo(io);
  activityController.setIo(io);

  const PORT = parseInt(env.PORT, 10);
  httpServer.listen(PORT, () => {
    logger.info(`[SERVER] Lyka One backend running on port ${PORT} [${env.NODE_ENV}]`);
    logger.info(`[SERVER] Health: http://localhost:${PORT}/health`);
    logger.info(`[SERVER] CRM Origin:       ${env.CRM_ORIGIN}`);
    logger.info(`[SERVER] Marketing Origin: ${env.MARKETING_ORIGIN}`);
  });
}

startServer().catch(err => {
  console.error('[SERVER] Fatal startup error:', err.message);
  process.exit(1);
});
