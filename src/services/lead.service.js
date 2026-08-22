'use strict';

const Lead = require('../models/Lead');
const User = require('../models/User');

/**
 * Get all leads with populated owner info.
 */
async function getAllLeads() {
  return Lead.find().populate('ownerId', 'userCode name role team').lean();
}

/**
 * Get a single lead by ID with owner team annotation.
 */
async function getLeadById(leadId) {
  const lead = await Lead.findById(leadId).lean();
  if (!lead) return null;
  const owner = await User.findById(lead.ownerId).lean();
  lead._ownerTeam = owner ? owner.team : null;
  return lead;
}

/**
 * Reassign lead to a new owner.
 * Returns the updated lead.
 */
async function reassignLead(leadId, newOwnerId) {
  const lead = await Lead.findByIdAndUpdate(
    leadId,
    { ownerId: newOwnerId },
    { new: true }
  ).lean();
  return lead;
}

module.exports = { getAllLeads, getLeadById, reassignLead };
