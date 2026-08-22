'use strict';

const { z } = require('zod');
const User = require('../models/User');
const { ROLES } = require('../utils/constants');
const socketRegistry = require('../socket/socketRegistry');
const logger = require('../utils/logger');

let _io = null;
function setIo(io) { _io = io; }

/**
 * GET /api/users
 * Returns all users without passwordHash.
 */
async function getUsers(req, res, next) {
  try {
    const users = await User.find().select('-passwordHash').lean();
    res.json({ success: true, count: users.length, users });
  } catch (err) {
    next(err);
  }
}

const roleSchema = z.object({
  role: z.enum(Object.values(ROLES)),
});

/**
 * PATCH /api/users/:id/role   [Admin only]
 * Change a user's role. Role change takes effect on the very next event delivery
 * because we never cache role on the socket.
 */
async function changeUserRole(req, res, next) {
  try {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'User not found' });
    }

    const oldRole = user.role;
    user.role = parsed.data.role;
    await user.save();

    logger.info(`[USER] Role change: ${user.userCode} ${oldRole} → ${user.role} by admin ${req.user.userCode}`);

    // Notify all sockets for that user
    if (_io) {
      const socketIds = socketRegistry.getSocketsForUser(String(user._id));
      for (const sid of socketIds) {
        _io.to(sid).emit('user:roleChanged', { userId: String(user._id), userCode: user.userCode, newRole: user.role });
      }
    }

    res.json({ success: true, user: user.toJSON() });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/users/:id/deactivate   [Admin only]
 * Deactivate a user and disconnect ALL their active sockets immediately.
 */
async function deactivateUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'User not found' });
    }

    user.isActive = false;
    await user.save();

    logger.info(`[USER] Deactivated: ${user.userCode} by admin ${req.user.userCode}`);

    // Disconnect ALL active sockets for this user (multi-device)
    if (_io) {
      const socketIds = socketRegistry.getSocketsForUser(String(user._id));
      logger.info(`[USER] Disconnecting ${socketIds.length} socket(s) for ${user.userCode}`);
      for (const sid of socketIds) {
        const sock = _io.sockets.sockets.get(sid);
        if (sock) {
          sock.emit('user:deactivated', { message: 'Your account has been deactivated' });
          sock.disconnect(true);
        }
      }
    }

    res.json({ success: true, message: `User ${user.userCode} deactivated`, user: user.toJSON() });
  } catch (err) {
    next(err);
  }
}

module.exports = { getUsers, changeUserRole, deactivateUser, setIo };
