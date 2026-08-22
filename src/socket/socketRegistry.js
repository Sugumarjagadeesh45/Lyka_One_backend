'use strict';

/**
 * SOCKET REGISTRY
 * ===============
 * In-memory map of userId → Set<socketId>.
 *
 * Purpose: tracks ALL active sockets per user to support:
 *   - Multi-device deactivation (disconnect EVERY socket for a user)
 *   - Targeted broadcasts to all sockets owned by a user
 *
 * PRODUCTION NOTE:
 * This implementation is single-instance (in-process memory).
 * In a multi-instance/multi-replica deployment, this map would need to be
 * externalized to a shared store (e.g., Redis) so that a deactivation event
 * handled by Instance A can disconnect sockets on Instance B.
 * This is acceptable for a single-instance assessment environment.
 */

/** @type {Map<string, Set<string>>} userId → Set of socketIds */
const registry = new Map();

function register(userId, socketId) {
  const uid = String(userId);
  if (!registry.has(uid)) {
    registry.set(uid, new Set());
  }
  registry.get(uid).add(socketId);
}

function unregister(userId, socketId) {
  const uid = String(userId);
  if (registry.has(uid)) {
    registry.get(uid).delete(socketId);
    if (registry.get(uid).size === 0) {
      registry.delete(uid);
    }
  }
}

/**
 * Get all active socketIds for a given user.
 * @param {string} userId
 * @returns {Array<string>}
 */
function getSocketsForUser(userId) {
  const uid = String(userId);
  if (!registry.has(uid)) return [];
  return Array.from(registry.get(uid));
}

/**
 * Get a snapshot of the entire registry for debug/state endpoint.
 */
function getRegistrySnapshot() {
  const result = {};
  for (const [uid, sids] of registry.entries()) {
    result[uid] = Array.from(sids);
  }
  return result;
}

module.exports = { register, unregister, getSocketsForUser, getRegistrySnapshot };
