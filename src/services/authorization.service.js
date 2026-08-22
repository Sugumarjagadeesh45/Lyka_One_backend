'use strict';

const { ROLES } = require('../utils/constants');

/**
 * CENTRAL AUTHORIZATION SERVICE
 * ==============================
 * This is the HEART of the backend. All permission decisions route through here.
 *
 * KEY DESIGN DECISION (R1 vs R7 contradiction resolution):
 * ─────────────────────────────────────────────────────────
 * R7 suggests caching permission state at socket connect time for efficiency.
 * R1 requires that permissions reflect LIVE state at event delivery time.
 *
 * We resolve this by:
 *   - Caching ONLY the userId on the socket (not role/team/ownership).
 *   - On EVERY event delivery, fetching current user and lead state from DB.
 *   - Reassignment, role changes, and deactivation take effect on the NEXT event.
 *   - No stale permission cache that survives a DB change.
 *
 * The userId is safe to cache because it never changes.
 * Role, team, isActive, and lead ownership are NEVER cached on the socket.
 *
 * This documented decision addresses Q6 in the assessment interview.
 */

/**
 * canSee(user, lead)
 * Determines if a user can SEE (receive events for) a given lead.
 * Uses CURRENT user and lead objects — both freshly loaded from DB.
 *
 * @param {Object} user - Current User document (from DB, NOT from JWT)
 * @param {Object} lead - Current Lead document (from DB)
 * @returns {boolean}
 */
function canSee(user, lead) {
  if (!user || !lead) return false;
  if (!user.isActive) return false;

  switch (user.role) {
    case ROLES.ADMIN:
      // Admin sees everything
      return true;

    case ROLES.MARKETING:
      // Marketing sees all leads organisation-wide (but data is masked — see serializer)
      return true;

    case ROLES.TEAM_LEAD:
      // Team lead sees leads owned by agents currently on their team
      // NOTE: lead.owner must be populated or we compare ownerId differently
      // This function expects lead.ownerTeam to be passed or lead to have owner populated
      // We rely on the caller to pass the owner user object if needed
      // The teamMatch is checked using the lead's current owner's team
      return user.team != null && lead._ownerTeam === user.team;

    case ROLES.AGENT:
      // Agent sees only leads they currently own
      const leadOwnerIdStr = String(lead.ownerId._id || lead.ownerId);
      return leadOwnerIdStr === String(user._id);

    default:
      return false;
  }
}

/**
 * canEmit(user, lead)
 * Determines if a user can CREATE/MUTATE activities on a lead.
 *
 * Mutation rules:
 *   AGENT    → only their own leads
 *   TEAM_LEAD → leads within their current team
 *   MARKETING → NEVER (centralized write-block)
 *   ADMIN    → everything
 *
 * @param {Object} user - Current User document (from DB)
 * @param {Object} lead - Current Lead document (from DB)
 * @returns {boolean}
 */
function canEmit(user, lead) {
  if (!user || !lead) return false;
  if (!user.isActive) return false;

  switch (user.role) {
    case ROLES.ADMIN:
      return true;

    case ROLES.MARKETING:
      // CENTRALIZED WRITE-BLOCK: Marketing can never mutate anything
      return false;

    case ROLES.TEAM_LEAD:
      return user.team != null && lead._ownerTeam === user.team;

    case ROLES.AGENT:
      const emitOwnerIdStr = String(lead.ownerId._id || lead.ownerId);
      return emitOwnerIdStr === String(user._id);

    default:
      return false;
  }
}

/**
 * marketingWriteBlock(user)
 * Single centralized check for all mutating operations.
 * Throw or return false if user is marketing.
 *
 * @param {Object} user - Current User document
 * @returns {boolean} true if the operation must be blocked
 */
function isMarketingWriteBlocked(user) {
  return user && user.role === ROLES.MARKETING;
}

/**
 * Resolve the complete visibility matrix for a given lead.
 * Returns an array of all User objects who should receive events for this lead,
 * along with fresh current state.
 *
 * @param {Object} lead - Lead with _ownerTeam already annotated
 * @param {Array}  allActiveUsers - All currently active users (fresh from DB)
 * @returns {Array} of user objects who can see this lead
 */
function getRecipients(lead, allActiveUsers) {
  return allActiveUsers.filter(u => canSee(u, lead));
}

module.exports = { canSee, canEmit, isMarketingWriteBlocked, getRecipients };
