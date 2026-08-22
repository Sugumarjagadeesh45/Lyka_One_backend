'use strict';

const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV:          z.enum(['development', 'production', 'test']).default('development'),
  PORT:              z.string().default('5000'),
  MONGO_URI:         z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET:        z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN:    z.string().default('1h'),
  CLIENT_URL:        z.string().url().default('http://localhost:3000'),
  CRM_ORIGIN:        z.string().url().default('http://localhost:3000'),
  MARKETING_ORIGIN:  z.string().url().default('http://localhost:3001'),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.errors.map(e => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    console.error('[ENV] Missing or invalid environment variables:\n' + errors);
    process.exit(1);
  }
  return result.data;
}

const env = validateEnv();

module.exports = env;
