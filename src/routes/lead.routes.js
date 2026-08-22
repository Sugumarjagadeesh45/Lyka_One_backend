'use strict';

const { Router } = require('express');
const { authMiddleware, adminOnly } = require('../middlewares/auth.middleware');
const { getLeads, reassignLeadHandler } = require('../controllers/lead.controller');

const router = Router();

router.use(authMiddleware);

router.get('/',              getLeads);
router.patch('/:id/reassign', adminOnly, reassignLeadHandler);

module.exports = router;
