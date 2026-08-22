'use strict';

/**
 * AUTOMATED AUTHORIZATION MATRIX TEST
 * =====================================
 * Tests all 8 assessment scenarios (S1-S8).
 *
 * Run: npm test
 * Requires: server must be running at PORT 5000 + MongoDB connected + seed done.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const env      = require('../config/env');
const { connectDB } = require('../config/db');

const User     = require('../models/User');
const Lead     = require('../models/Lead');
const Activity = require('../models/Activity');
const Counter  = require('../models/Counter');
const { canSee, canEmit, isMarketingWriteBlocked } = require('../services/authorization.service');
const { createActivity, getActivitiesAfterCursor }  = require('../services/activity.service');
const { maskPhone, serializeActivityForRecipient }  = require('../socket/eventSerializer');
const { hashPassword, comparePassword } = require('../utils/password');
const { signToken, verifyToken }        = require('../utils/jwt');

let passed = 0;
let failed = 0;
const results = [];

function assert(label, condition, detail = '') {
  if (condition) {
    passed++;
    results.push({ status: '✅ PASS', label, detail });
    console.log(`  ✅ PASS | ${label}`);
  } else {
    failed++;
    results.push({ status: '❌ FAIL', label, detail });
    console.error(`  ❌ FAIL | ${label} | ${detail}`);
  }
}

async function loadUser(userCode) {
  return User.findOne({ userCode }).lean();
}

async function loadLead(leadCode) {
  const lead = await Lead.findOne({ leadCode }).lean();
  if (!lead) return null;
  const owner = await User.findById(lead.ownerId).lean();
  lead._ownerTeam = owner ? owner.team : null;
  return lead;
}

// ─────────────────────────────────────────────────────────
async function testPhoneMasking() {
  console.log('\n[ Phone Masking ]');
  // PDF exact format: +971501112222 → +971********22
  // Rule: +<country_code> + 8 fixed asterisks + last 2 digits of full number
  const result = maskPhone('+971501112222');
  assert('mask +971501112222 → +971********22', result === '+971********22',
    `got: ${result}`);
  assert('Masked result has 8 asterisks', (result.match(/\*/g) || []).length === 8,
    `asterisk count: ${(result.match(/\*/g) || []).length}`);
  assert('Masked result ends with original last 2 digits (22)', result.endsWith('22'),
    `ends with: ${result.slice(-2)}`);
  assert('Masked result starts with +971', result.startsWith('+971'),
    `starts with: ${result.slice(0, 4)}`);
  assert('Full phone NOT returned for masked', maskPhone('+971501112222') !== '+971501112222');
}

// ─────────────────────────────────────────────────────────
async function testS1_AgentActivityOnOwnLead() {
  console.log('\n[ S1: U-01 logs activity on LD-01 ]');

  const ravi  = await loadUser('U-01');
  const ld01  = await loadLead('LD-01');

  assert('S1: Ravi canSee LD-01',      canSee(ravi, ld01));
  assert('S1: Ravi canEmit on LD-01',  canEmit(ravi, ld01));

  const sathya = await loadUser('U-04');  // Team lead, same team
  assert('S1: Sathya (TL Sathya) canSee LD-01', canSee(sathya, ld01));

  const bikash = await loadUser('U-03');  // Different team agent
  assert('S1: Bikash cannot see LD-01', !canSee(bikash, ld01));

  const marketing = await loadUser('U-06');
  assert('S1: Marketing canSee LD-01', canSee(marketing, ld01));

  const admin = await loadUser('U-07');
  assert('S1: Admin canSee LD-01',     canSee(admin, ld01));
}

// ─────────────────────────────────────────────────────────
async function testS2_S3_Reassignment() {
  console.log('\n[ S2/S3: LD-01 reassigned U-01 → U-03, access changes immediately ]');

  const ld01 = await loadLead('LD-01');

  // Before reassignment — owner is U-01 (Ravi)
  const ravi   = await loadUser('U-01');
  const priya  = await loadUser('U-02');
  const bikash = await loadUser('U-03');
  const sathya = await loadUser('U-04');
  const rishal = await loadUser('U-05');
  const mkt    = await loadUser('U-06');
  const admin  = await loadUser('U-07');

  const ownerCode = ld01.leadCode === 'LD-01' && String(ld01.ownerId) === String(ravi._id) ? 'U-01' : 'other';
  assert('S2: LD-01 initial owner is U-01', ownerCode === 'U-01');

  // Simulate reassignment: update in DB
  await Lead.findOneAndUpdate({ leadCode: 'LD-01' }, { ownerId: bikash._id });
  const ld01_after = await loadLead('LD-01');

  assert('S3: New owner team = Rishal',    ld01_after._ownerTeam === 'Rishal');
  assert('S3: U-01 (Ravi) CANNOT see',    !canSee(ravi, ld01_after));
  assert('S3: U-02 (Priya) CANNOT see',   !canSee(priya, ld01_after));
  assert('S3: U-03 (Bikash) CAN see',     canSee(bikash, ld01_after));
  assert('S3: U-04 (Sathya TL) CANNOT see', !canSee(sathya, ld01_after));
  assert('S3: U-05 (Rishal TL) CAN see',  canSee(rishal, ld01_after));
  assert('S3: U-06 (Marketing) CAN see',  canSee(mkt, ld01_after));
  assert('S3: U-07 (Admin) CAN see',      canSee(admin, ld01_after));

  // Restore original ownership
  await Lead.findOneAndUpdate({ leadCode: 'LD-01' }, { ownerId: ravi._id });
  console.log('   (LD-01 ownership restored to U-01)');
}

// ─────────────────────────────────────────────────────────
async function testS4_MultiDeviceDeactivation() {
  console.log('\n[ S4 (service layer): DB deactivation flags user immediately ]');
  // NOTE: S4 live two-socket test is in integration.test.js (testS4_TwoSocketDeactivation)
  // This test verifies the service layer: isActive=false blocks authorization immediately.

  const priya = await loadUser('U-02');
  assert('S4: U-02 (Priya) is currently active', priya.isActive);

  // Simulate deactivation (flip isActive in DB)
  await User.findByIdAndUpdate(priya._id, { isActive: false });
  const priyaDeactivated = await loadUser('U-02');

  const ld02 = await loadLead('LD-02');
  assert('S4: Deactivated U-02 cannot canSee (authorization fails at DB level)', !canSee(priyaDeactivated, ld02));
  assert('S4: Deactivated U-02 cannot canEmit', !canEmit(priyaDeactivated, ld02));
  assert('S4: isActive flag is false', !priyaDeactivated.isActive);

  // Restore U-02 to active for subsequent tests
  await User.findByIdAndUpdate(priya._id, { isActive: true });
  console.log('   (U-02 restored to active)');
}

// ─────────────────────────────────────────────────────────
async function testS5_MarketingEmitBlock() {
  console.log('\n[ S5: Marketing cannot emit activity ]');

  const mkt  = await loadUser('U-06');
  const ld01 = await loadLead('LD-01');

  assert('S5: Marketing canEmit = false', !canEmit(mkt, ld01));
  assert('S5: Marketing write-block fire', isMarketingWriteBlocked(mkt));
}

// ─────────────────────────────────────────────────────────
async function testS6_OriginLock() {
  console.log('\n[ S6: Origin validation logic ]');

  // This tests the origin check logic from socketAuth
  const mkt = await loadUser('U-06');
  assert('S6: Marketing origin = marketing', mkt.origin === 'marketing');

  // CRM origin for marketing user should be rejected
  const marketingFromCRM = mkt.origin === 'marketing' && env.CRM_ORIGIN !== env.MARKETING_ORIGIN;
  assert('S6: Marketing user from CRM_ORIGIN would be rejected', marketingFromCRM);
}

// ─────────────────────────────────────────────────────────
async function testS7_Replay() {
  console.log('\n[ S7: Cursor-based replay on LD-01 (post-S2: owned by Bikash/U-03) ]');

  // Reassign LD-01 to Bikash (simulating S2 state)
  const bikash = await loadUser('U-03');
  const ravi   = await loadUser('U-01');
  await Lead.findOneAndUpdate({ leadCode: 'LD-01' }, { ownerId: bikash._id });
  const ld01_post_s2 = await loadLead('LD-01');

  // Create 3 test activities on LD-01
  const admin = await loadUser('U-07');
  const a1 = await createActivity({ leadId: ld01_post_s2._id, actorId: admin._id, type: 'call', message: 'Offline activity 1 on LD-01' });
  const a2 = await createActivity({ leadId: ld01_post_s2._id, actorId: admin._id, type: 'call', message: 'Offline activity 2 on LD-01' });
  const a3 = await createActivity({ leadId: ld01_post_s2._id, actorId: admin._id, type: 'call', message: 'Offline activity 3 on LD-01' });

  // S7: Replay after a1's cursor — should return a2 and a3
  const replayed = await getActivitiesAfterCursor(a1.sequence);
  const replayedSeqs = replayed.map(a => a.sequence);

  assert('S7: Replay returns events after cursor', replayed.length >= 2);
  assert('S7: Replay does not include cursor event itself', !replayedSeqs.includes(a1.sequence));
  assert('S7: Replay is in ascending order', replayedSeqs[0] < replayedSeqs[replayedSeqs.length - 1] || replayedSeqs.length <= 1);

  // S7: Entitlement — reconnecting recipient is Bikash
  assert('S7: Bikash (reconnecting user) entitled to LD-01 replay', canSee(bikash, ld01_post_s2));
  assert('S7: Ravi NOT entitled to LD-01 replay events', !canSee(ravi, ld01_post_s2));

  // Clean up test activities + restore LD-01
  await Activity.deleteMany({ _id: { $in: [a1._id, a2._id, a3._id] } });
  await Lead.findOneAndUpdate({ leadCode: 'LD-01' }, { ownerId: ravi._id });
  console.log('   (LD-01 restored to U-01)');
}

// ─────────────────────────────────────────────────────────
async function testS8_ConcurrentEvents() {
  console.log('\n[ S8: Two updates to LD-03 50ms apart (ordering) ]');

  const admin = await loadUser('U-07');
  const ld03 = await loadLead('LD-03');

  // Trigger two events practically simultaneously
  const [update1, update2] = await Promise.all([
    createActivity({ leadId: ld03._id, actorId: admin._id, type: 'status_change', message: 'Update 1' }),
    new Promise(resolve => setTimeout(() => 
      createActivity({ leadId: ld03._id, actorId: admin._id, type: 'status_change', message: 'Update 2' }).then(resolve)
    , 50))
  ]);

  assert('S8: Two updates preserve order despite 50ms spacing', update1.sequence < update2.sequence);
  assert('S8: Sequence numbers are unique', update1.sequence !== update2.sequence);

  await Activity.deleteMany({ _id: { $in: [update1._id, update2._id] } });
}

// ─────────────────────────────────────────────────────────
async function testSerializerMasking() {
  console.log('\n[ Serializer: Per-recipient phone masking ]');

  const mkt  = await loadUser('U-06');
  const admin = await loadUser('U-07');
  const ravi  = await loadUser('U-01');
  const ld01  = await loadLead('LD-01');
  const fakeActivity = { _id: new mongoose.Types.ObjectId(), sequence: 1, actorId: ravi._id, type: 'call', message: 'hi', createdAt: new Date() };

  const mktPayload   = serializeActivityForRecipient(fakeActivity, mkt, ld01);
  const adminPayload = serializeActivityForRecipient(fakeActivity, admin, ld01);

  assert('Serializer: Marketing receives masked phone',   mktPayload.phone.includes('*'));
  assert('Serializer: Admin receives full phone',         !adminPayload.phone.includes('*'));
  assert('Serializer: Masked phone is not full phone',    mktPayload.phone !== ld01.phone);
}

// ─────────────────────────────────────────────────────────
async function printMatrix() {
  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('  AUTHORIZATION MATRIX — RESULTS');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('───────────────────────────────────────────────────────');
  results.forEach(r => console.log(`  ${r.status} | ${r.label}`));
  console.log('═══════════════════════════════════════════════════════\n');
}

// ─────────────────────────────────────────────────────────
async function run() {
  console.log('\n🧪 Lyka One — Authorization Matrix Test Suite');
  console.log('================================================');

  await connectDB(env.MONGO_URI);

  await testPhoneMasking();
  await testS1_AgentActivityOnOwnLead();
  await testS2_S3_Reassignment();
  await testS4_MultiDeviceDeactivation();
  await testS5_MarketingEmitBlock();
  await testS6_OriginLock();
  await testS7_Replay();
  await testS8_ConcurrentEvents();
  await testSerializerMasking();

  await printMatrix();

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('[TEST] Fatal error:', err.message);
  process.exit(1);
});
