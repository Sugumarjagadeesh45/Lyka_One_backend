'use strict';

const ROLES = Object.freeze({
  AGENT:      'agent',
  TEAM_LEAD:  'team_lead',
  MARKETING:  'marketing',
  ADMIN:      'admin',
});

const ORIGINS = Object.freeze({
  CRM:        'crm',
  MARKETING:  'marketing',
});

const SOCKET_EVENTS = Object.freeze({
  // Client → Server
  ACTIVITY_CREATE:   'activity:create',
  // Server → Client
  ACTIVITY_NEW:      'activity:new',
  LEAD_REASSIGNED:   'lead:reassigned',
  USER_ROLE_CHANGED: 'user:roleChanged',
  USER_DEACTIVATED:  'user:deactivated',
  ACTIVITY_REPLAY:   'activity:replay',
  ERROR:             'error',
});

const REPLAY_MAX_EVENTS = 200; // bounded replay limit

module.exports = { ROLES, ORIGINS, SOCKET_EVENTS, REPLAY_MAX_EVENTS };
