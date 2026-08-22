'use strict';

const { hashPassword } = require('../utils/password');
const { ROLES, ORIGINS } = require('../utils/constants');

/**
 * The 7 exact assessment users.
 * Passwords are hashed at seed time — plain passwords are only here for seeding.
 * In production, passwords would come from a secure onboarding flow.
 */
async function getUserSeedData() {
  return [
    {
      userCode: 'U-01',
      name: 'Ravi Kumar',
      email: 'ravi@lykaone.com',
      password: 'Ravi@1234',
      role: ROLES.AGENT,
      team: 'Sathya',
      isActive: true,
      origin: ORIGINS.CRM,
    },
    {
      userCode: 'U-02',
      name: 'Priya Menon',
      email: 'priya@lykaone.com',
      password: 'Priya@1234',
      role: ROLES.AGENT,
      team: 'Sathya',
      isActive: true,
      origin: ORIGINS.CRM,
    },
    {
      userCode: 'U-03',
      name: 'Bikash Thapa',
      email: 'bikash@lykaone.com',
      password: 'Bikash@1234',
      role: ROLES.AGENT,
      team: 'Rishal',
      isActive: true,
      origin: ORIGINS.CRM,
    },
    {
      userCode: 'U-04',
      name: 'Sathya K',
      email: 'sathya@lykaone.com',
      password: 'Sathya@1234',
      role: ROLES.TEAM_LEAD,
      team: 'Sathya',
      isActive: true,
      origin: ORIGINS.CRM,
    },
    {
      userCode: 'U-05',
      name: 'Rishal S',
      email: 'rishal@lykaone.com',
      password: 'Rishal@1234',
      role: ROLES.TEAM_LEAD,
      team: 'Rishal',
      isActive: true,
      origin: ORIGINS.CRM,
    },
    {
      userCode: 'U-06',
      name: 'Marketing',
      email: 'marketing@lykaone.com',
      password: 'Marketing@1234',
      role: ROLES.MARKETING,
      team: null,
      isActive: true,
      origin: ORIGINS.MARKETING,
    },
    {
      userCode: 'U-07',
      name: 'Vignesh',
      email: 'vignesh@lykaone.com',
      password: 'Vignesh@1234',
      role: ROLES.ADMIN,
      team: null,
      isActive: true,
      origin: ORIGINS.CRM,
    },
  ];
}

module.exports = { getUserSeedData };
