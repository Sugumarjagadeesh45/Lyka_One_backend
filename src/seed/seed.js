'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDB } = require('../config/db');

const User     = require('../models/User');
const Lead     = require('../models/Lead');
const { hashPassword } = require('../utils/password');
const { getUserSeedData } = require('./users.seed');
const { leadSeedData }    = require('./leads.seed');
const logger = require('../utils/logger');

async function seedUsers() {
  const userData = await getUserSeedData();
  let created = 0;
  let skipped = 0;

  for (const u of userData) {
    const exists = await User.findOne({ userCode: u.userCode });
    if (exists) {
      skipped++;
      continue;
    }
    const passwordHash = await hashPassword(u.password);
    await User.create({
      userCode:     u.userCode,
      name:         u.name,
      email:        u.email,
      passwordHash,
      role:         u.role,
      team:         u.team,
      isActive:     u.isActive,
      origin:       u.origin,
    });
    created++;
  }

  logger.info(`[SEED] Users — created: ${created}, skipped (already exists): ${skipped}`);
}

async function seedLeads() {
  let created = 0;
  let skipped = 0;

  for (const l of leadSeedData) {
    const exists = await Lead.findOne({ leadCode: l.leadCode });
    if (exists) {
      skipped++;
      continue;
    }

    const owner = await User.findOne({ userCode: l.ownerCode });
    if (!owner) {
      logger.error(`[SEED] Lead ${l.leadCode}: owner ${l.ownerCode} not found — run user seed first`);
      continue;
    }

    await Lead.create({
      leadCode: l.leadCode,
      name:     l.name,
      phone:    l.phone,
      ownerId:  owner._id,
    });
    created++;
  }

  logger.info(`[SEED] Leads — created: ${created}, skipped (already exists): ${skipped}`);
}

async function run() {
  logger.info('[SEED] Starting idempotent seed...');
  await connectDB(env.MONGO_URI);

  await seedUsers();
  await seedLeads();

  logger.info('[SEED] Done.');
  process.exit(0);
}

run().catch(err => {
  logger.error('[SEED] Fatal error: ' + err.message);
  process.exit(1);
});
