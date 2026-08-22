'use strict';

const { Router } = require('express');
const { loginHandler } = require('../controllers/auth.controller');
const { loginRateLimiter } = require('../middlewares/rateLimit.middleware');

const router = Router();

router.post('/login', loginRateLimiter, loginHandler);

module.exports = router;
