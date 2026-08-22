'use strict';

const User = require('../models/User');
const { comparePassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');
const logger = require('../utils/logger');

/**
 * Attempt login with email and password.
 * Returns { token, user } on success.
 * Throws an error with a safe message on failure.
 */
async function login(email, password) {
  // 1. Find user by email
  const user = await User.findOne({ email: email.toLowerCase() });

  // 2. Use the same error message for missing user and wrong password
  //    to prevent user enumeration attacks
  if (!user) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  // 3. Reject inactive users before doing bcrypt (avoids wasting CPU)
  if (!user.isActive) {
    logger.warn(`[AUTH] Login attempt by deactivated user: ${email}`);
    throw Object.assign(new Error('Account is deactivated'), { statusCode: 403 });
  }

  // 4. Compare password
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    logger.warn(`[AUTH] Failed login attempt for: ${email}`);
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  // 5. Sign minimal JWT — only userId (sub)
  const token = signToken(user._id);

  logger.info(`[AUTH] Login success: ${user.userCode} (${user.role})`);

  // 6. Return safe user data (passwordHash excluded by toJSON transform)
  return { token, user: user.toJSON() };
}

module.exports = { login };
