'use strict';

const { Router } = require('express');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { getActivities, createActivityHandler } = require('../controllers/activity.controller');

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/',  getActivities);
router.post('/', createActivityHandler);

module.exports = router;
