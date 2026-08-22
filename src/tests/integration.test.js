'use strict';

/**
 * SOCKET.IO LIVE INTEGRATION TESTS
 * ==================================
 * Tests S3, S4, S5, S6, S7, S8 using real socket connections.
 *
 * These are E2E tests: a real HTTP+Socket.IO server starts on port 5099,
 * real JWTs are issued, real socket clients connect, and actual event delivery
 * is asserted on specific recipients.
 *
 * Run: npm run test:integration
 * Requires: MongoDB connected (MONGO_URI in .env)
 */

require('dotenv').config();

const http        = require('http');
const fetch       = require('node-fetch');
const { io: ioClient } = require('socket.io-client');
const mongoose    = require('mongoose');

const env    = require('../config/env');
const app    = require('../app');
const { connectDB }  = require('../config/db');
const { initSocket } = require('../socket/socket');

const User     = require('../models/User');
const Lead     = require('../models/Lead');
const Activity = require('../models/Activity');
const { login }   = require('../services/auth.service');

const userController     = require('../controllers/user.controller');
const leadController     = require('../controllers/lead.controller');
const activityController = require('../controllers/activity.controller');

const TEST_PORT   = 5099; // Isolated port for integration tests
const BASE_URL    = `http://localhost:${TEST_PORT}`;
const CRM_ORIGIN  = env.CRM_ORIGIN;
const MKT_ORIGIN  = env.MARKETING_ORIGIN;

// ─── Test harness ─────────────────────────────────────────────
let pass = 0, fail = 0;
const results = [];

function assert(label, cond, detail = '') {
  if (cond) { pass++; results.push({ ok: true, label }); console.log(`  ✅ ${label}`); }
  else { fail++; results.push({ ok: false, label, detail }); console.error(`  ❌ ${label} | ${detail || ''}`); }
}

function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Connect a socket client. Returns a promise that resolves with the connected socket. */
function connectSocket(token, originHeader, lastCursor) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE_URL, {
      auth:          { token, ...(lastCursor !== undefined ? { lastCursor } : {}) },
      extraHeaders:  { origin: originHeader },
      reconnection:  false,
      timeout:       5000,
    });
    socket.on('connect',       () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
    setTimeout(() => reject(new Error('Socket connect timeout')), 6000);
  });
}

/** Emit an event and wait for an acknowledgement. */
function emitWithAck(socket, event, payload, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

/** Wait for a specific event on a socket. Resolves with the payload or times out. */
function waitForEvent(socket, event, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// ─── Global state ──────────────────────────────────────────────
let server, io;
const tokens = {};
const userDocs = {};

// ─── Setup & Teardown ──────────────────────────────────────────
async function setup() {
  console.log('\n[SETUP] Connecting to MongoDB...');
  await connectDB(env.MONGO_URI);

  // Restore seed state before integration tests
  const u01 = await User.findOne({ userCode: 'U-01' });
  const u02 = await User.findOne({ userCode: 'U-02' });
  const u03 = await User.findOne({ userCode: 'U-03' });

  // Reset: U-02 active, LD-01 owned by U-01
  await User.findByIdAndUpdate(u02._id, { isActive: true, role: 'agent' });
  await Lead.findOneAndUpdate({ leadCode: 'LD-01' }, { ownerId: u01._id });

  console.log('[SETUP] Seed state restored (U-02 active, LD-01 → U-01)');

  // Start isolated test server
  const httpServer = http.createServer(app);
  io = initSocket(httpServer);
  userController.setIo(io);
  leadController.setIo(io);
  activityController.setIo(io);
  await new Promise(resolve => httpServer.listen(TEST_PORT, resolve));
  server = httpServer;

  // Login all 7 users
  const creds = [
    { code: 'U-01', email: 'ravi@lykaone.com',      password: 'Ravi@1234' },
    { code: 'U-02', email: 'priya@lykaone.com',     password: 'Priya@1234' },
    { code: 'U-03', email: 'bikash@lykaone.com',    password: 'Bikash@1234' },
    { code: 'U-04', email: 'sathya@lykaone.com',    password: 'Sathya@1234' },
    { code: 'U-05', email: 'rishal@lykaone.com',    password: 'Rishal@1234' },
    { code: 'U-06', email: 'marketing@lykaone.com', password: 'Marketing@1234' },
    { code: 'U-07', email: 'vignesh@lykaone.com',   password: 'Vignesh@1234' },
  ];
  for (const c of creds) {
    const { token, user } = await login(c.email, c.password);
    tokens[c.code] = token;
    userDocs[c.code] = user;
  }

  console.log('[SETUP] All tokens obtained. Test server on port', TEST_PORT);
}

async function teardown(sockets = []) {
  for (const s of sockets) {
    try { if (s.connected) s.disconnect(); } catch (_) {}
  }
  await waitMs(300);
  await new Promise(r => server.close(r));
  await mongoose.disconnect();
  console.log('[TEARDOWN] Done.');
}

// ═══════════════════════════════════════════════════════════
// S3 — LIVE REASSIGNMENT: old recipients stop, new ones start
// ═══════════════════════════════════════════════════════════
async function testS3_LiveReassignment() {
  console.log('\n[ S3: Live Reassignment — LD-01: U-01 → U-03 ]');

  const sockets = {};
  const received = {};
  const openSockets = [];

  // Restore LD-01 to U-01 first
  await Lead.findOneAndUpdate({ leadCode: 'LD-01' }, { ownerId: userDocs['U-01']._id });

  // Connect all 6 non-admin users + admin
  for (const [code, token] of Object.entries(tokens)) {
    const origin = code === 'U-06' ? MKT_ORIGIN : CRM_ORIGIN;
    try {
      sockets[code] = await connectSocket(token, origin);
      received[code] = [];
      sockets[code].on('activity:new', (payload) => received[code].push(payload));
      openSockets.push(sockets[code]);
    } catch (err) {
      console.error(`  ⚠️  Could not connect ${code}: ${err.message}`);
    }
  }

  await waitMs(300);

  // Step S2: Reassign LD-01 from U-01 → U-03 via Admin socket
  const lead = await Lead.findOne({ leadCode: 'LD-01' });
  await Lead.findByIdAndUpdate(lead._id, { ownerId: userDocs['U-03']._id });
  console.log('  [S2] LD-01 reassigned U-01 → U-03 in DB');

  await waitMs(200);

  // Create activity AFTER reassignment on LD-01
  const actRes = await fetch(`${BASE_URL}/api/leads/${lead._id}/activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens['U-07']}` },
    body: JSON.stringify({ type: 'note', message: 'Post-reassignment test activity on LD-01' }),
  });
  assert('S3: Activity creation succeeded', actRes.ok, `Status: ${actRes.status}`);

  await waitMs(1000); // Allow broadcast to propagate

  // Verify recipient matrix
  assert('S3: U-01 (old owner) did NOT receive', received['U-01']?.length === 0, `got ${received['U-01']?.length}`);
  assert('S3: U-02 (Sathya agent) did NOT receive', received['U-02']?.length === 0, `got ${received['U-02']?.length}`);
  assert('S3: U-03 (new owner) DID receive', received['U-03']?.length > 0, `got ${received['U-03']?.length}`);
  assert('S3: U-04 (Sathya TL) did NOT receive', received['U-04']?.length === 0, `got ${received['U-04']?.length}`);
  assert('S3: U-05 (Rishal TL) DID receive', received['U-05']?.length > 0, `got ${received['U-05']?.length}`);
  assert('S3: U-06 (Marketing) DID receive (masked)', received['U-06']?.length > 0);
  assert('S3: U-07 (Admin) DID receive (full)', received['U-07']?.length > 0);

  // Marketing masking on wire
  if (received['U-06']?.length > 0) {
    assert('S3: Marketing phone is masked on wire', received['U-06'][0].phone?.includes('*'));
    assert('S3: Admin phone is NOT masked on wire', !received['U-07'][0]?.phone?.includes('*'));
  }

  for (const s of openSockets) { try { s.disconnect(); } catch (_) {} }
  await waitMs(300);

  // Restore LD-01 to U-01 for subsequent tests
  await Lead.findByIdAndUpdate(lead._id, { ownerId: userDocs['U-01']._id });
}

// ═══════════════════════════════════════════════════════════
// S3b — LIVE REASSIGNMENT via REST PATCH: full E2E flow
// ═══════════════════════════════════════════════════════════
async function testS3_LiveReassignment_ViaREST() {
  console.log('\n[ S3b: Live Reassignment via REST — LD-01: U-01 → U-03 (Admin PATCH) ]');

  const sockets = {};
  const received = {};
  const openSockets = [];

  // Restore LD-01 to U-01 first
  await Lead.findOneAndUpdate({ leadCode: 'LD-01' }, { ownerId: userDocs['U-01']._id });

  // Connect all 6 non-admin users + admin
  for (const [code, token] of Object.entries(tokens)) {
    const origin = code === 'U-06' ? MKT_ORIGIN : CRM_ORIGIN;
    try {
      sockets[code] = await connectSocket(token, origin);
      received[code] = [];
      sockets[code].on('activity:new', (payload) => received[code].push(payload));
      openSockets.push(sockets[code]);
    } catch (err) {
      console.error(`  ⚠️  Could not connect ${code}: ${err.message}`);
    }
  }

  await waitMs(300);

  // Reassign via REST API as Admin
  const lead = await Lead.findOne({ leadCode: 'LD-01' });
  const https = require('http');
  const fetch = require('node-fetch');
  
  const reassignRes = await fetch(`${BASE_URL}/api/leads/${lead._id}/reassign`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens['U-07']}` },
    body: JSON.stringify({ ownerId: String(userDocs['U-03']._id) }),
  });
  assert('S3b: Reassignment API call succeeded', reassignRes.ok, `Status: ${reassignRes.status}`);

  await waitMs(200);

  // Create activity AFTER reassignment on LD-01
  const actRes = await fetch(`${BASE_URL}/api/leads/${lead._id}/activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens['U-07']}` },
    body: JSON.stringify({ type: 'note', message: 'Post-reassignment via REST test activity on LD-01' }),
  });
  assert('S3b: Activity creation succeeded', actRes.ok, `Status: ${actRes.status}`);

  await waitMs(1000); // Allow broadcast to propagate

  // Verify recipient matrix
  assert('S3b: U-01 (old owner) did NOT receive', received['U-01']?.length === 0, `got ${received['U-01']?.length}`);
  assert('S3b: U-02 (Sathya agent) did NOT receive', received['U-02']?.length === 0, `got ${received['U-02']?.length}`);
  assert('S3b: U-03 (new owner) DID receive', received['U-03']?.length > 0, `got ${received['U-03']?.length}`);
  assert('S3b: U-04 (Sathya TL) did NOT receive', received['U-04']?.length === 0, `got ${received['U-04']?.length}`);
  assert('S3b: U-05 (Rishal TL) DID receive', received['U-05']?.length > 0, `got ${received['U-05']?.length}`);
  assert('S3b: U-06 (Marketing) DID receive (masked)', received['U-06']?.length > 0);
  assert('S3b: U-07 (Admin) DID receive (full)', received['U-07']?.length > 0);

  for (const s of openSockets) { try { s.disconnect(); } catch (_) {} }
  await waitMs(300);

  // Restore LD-01 to U-01 for subsequent tests
  await Lead.findByIdAndUpdate(lead._id, { ownerId: userDocs['U-01']._id });
}

// ═══════════════════════════════════════════════════════════
// S4 — U-02 connected on TWO simultaneous sockets, both disconnected
// ═══════════════════════════════════════════════════════════
async function testS4_TwoSocketDeactivation() {
  console.log('\n[ S4: U-02 connected on 2 sockets — admin deactivates, both disconnect ]');

  // Make sure U-02 is active
  await User.findByIdAndUpdate(userDocs['U-02']._id, { isActive: true });

  let socketA, socketB;
  try {
    socketA = await connectSocket(tokens['U-02'], CRM_ORIGIN);
    socketB = await connectSocket(tokens['U-02'], CRM_ORIGIN);
  } catch (err) {
    assert('S4: Two U-02 sockets connected', false, err.message);
    return;
  }

  assert('S4: Socket A connected', socketA.connected);
  assert('S4: Socket B connected', socketB.connected);

  const disconnectedA = waitForEvent(socketA, 'disconnect', 5000);
  const disconnectedB = waitForEvent(socketB, 'disconnect', 5000);

  // Admin deactivates U-02 via REST
  const deactivateRes = await fetch(`${BASE_URL}/api/users/${userDocs['U-02']._id}/deactivate`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${tokens['U-07']}` },
  });
  assert('S4: Deactivation API call succeeded', deactivateRes.ok, `Status: ${deactivateRes.status}`);

  const [dA, dB] = await Promise.all([disconnectedA, disconnectedB]);

  assert('S4: Socket A was forcibly disconnected', dA !== null, 'socket A did not disconnect');
  assert('S4: Socket B was forcibly disconnected', dB !== null, 'socket B did not disconnect');
  assert('S4: Socket A is no longer connected', !socketA.connected);
  assert('S4: Socket B is no longer connected', !socketB.connected);

  // Verify future login fails
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya@lykaone.com', password: 'Priya@1234' }),
  });
  assert('S4: Deactivated user login is rejected (403)', loginRes.status === 403, `Status: ${loginRes.status}`);

  // Restore U-02 for safety
  await User.findByIdAndUpdate(userDocs['U-02']._id, { isActive: true });
}

// ═══════════════════════════════════════════════════════════
// S5 — Marketing socket emit activity:create returns FORBIDDEN
// ═══════════════════════════════════════════════════════════
async function testS5_MarketingWriteBlock() {
  console.log('\n[ S5: Marketing socket emit → explicit FORBIDDEN acknowledgement ]');

  const lead = await Lead.findOne({ leadCode: 'LD-01' });
  let mktSocket;
  try {
    mktSocket = await connectSocket(tokens['U-06'], MKT_ORIGIN);
  } catch (err) {
    assert('S5: Marketing socket connected from correct origin', false, err.message);
    return;
  }
  assert('S5: Marketing socket connected', mktSocket.connected);

  const ack = await emitWithAck(mktSocket, 'activity:create', {
    leadId:  String(lead._id),
    type:    'note',
    message: 'Marketing trying to write',
  });

  assert('S5: Acknowledgement received (not silent ignore)', !ack?.timedOut, 'no ack received');
  assert('S5: success is false', ack?.success === false, `success: ${ack?.success}`);
  assert('S5: code is FORBIDDEN', ack?.code === 'FORBIDDEN', `code: ${ack?.code}`);
  assert('S5: Explicit rejection message present', typeof ack?.message === 'string' && ack.message.length > 0);

  mktSocket.disconnect();
  await waitMs(200);
}

// ═══════════════════════════════════════════════════════════
// S6 — Valid Marketing JWT from CRM Origin → handshake rejected
// ═══════════════════════════════════════════════════════════
async function testS6_OriginLock() {
  console.log('\n[ S6: Valid Marketing JWT from CRM Origin → handshake rejected ]');

  // Marketing JWT is valid but presented from CRM_ORIGIN
  try {
    const badSocket = await connectSocket(tokens['U-06'], CRM_ORIGIN);
    // If we get here, it connected — that is wrong
    assert('S6: Marketing from CRM_ORIGIN was REJECTED', false, 'Socket connected when it should have been rejected');
    badSocket.disconnect();
  } catch (err) {
    // connect_error is expected — the handshake must be rejected
    assert('S6: Marketing from CRM_ORIGIN was REJECTED (connect_error)', true);
    assert('S6: Rejection message mentions origin or permissions', err.message.toLowerCase().includes('origin') || err.message.toLowerCase().includes('permitted'), `got: ${err.message}`);
  }

  // Sanity: Marketing from MARKETING_ORIGIN should succeed
  try {
    const goodSocket = await connectSocket(tokens['U-06'], MKT_ORIGIN);
    assert('S6: Marketing from MARKETING_ORIGIN IS allowed', goodSocket.connected);
    goodSocket.disconnect();
  } catch (err) {
    assert('S6: Marketing from MARKETING_ORIGIN IS allowed', false, err.message);
  }

  await waitMs(200);
}

// ═══════════════════════════════════════════════════════════
// S7 — U-03 disconnect → 3 activities on LD-01 → reconnect with cursor → replay
// ═══════════════════════════════════════════════════════════
async function testS7_CursorReplay() {
  console.log('\n[ S7: U-03 disconnects → 3 LD-01 activities → reconnect → replay exactly those 3 ]');

  // First, reassign LD-01 to U-03 (S2 state precondition)
  const lead = await Lead.findOne({ leadCode: 'LD-01' });
  await Lead.findByIdAndUpdate(lead._id, { ownerId: userDocs['U-03']._id });
  console.log('  [PRE] LD-01 reassigned to U-03 (simulating S2 state)');

  // U-03 connects and captures lastCursor via first activity
  let u03Socket = await connectSocket(tokens['U-03'], CRM_ORIGIN);
  assert('S7: U-03 initial socket connected', u03Socket.connected);

  // Get current max cursor before disconnect
  const latestActivity = await Activity.findOne().sort({ sequence: -1 }).lean();
  const lastCursor = latestActivity ? latestActivity.sequence : 0;
  console.log(`  [S7] lastCursor = ${lastCursor}`);

  // U-03 disconnects
  u03Socket.disconnect();
  await waitMs(300);
  assert('S7: U-03 disconnected', !u03Socket.connected);

  // Create exactly 3 activities on LD-01 while U-03 is offline (admin creates them)
  for (let i = 1; i <= 3; i++) {
    const r = await fetch(`${BASE_URL}/api/leads/${lead._id}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens['U-07']}` },
      body: JSON.stringify({ type: 'call', message: `Offline activity #${i} on LD-01` }),
    });
    assert(`S7: Offline activity #${i} created`, r.ok, `Status: ${r.status}`);
  }

  console.log('  [S7] 3 activities created on LD-01 while U-03 was offline');

  // U-03 reconnects with lastCursor
  u03Socket = await connectSocket(tokens['U-03'], CRM_ORIGIN, lastCursor);
  assert('S7: U-03 reconnected with lastCursor', u03Socket.connected);

  // Collect replay event
  const replayPayload = await waitForEvent(u03Socket, 'activity:replay', 5000);

  assert('S7: Replay event received', replayPayload !== null, 'no activity:replay event received');

  if (replayPayload) {
    const events = replayPayload.events || [];
    assert('S7: Exactly 3 events replayed', events.length === 3, `got ${events.length}`);

    // Verify they are all for LD-01
    assert('S7: All replayed events are for LD-01',
      events.every(e => e.leadCode === 'LD-01'),
      `leadCodes: ${events.map(e => e.leadCode).join(', ')}`);

    // Verify ordering
    const seqs = events.map(e => e.sequence);
    const sorted = [...seqs].sort((a, b) => a - b);
    assert('S7: Events in ascending sequence order', JSON.stringify(seqs) === JSON.stringify(sorted),
      `seqs: ${JSON.stringify(seqs)}`);

    // Verify no events with sequence <= lastCursor (no duplicates)
    assert('S7: No events before or at lastCursor',
      events.every(e => e.sequence > lastCursor),
      `min seq: ${Math.min(...seqs)}, cursor: ${lastCursor}`);

    // Verify phone is NOT masked (U-03 is an agent, not marketing)
    assert('S7: Agent receives full phone (not masked)', !events[0].phone?.includes('*'));
  }

  u03Socket.disconnect();

  // Restore LD-01 to U-01
  await Lead.findByIdAndUpdate(lead._id, { ownerId: userDocs['U-01']._id });
  await waitMs(300);
}

// ═══════════════════════════════════════════════════════════
// S8 — Two events 50ms apart → sequence order preserved
// ═══════════════════════════════════════════════════════════
async function testS8_SequenceOrdering() {
  console.log('\n[ S8: Two events 50ms apart → recipients observe in sequence order ]');

  // Restore LD-03 (owned by U-03 = Bikash)
  const ld03 = await Lead.findOne({ leadCode: 'LD-03' });

  // Connect U-05 (Rishal TL, can see LD-03) to observe
  const observerSocket = await connectSocket(tokens['U-05'], CRM_ORIGIN);
  const observedEvents = [];
  observerSocket.on('activity:new', (p) => observedEvents.push(p));

  // Make sure LD-03 is owned by U-03 (Bikash, Rishal team)
  await Lead.findByIdAndUpdate(ld03._id, { ownerId: userDocs['U-03']._id });

  await waitMs(200);

  // Fire two activities 50ms apart
  const a1Promise = fetch(`${BASE_URL}/api/leads/${ld03._id}/activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens['U-07']}` },
    body: JSON.stringify({ type: 'call', message: 'Event A on LD-03' }),
  });
  await waitMs(50);
  const a2Promise = fetch(`${BASE_URL}/api/leads/${ld03._id}/activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens['U-07']}` },
    body: JSON.stringify({ type: 'call', message: 'Event B on LD-03' }),
  });

  const [r1, r2] = await Promise.all([a1Promise, a2Promise]);
  assert('S8: Event A created', r1.ok, `Status: ${r1.status}`);
  assert('S8: Event B created', r2.ok, `Status: ${r2.status}`);

  // Wait for both broadcasts to arrive
  await waitMs(1500);

  assert('S8: Observer received at least 2 events', observedEvents.length >= 2, `got ${observedEvents.length}`);

  if (observedEvents.length >= 2) {
    const last2 = observedEvents.slice(-2);
    assert('S8: Events in ascending sequence order',
      last2[0].sequence < last2[1].sequence,
      `seq: ${last2[0].sequence} vs ${last2[1].sequence}`);
    assert('S8: Sequences are unique', last2[0].sequence !== last2[1].sequence);
  }

  observerSocket.disconnect();
  await waitMs(200);
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
async function run() {
  console.log('\n🔌 LYKA ONE — SOCKET.IO LIVE INTEGRATION TESTS');
  console.log('=================================================');

  try {
    await setup();
  } catch (err) {
    console.error('[FATAL] Setup failed:', err.message);
    process.exit(1);
  }

  try {
    await testS3_LiveReassignment();
    await testS3_LiveReassignment_ViaREST();
    await testS4_TwoSocketDeactivation();
    await testS5_MarketingWriteBlock();
    await testS6_OriginLock();
    await testS7_CursorReplay();
    await testS8_SequenceOrdering();
  } catch (err) {
    console.error('[FATAL] Test crashed:', err.message, err.stack);
    fail++;
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SOCKET.IO INTEGRATION — RESULTS');
  console.log(`  Total: ${pass + fail} | Passed: ${pass} | Failed: ${fail}`);
  console.log('───────────────────────────────────────────────────────');
  results.forEach(r => console.log(`  ${r.ok ? '✅' : '❌'} ${r.label}${!r.ok && r.detail ? ' | ' + r.detail : ''}`));
  console.log('═══════════════════════════════════════════════════════\n');

  await teardown();
  process.exit(fail > 0 ? 1 : 0);
}

run();
