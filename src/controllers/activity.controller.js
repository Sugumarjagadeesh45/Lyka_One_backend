'use strict';

const { z } = require('zod');
const { createActivity, getActivitiesForLead } = require('../services/activity.service');
const { getCurrentLeadWithOwnerTeam, getAllActiveUsers } = require('../services/user.service');
const { canSee, canEmit, isMarketingWriteBlocked } = require('../services/authorization.service');
const { serializeActivityForRecipient } = require('../socket/eventSerializer');
const { broadcastActivity } = require('../socket/socketHandlers');
const logger = require('../utils/logger');

let _io = null;
function setIo(io) { _io = io; }

const activitySchema = z.object({
  type:    z.string().min(1).max(50),
  message: z.string().min(1).max(1000),
});

/**
 * GET /api/leads/:id/activities
 * Returns activities for a lead, filtered by current user's entitlement.
 */
async function getActivities(req, res, next) {
  try {
    const lead = await getCurrentLeadWithOwnerTeam(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Lead not found' });
    }

    if (!canSee(req.user, lead)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Not authorized to view this lead' });
    }

    const activities = await getActivitiesForLead(String(lead._id));
    res.json({ success: true, count: activities.length, activities });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/leads/:id/activities
 * Create activity via REST. Uses the SAME permission rules as Socket.IO.
 */
async function createActivityHandler(req, res, next) {
  try {
    // Centralized marketing write-block
    if (isMarketingWriteBlocked(req.user)) {
      return res.status(403).json({ success: false, code: 'MARKETING_READ_ONLY', message: 'Marketing accounts cannot create activities' });
    }

    const parsed = activitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message });
    }

    const lead = await getCurrentLeadWithOwnerTeam(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Lead not found' });
    }

    if (!canEmit(req.user, lead)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Not authorized to create activity on this lead' });
    }

    const activity = await createActivity({
      leadId:  lead._id,
      actorId: req.user._id,
      type:    parsed.data.type,
      message: parsed.data.message,
    });

    logger.info(`[REST] Activity created: seq=${activity.sequence} lead=${lead.leadCode} actor=${req.user.userCode}`);

    // Broadcast via Socket.IO (same as socket path — same rules)
    if (_io) {
      await broadcastActivity(_io, activity, lead);
    }

    res.status(201).json({ success: true, activity });
  } catch (err) {
    next(err);
  }
}

module.exports = { getActivities, createActivityHandler, setIo };
