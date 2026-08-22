'use strict';

const { z } = require('zod');
const User = require('../models/User');
const { SOCKET_EVENTS, ROLES } = require('../utils/constants');
const { getCurrentUser, getCurrentLeadWithOwnerTeam, getAllActiveUsers } = require('../services/user.service');
const { canSee, canEmit, isMarketingWriteBlocked } = require('../services/authorization.service');
const { createActivity, getActivitiesAfterCursor } = require('../services/activity.service');
const { serializeActivityForRecipient } = require('./eventSerializer');
const socketRegistry = require('./socketRegistry');
const logger = require('../utils/logger');

const activityCreateSchema = z.object({
  leadId:     z.string().min(1),
  type:       z.string().min(1).max(50),
  message:    z.string().min(1).max(1000),
  lastCursor: z.number().optional(),
});

/**
 * Registers all Socket.IO event handlers for a connected socket.
 *
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 */
function registerSocketHandlers(socket, io) {
  // Register in socket registry for multi-device support
  socketRegistry.register(socket.userId, socket.id);

  // ─────────────────────────────────────────────
  // Handler: activity:create
  // ─────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.ACTIVITY_CREATE, async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === 'function') ack(data);
      else socket.emit(SOCKET_EVENTS.ERROR, data);
    };

    try {
      // 1. Validate input
      const parsed = activityCreateSchema.safeParse(payload);
      if (!parsed.success) {
        return respond({ success: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message });
      }

      const { leadId, type, message } = parsed.data;

      // 2. Load CURRENT actor state from DB — NEVER trust socket session
      const actor = await getCurrentUser(socket.userId);
      if (!actor || !actor.isActive) {
        return respond({ success: false, code: 'UNAUTHORIZED', message: 'Account is inactive' });
      }

      // 3. Centralized Marketing write-block
      if (isMarketingWriteBlocked(actor)) {
        logger.warn(`[SOCKET] Marketing write-block: ${actor.userCode}`);
        return respond({ success: false, code: 'FORBIDDEN', message: 'Marketing accounts cannot create activities' });
      }

      // 4. Load CURRENT lead state with owner team annotation
      const lead = await getCurrentLeadWithOwnerTeam(leadId);
      if (!lead) {
        return respond({ success: false, code: 'NOT_FOUND', message: 'Lead not found' });
      }

      // 5. Check emit authorization against CURRENT state
      if (!canEmit(actor, lead)) {
        logger.warn(`[SOCKET] ${actor.userCode} denied emit on lead ${lead.leadCode}`);
        return respond({ success: false, code: 'FORBIDDEN', message: 'Not authorized to create activity on this lead' });
      }

      // 6. Create activity (atomic sequence)
      const activity = await createActivity({
        leadId:  lead._id,
        actorId: actor._id,
        type,
        message,
      });

      logger.info(`[SOCKET] Activity created: seq=${activity.sequence} lead=${lead.leadCode} actor=${actor.userCode}`);

      // Acknowledge success to the sender
      respond({ success: true, sequence: activity.sequence });

      // 7. Broadcast — per-recipient authorization and serialization
      await broadcastActivity(io, activity, lead);

    } catch (err) {
      logger.error('[SOCKET] activity:create error: ' + err.message);
      respond({ success: false, code: 'SERVER_ERROR', message: 'Internal server error' });
    }
  });

  // ─────────────────────────────────────────────
  // Handler: disconnect
  // ─────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    socketRegistry.unregister(socket.userId, socket.id);
    logger.info(`[SOCKET] Disconnected: ${socket.userCode} | socket: ${socket.id} | reason: ${reason}`);
  });
}

/**
 * Broadcast an activity event to all eligible recipients.
 * Authorization and serialization happen PER RECIPIENT with CURRENT state.
 *
 * This is the core of R1: every delivery evaluates current entitlement.
 */
async function broadcastActivity(io, activity, lead) {
  const allUsers = await getAllActiveUsers();

  for (const recipient of allUsers) {
    // Check current canSee for this recipient against current lead state
    if (!canSee(recipient, lead)) continue;

    // Find all sockets for this recipient (multi-device)
    const socketIds = socketRegistry.getSocketsForUser(String(recipient._id));
    if (socketIds.length === 0) continue;

    // Serialize specifically for this recipient (masks phone for marketing)
    const payload = serializeActivityForRecipient(activity, recipient, lead);

    for (const sid of socketIds) {
      io.to(sid).emit(SOCKET_EVENTS.ACTIVITY_NEW, payload);
      logger.debug(`[SOCKET] Emitted activity:new → ${recipient.userCode} (${recipient.role}) socket:${sid}`);
    }
  }
}

/**
 * Send cursor-based replay to a reconnecting socket.
 * Evaluates CURRENT entitlement at replay time — not at original event time.
 *
 * @param {import('socket.io').Socket} socket
 * @param {number} lastCursor
 */
async function sendReplay(socket, lastCursor) {
  try {
    const { getActivitiesAfterCursor } = require('../services/activity.service');
    const { getCurrentLeadWithOwnerTeam } = require('../services/user.service');

    // IMPORTANT: We authorize the RECONNECTING RECIPIENT, NOT the activity's original actor.
    // canSee(reconnectingUser, currentLead) — current entitlement at replay time.
    const reconnectingUser = await getCurrentUser(socket.userId);
    if (!reconnectingUser || !reconnectingUser.isActive) return;

    const activities = await getActivitiesAfterCursor(lastCursor);
    logger.info(`[REPLAY] ${reconnectingUser.userCode} reconnected. Evaluating ${activities.length} events after cursor ${lastCursor}`);

    const replayed = [];
    for (const activity of activities) {
      // Load CURRENT lead state (ownership may have changed since original event)
      const lead = await getCurrentLeadWithOwnerTeam(String(activity.leadId));
      if (!lead) continue;

      // Authorize the RECONNECTING RECIPIENT against current lead state
      // (NOT the original actor — replay entitlement is about who receives now)
      if (!canSee(reconnectingUser, lead)) continue;

      // Serialize per-recipient (masks phone if marketing)
      const payload = serializeActivityForRecipient(activity, reconnectingUser, lead);
      replayed.push(payload);
    }

    if (replayed.length > 0) {
      socket.emit(SOCKET_EVENTS.ACTIVITY_REPLAY, { events: replayed });
      logger.info(`[REPLAY] Sent ${replayed.length} events to ${reconnectingUser.userCode}`);
    } else {
      logger.info(`[REPLAY] No entitled events for ${reconnectingUser.userCode} after cursor ${lastCursor}`);
    }
  } catch (err) {
    logger.error('[REPLAY] Error during replay: ' + err.message);
  }
}

module.exports = { registerSocketHandlers, broadcastActivity, sendReplay };
