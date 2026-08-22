'use strict';

const { z } = require('zod');
const { login } = require('../services/auth.service');

const loginSchema = z.object({
  email:    z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

async function loginHandler(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0].message,
      });
    }

    const { email, password } = parsed.data;
    const { token, user } = await login(email, password);

    res.status(200).json({ success: true, token, user });
  } catch (err) {
    next(err);
  }
}

module.exports = { loginHandler };
