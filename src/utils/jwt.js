'use strict';

const jwt = require('jsonwebtoken');
const env  = require('../config/env');

/**
 * Sign a minimal JWT — only sub (userId).
 * Role/team/permissions must NEVER be read from the JWT payload for authorization.
 * They must always be fetched from the current database state.
 */
function signToken(userId) {
  return jwt.sign(
    { sub: String(userId) },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

/**
 * Verify a JWT and return the decoded payload.
 * Throws on invalid/expired token.
 */
function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
