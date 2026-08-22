'use strict';

const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * HTTP JWT Auth Middleware.
 * Verifies the JWT, loads current user from DB, and attaches to req.user.
 *
 * IMPORTANT: Role/permissions for authorization decisions must come from
 * req.user (DB state), NEVER from the JWT payload.
 */
async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, code: 'NO_TOKEN', message: 'Authorization header required' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      return res.status(401).json({ success: false, code: 'INVALID_TOKEN', message: 'Invalid or expired token' });
    }

    // Always load fresh from DB — never trust JWT claims for authorization
    const user = await User.findById(decoded.sub).lean();
    if (!user) {
      return res.status(401).json({ success: false, code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    if (!user.isActive) {
      logger.warn(`[AUTH-MW] Inactive user API request: ${user.userCode}`);
      return res.status(403).json({ success: false, code: 'DEACTIVATED', message: 'Account is deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    logger.error('[AUTH-MW] Unexpected error: ' + err.message);
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Internal server error' });
  }
}

/**
 * Admin-only middleware — must be used AFTER authMiddleware.
 */
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Admin access required' });
  }
  next();
}

/**
 * Marketing write-block middleware — centralized block for all mutating REST routes.
 * Must be used AFTER authMiddleware.
 */
function marketingWriteBlock(req, res, next) {
  if (req.user.role === 'marketing') {
    return res.status(403).json({
      success: false,
      code: 'MARKETING_READ_ONLY',
      message: 'Marketing accounts cannot perform write operations',
    });
  }
  next();
}

module.exports = { authMiddleware, adminOnly, marketingWriteBlock };
