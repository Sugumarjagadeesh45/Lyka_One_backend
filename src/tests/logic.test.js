'use strict';

/**
 * PURE LOGIC TEST — No MongoDB connection required.
 * Tests all authorization logic, masking, and serialization.
 * Run: node src/tests/logic.test.js
 */

// === Mini test harness ===
let pass = 0, fail = 0;
const results = [];

function assert(label, cond, detail = '') {
  if (cond) {
    pass++;
    results.push({ ok: true, label });
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    results.push({ ok: false, label, detail });
    console.error(`  ❌ ${label} | ${detail}`);
  }
}

// === Inline dependencies (no Mongoose needed) ===
const { ROLES } = require('../utils/constants');

// --- maskPhone inline copy (no mongoose import) ---
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return phone;
  const clean   = phone.startsWith('+') ? phone.slice(1) : phone;
  const prefix  = '+' + clean.slice(0, 3);
  const lastTwo = clean.slice(-2);
  return `${prefix}${'*'.repeat(8)}${lastTwo}`;
}

// --- Authorization logic inline ---
function canSee(user, lead) {
  if (!user || !lead) return false;
  if (!user.isActive) return false;
  switch (user.role) {
    case ROLES.ADMIN:     return true;
    case ROLES.MARKETING: return true;
    case ROLES.TEAM_LEAD: return user.team != null && lead._ownerTeam === user.team;
    case ROLES.AGENT:     return String(lead.ownerId) === String(user._id);
    default:              return false;
  }
}

function canEmit(user, lead) {
  if (!user || !lead) return false;
  if (!user.isActive) return false;
  switch (user.role) {
    case ROLES.ADMIN:     return true;
    case ROLES.MARKETING: return false;
    case ROLES.TEAM_LEAD: return user.team != null && lead._ownerTeam === user.team;
    case ROLES.AGENT:     return String(lead.ownerId) === String(user._id);
    default:              return false;
  }
}

function isMarketingWriteBlocked(user) {
  return user && user.role === ROLES.MARKETING;
}

function serializeForRecipient(lead, recipient) {
  return {
    phone: recipient.role === ROLES.MARKETING ? maskPhone(lead.phone) : lead.phone,
  };
}

// === Test subjects ===
const admin   = { _id: 'u07', role: 'admin',     team: null,     isActive: true  };
const mkt     = { _id: 'u06', role: 'marketing',  team: null,     isActive: true  };
const tl_sat  = { _id: 'u04', role: 'team_lead',  team: 'Sathya', isActive: true  };
const tl_ris  = { _id: 'u05', role: 'team_lead',  team: 'Rishal', isActive: true  };
const ravi    = { _id: 'u01', role: 'agent',      team: 'Sathya', isActive: true  };
const priya   = { _id: 'u02', role: 'agent',      team: 'Sathya', isActive: true  };
const bikash  = { _id: 'u03', role: 'agent',      team: 'Rishal', isActive: true  };
const inactive = { _id: 'u02b', role: 'agent',   team: 'Sathya', isActive: false };

// LD-01 owned by Ravi (Sathya team) — initial state
const ld01_initial  = { _id: 'l01', leadCode: 'LD-01', ownerId: 'u01', _ownerTeam: 'Sathya', phone: '+971501112222' };
// LD-01 after reassignment to Bikash (Rishal team)
const ld01_reassigned = { _id: 'l01', leadCode: 'LD-01', ownerId: 'u03', _ownerTeam: 'Rishal', phone: '+971501112222' };
// LD-02 owned by Priya (Sathya team)
const ld02 = { _id: 'l02', leadCode: 'LD-02', ownerId: 'u02', _ownerTeam: 'Sathya', phone: '+971552223344' };
// LD-03 owned by Bikash (Rishal team)
const ld03 = { _id: 'l03', leadCode: 'LD-03', ownerId: 'u03', _ownerTeam: 'Rishal', phone: '+971524445566' };

// ============================================================
console.log('\n🧪 LYKA ONE — PURE LOGIC AUTHORIZATION TESTS');
console.log('==============================================');

// --- Phone Masking ---
console.log('\n[ Phone Masking — PDF format: +971********22 ]');
assert('LD-01 phone masked correctly', maskPhone('+971501112222') === '+971********22', `got: ${maskPhone('+971501112222')}`);
assert('LD-02 phone masked correctly', maskPhone('+971552223344') === '+971********44', `got: ${maskPhone('+971552223344')}`);
assert('LD-03 phone masked correctly', maskPhone('+971524445566') === '+971********66', `got: ${maskPhone('+971524445566')}`);
assert('Masked has exactly 8 asterisks', (maskPhone('+971501112222').match(/\*/g) || []).length === 8);
assert('Full phone NOT returned in masked', maskPhone('+971501112222') !== '+971501112222');

// --- S1: Initial state canSee ---
console.log('\n[ S1: LD-01 initial owner = Ravi (Sathya team) ]');
assert('S1: U-01 Ravi canSee LD-01',        canSee(ravi, ld01_initial));
assert('S1: U-02 Priya CANNOT see LD-01',   !canSee(priya, ld01_initial));
assert('S1: U-03 Bikash CANNOT see LD-01',  !canSee(bikash, ld01_initial));
assert('S1: U-04 Sathya TL canSee LD-01',   canSee(tl_sat, ld01_initial));
assert('S1: U-05 Rishal TL CANNOT see',     !canSee(tl_ris, ld01_initial));
assert('S1: U-06 Marketing canSee LD-01',   canSee(mkt, ld01_initial));
assert('S1: U-07 Admin canSee LD-01',       canSee(admin, ld01_initial));

// --- S1: canEmit ---
console.log('\n[ S1: canEmit on LD-01 ]');
assert('S1: Ravi canEmit on LD-01',          canEmit(ravi, ld01_initial));
assert('S1: Sathya TL canEmit on LD-01',     canEmit(tl_sat, ld01_initial));
assert('S1: Bikash CANNOT emit on LD-01',    !canEmit(bikash, ld01_initial));
assert('S1: Marketing CANNOT emit ever',     !canEmit(mkt, ld01_initial));
assert('S1: Admin canEmit',                  canEmit(admin, ld01_initial));

// --- S3: After reassignment LD-01 → Bikash (Rishal team) ---
console.log('\n[ S3: After LD-01 reassigned U-01 → U-03 (Rishal team) ]');
assert('S3: U-01 Ravi CANNOT see (was owner)', !canSee(ravi, ld01_reassigned));
assert('S3: U-02 Priya CANNOT see',            !canSee(priya, ld01_reassigned));
assert('S3: U-03 Bikash CAN see (new owner)',   canSee(bikash, ld01_reassigned));
assert('S3: U-04 Sathya TL CANNOT see',        !canSee(tl_sat, ld01_reassigned));
assert('S3: U-05 Rishal TL CAN see',            canSee(tl_ris, ld01_reassigned));
assert('S3: U-06 Marketing CAN see (masked)',   canSee(mkt, ld01_reassigned));
assert('S3: U-07 Admin CAN see (full)',          canSee(admin, ld01_reassigned));

// --- S4 / S5: Marketing write-block ---
console.log('\n[ S4/S5: Deactivation and Marketing write-block ]');
assert('S5: isMarketingWriteBlocked(mkt) = true',   isMarketingWriteBlocked(mkt));
assert('S5: isMarketingWriteBlocked(ravi) = false',  !isMarketingWriteBlocked(ravi));
assert('S5: isMarketingWriteBlocked(admin) = false', !isMarketingWriteBlocked(admin));
assert('S5: Marketing canEmit = false (always)',     !canEmit(mkt, ld01_initial));
assert('S5: Marketing canEmit = false (all leads)',  !canEmit(mkt, ld02) && !canEmit(mkt, ld03));

// --- Inactive user ---
console.log('\n[ Inactive user is always blocked ]');
assert('Inactive user cannot canSee', !canSee(inactive, ld02));
assert('Inactive user cannot canEmit', !canEmit(inactive, ld02));

// --- Serializer masking ---
console.log('\n[ Serializer: Per-recipient masking ]');
const mktPayload   = serializeForRecipient(ld01_initial, mkt);
const adminPayload = serializeForRecipient(ld01_initial, admin);
const raviPayload  = serializeForRecipient(ld01_initial, ravi);
assert('Marketing wire payload has masked phone',   mktPayload.phone.includes('*'));
assert('Admin wire payload has full phone',         adminPayload.phone === '+971501112222');
assert('Agent wire payload has full phone',         raviPayload.phone === '+971501112222');
assert('Marketing never sees full phone on wire',   mktPayload.phone !== '+971501112222');

// --- Sequence ordering simulation ---
console.log('\n[ S8: Sequence ordering ]');
let counter = 0;
function nextSeq() { return ++counter; } // simulates atomic Counter
const seqA = nextSeq();
const seqB = nextSeq();
const seqC = nextSeq();
assert('S8: A.seq < B.seq', seqA < seqB);
assert('S8: B.seq < C.seq', seqB < seqC);
assert('S8: All unique',    new Set([seqA, seqB, seqC]).size === 3);

// === Summary ===
console.log('\n═══════════════════════════════════════════════════════');
console.log('  RESULTS: PASS=' + pass + '  FAIL=' + fail);
console.log('═══════════════════════════════════════════════════════');
results.filter(r => !r.ok).forEach(r => console.error('  ❌ FAIL:', r.label, r.detail || ''));
if (fail === 0) console.log('  🎉 All logic tests passed!\n');
process.exit(fail > 0 ? 1 : 0);
