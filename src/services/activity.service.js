'use strict';

const Activity = require('../models/Activity');
const Counter  = require('../models/Counter');
const { REPLAY_MAX_EVENTS } = require('../utils/constants');

const SEQUENCE_KEY = 'activity_sequence';

/**
 * Create an activity with an atomically-assigned monotonic sequence number.
 *
 * @param {Object} data - { leadId, actorId, type, message }
 * @returns {Object} created activity document
 */
async function createActivity(data) {
  const sequence = await Counter.nextSequence(SEQUENCE_KEY);

  const activity = await Activity.create({
    leadId:   data.leadId,
    actorId:  data.actorId,
    type:     data.type,
    message:  data.message,
    sequence,
  });

  return activity.toObject();
}

/**
 * Fetch all activities for a lead, ordered by sequence.
 *
 * @param {string} leadId
 * @returns {Array}
 */
async function getActivitiesForLead(leadId) {
  return Activity.find({ leadId })
    .sort({ sequence: 1 })
    .lean();
}

/**
 * Cursor-based bounded replay.
 * Retrieves events with sequence > lastCursor, up to REPLAY_MAX_EVENTS.
 * Order is guaranteed by sequence ascending.
 *
 * @param {number} lastCursor - last sequence number received by client
 * @returns {Array} activities after the cursor, sorted by sequence
 */
async function getActivitiesAfterCursor(lastCursor) {
  const cursor = Number(lastCursor) || 0;
  return Activity.find({ sequence: { $gt: cursor } })
    .sort({ sequence: 1 })
    .limit(REPLAY_MAX_EVENTS)
    .lean();
}

module.exports = { createActivity, getActivitiesForLead, getActivitiesAfterCursor };
