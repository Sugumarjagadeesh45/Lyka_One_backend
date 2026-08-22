'use strict';

const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');
const env  = require('../config/env');
const { ORIGINS } = require('../utils/constants');
const logger = require('../utils/logger');

/**
 * SOCKET HANDSHAKE AUTHENTICATION
 * ================================
 * Called once per connection attempt via Socket.IO middleware.
 *
 * Steps:
 * 1. Extract JWT from socket.handshake.auth.token
 * 2. Verify JWT signature and expiry
 * 3. Load CURRENT user from DB (not from JWT payload)
 * 4. Verify user exists and isActive
 * 5. Validate origin against allowed origin for this user's type
 * 6. Attach userId to socket for future event use
 *
 * IMPORTANT: We only cache `socket.userId` here.
 * Role, team, isActive, permissions are NEVER cached on the socket.
 * They are fetched fresh from DB on every event delivery.
 */
async function socketAuth(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      logger.warn('[SOCKET-AUTH] No token provided');
      return next(new Error('Authentication required: no token'));
    }

    // Step 1 & 2: Verify JWT
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      logger.warn('[SOCKET-AUTH] Invalid or expired token');
      return next(new Error('Authentication failed: invalid token'));
    }

    const userId = decoded.sub;

    // Step 3: Load CURRENT user from DB
    const user = await User.findById(userId).lean();
    if (!user) {
      logger.warn(`[SOCKET-AUTH] User not found: ${userId}`);
      return next(new Error('Authentication failed: user not found'));
    }

    // Step 4: Check isActive
    if (!user.isActive) {
      logger.warn(`[SOCKET-AUTH] Deactivated user attempted connection: ${user.userCode}`);
      return next(new Error('Authentication failed: account deactivated'));
    }

    // Step 5: Origin validation
    const requestOrigin = socket.handshake.headers.origin || '';
    const allowed = getAllowedOrigin(user);

    if (allowed && requestOrigin && !isOriginAllowed(requestOrigin, allowed)) {
      logger.warn(
        `[SOCKET-AUTH] Origin rejected for ${user.userCode}: got "${requestOrigin}", expected "${allowed}"`
      );
      return next(new Error(`Authentication failed: origin not permitted for this account type`));
    }

    // Step 6: Attach ONLY userId — never role/team/permissions
    socket.userId = String(user._id);
    socket.userCode = user.userCode; // for logging readability only

    logger.info(`[SOCKET] Connected: ${user.userCode} (${user.role}) | socket: ${socket.id}`);
    next();
  } catch (err) {
    logger.error('[SOCKET-AUTH] Unexpected error: ' + err.message);
    return next(new Error('Authentication failed: internal error'));
  }
}

/**
 * Returns the expected origin URL for a given user based on their origin field.
 */
function getAllowedOrigin(user) {
  if (user.origin === ORIGINS.MARKETING) {
    return env.MARKETING_ORIGIN;
  }
  return env.CRM_ORIGIN;
}

/**
 * Loose origin matching — compare without trailing slashes.
 */
function isOriginAllowed(requestOrigin, allowedOrigin) {
  const req = requestOrigin.replace(/\/$/, '').toLowerCase();
  const exp = allowedOrigin.replace(/\/$/, '').toLowerCase();
  return req === exp;
}

module.exports = socketAuth;
