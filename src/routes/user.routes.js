'use strict';

const { Router } = require('express');
const { authMiddleware, adminOnly } = require('../middlewares/auth.middleware');
const { getUsers, changeUserRole, deactivateUser } = require('../controllers/user.controller');

const router = Router();

// All user routes require auth
router.use(authMiddleware);

router.get('/', getUsers);
router.patch('/:id/role',       adminOnly, changeUserRole);
router.patch('/:id/deactivate', adminOnly, deactivateUser);

module.exports = router;
