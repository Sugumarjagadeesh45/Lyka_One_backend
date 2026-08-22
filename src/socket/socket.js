'use strict';

const { Server } = require('socket.io');
const env  = require('../config/env');
const socketAuth = require('./socketAuth');
const { registerSocketHandlers, sendReplay } = require('./socketHandlers');
const { SOCKET_EVENTS } = require('../utils/constants');
const logger = require('../utils/logger');

/**
 * Initialize Socket.IO server.
 * Returns the io instance so REST controllers can call it for broadcasts.
 *
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: [env.CRM_ORIGIN, env.MARKETING_ORIGIN],
      credentials: true,
    },
  });

  // Handshake authentication middleware
  io.use(socketAuth);

  io.on('connection', (socket) => {
    // Register all event handlers
    registerSocketHandlers(socket, io);

    // Handle cursor-based replay on reconnect
    const lastCursor = socket.handshake.auth?.lastCursor;
    if (lastCursor !== undefined && lastCursor !== null) {
      sendReplay(socket, lastCursor);
    }

    socket.on('error', (err) => {
      logger.error(`[SOCKET] Error on ${socket.userCode}: ${err.message}`);
    });
  });

  logger.info('[SOCKET] Socket.IO initialized');
  return io;
}

module.exports = { initSocket };
