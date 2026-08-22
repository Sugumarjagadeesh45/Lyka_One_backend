'use strict';

const { ROLES } = require('../utils/constants');

/**
 * PHONE MASKING
 * =============
 * PDF exact format:  +971501112222 → +971********22
 *
 * Rule:
 *   1. Keep the country code prefix (first char '+' + next 3 digits = "+971")
 *   2. Replace ALL middle digits with exactly 8 asterisks (fixed count)
 *   3. Append the last 2 digits of the FULL phone number
 *
 * Why fixed 8 asterisks?
 *   The PDF specifies the pattern "+971********99" (8 stars).
 *   Using a fixed count prevents information leakage about total phone length.
 *
 * Examples:
 *   +971501112222 → +971********22
 *   +971552223344 → +971********44
 *   +971524445566 → +971********66
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return phone;

  // Strip leading +
  const clean = phone.startsWith('+') ? phone.slice(1) : phone;

  // Country code: first 3 digits (e.g. 971 for UAE)
  const prefix  = '+' + clean.slice(0, 3);

  // Last 2 digits of the FULL number
  const lastTwo = clean.slice(-2);

  // Fixed 8 asterisks — matches the PDF pattern format
  return `${prefix}${'*'.repeat(8)}${lastTwo}`;
}

/**
 * serializeActivityForRecipient
 * ==============================
 * Builds the exact event payload that will be sent to a specific recipient.
 * Sensitive fields (phone) are redacted server-side BEFORE the emit.
 *
 * Never send the full payload and rely on the frontend to hide fields.
 * The actual wire frame must be clean per-recipient.
 *
 * @param {Object} activity  - Activity document
 * @param {Object} recipient - Current User document (from DB)
 * @param {Object} lead      - Current Lead document (from DB, with _ownerTeam)
 * @returns {Object} safe payload for this recipient
 */
function serializeActivityForRecipient(activity, recipient, lead) {
  const isMarketing = recipient.role === ROLES.MARKETING;

  return {
    activityId: String(activity._id),
    sequence:   activity.sequence,
    leadId:     String(lead._id),
    leadCode:   lead.leadCode,
    leadName:   lead.name,
    phone:      isMarketing ? maskPhone(lead.phone) : lead.phone,
    actorId:    String(activity.actorId),
    type:       activity.type,
    message:    activity.message,
    createdAt:  activity.createdAt,
  };
}

/**
 * serializeLeadForRecipient
 * =========================
 * Used in REST API responses and replay payloads.
 */
function serializeLeadForRecipient(lead, recipient) {
  const isMarketing = recipient && recipient.role === ROLES.MARKETING;
  return {
    ...lead,
    phone: isMarketing ? maskPhone(lead.phone) : lead.phone,
  };
}

module.exports = { maskPhone, serializeActivityForRecipient, serializeLeadForRecipient };
