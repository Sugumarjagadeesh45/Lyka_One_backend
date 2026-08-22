'use strict';

const { z } = require('zod');
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { getAllLeads, getLeadById, reassignLead } = require('../services/lead.service');
const { canSee } = require('../services/authorization.service');
const { serializeLeadForRecipient } = require('../socket/eventSerializer');
const { SOCKET_EVENTS } = require('../utils/constants');
const socketRegistry = require('../socket/socketRegistry');
const { getCurrentLeadWithOwnerTeam, getAllActiveUsers } = require('../services/user.service');
const logger = require('../utils/logger');

let _io = null;
function setIo(io) { _io = io; }

/**
 * GET /api/leads
 * Returns leads filtered by what the current user can see.
 */
async function getLeads(req, res, next) {
  try {
    const allLeads = await getAllLeads();
    const user = req.user;

    const visible = [];
    for (const lead of allLeads) {
      // Annotate _ownerTeam
      const owner = await User.findById(lead.ownerId).lean();
      lead._ownerTeam = owner ? owner.team : null;

      if (canSee(user, lead)) {
        visible.push(serializeLeadForRecipient(lead, user));
      }
    }

    res.json({ success: true, count: visible.length, leads: visible });
  } catch (err) {
    next(err);
  }
}

const reassignSchema = z.object({
  ownerId: z.string().min(1, 'ownerId is required'),
});

/**
 * PATCH /api/leads/:id/reassign   [Admin only]
 * Reassign lead ownership. Takes effect IMMEDIATELY on next event delivery.
 */
async function reassignLeadHandler(req, res, next) {
  try {
    const parsed = reassignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message });
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Lead not found' });
    }

    const newOwner = await User.findById(parsed.data.ownerId);
    if (!newOwner) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'New owner user not found' });
    }

    const oldOwnerId = lead.ownerId;
    const updated = await reassignLead(String(lead._id), newOwner._id);

    logger.info(`[LEAD] Reassigned ${lead.leadCode}: ${oldOwnerId} → ${newOwner.userCode} by admin ${req.user.userCode}`);

    // Broadcast lead:reassigned event to all currently connected sockets
    // Each recipient evaluates current entitlement on NEXT activity event
    if (_io) {
      const freshLead = await getCurrentLeadWithOwnerTeam(String(lead._id));
      const allUsers  = await getAllActiveUsers();

      for (const recipient of allUsers) {
        // After reassignment, who can see this lead now?
        const canSeeLead = canSee(recipient, freshLead);
        const socketIds  = socketRegistry.getSocketsForUser(String(recipient._id));
        for (const sid of socketIds) {
          _io.to(sid).emit(SOCKET_EVENTS.LEAD_REASSIGNED, {
            leadId:      String(lead._id),
            leadCode:    lead.leadCode,
            newOwnerId:  String(newOwner._id),
            newOwnerCode: newOwner.userCode,
            canSeeNow:   canSeeLead,
          });
        }
      }
    }

    res.json({ success: true, lead: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { getLeads, reassignLeadHandler, setIo };
