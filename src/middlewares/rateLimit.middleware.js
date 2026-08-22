'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for login endpoint — brute-force protection.
 * 10 attempts per 15 minutes per IP.
 */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API rate limiter.
 */
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginRateLimiter, apiRateLimiter };
