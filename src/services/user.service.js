'use strict';

const User = require('../models/User');
const Lead = require('../models/Lead');
const logger = require('../utils/logger');

/**
 * Load a user from DB and annotate a lead with its owner's current team.
 * This is the function called on EVERY event — never rely on cached socket data.
 *
 * @param {string} userId - MongoDB ObjectId string
 * @returns {Object|null} current User document
 */
async function getCurrentUser(userId) {
  const user = await User.findById(userId).lean();
  return user;
}

/**
 * Load a lead from DB and annotate it with the owner's current team.
 * The _ownerTeam field is required by the authorization service.
 *
 * @param {string|ObjectId} leadId
 * @returns {Object|null} annotated lead
 */
async function getCurrentLeadWithOwnerTeam(leadId) {
  const lead = await Lead.findById(leadId).lean();
  if (!lead) return null;

  const owner = await User.findById(lead.ownerId).lean();
  lead._ownerTeam = owner ? owner.team : null;
  return lead;
}

/**
 * Load all currently active users for recipient computation.
 * Called on every event broadcast.
 *
 * @returns {Array} active User documents
 */
async function getAllActiveUsers() {
  return User.find({ isActive: true }).lean();
}

module.exports = { getCurrentUser, getCurrentLeadWithOwnerTeam, getAllActiveUsers };
