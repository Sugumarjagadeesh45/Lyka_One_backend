# NOTES.md — Lyka One: Party Line
## Sugumar Jagadeesh — Backend Assessment Submission

---

## Part C: Six Questions

### Q1 — Explain to a non-engineer why a socket that was correctly authorized an hour ago can receive unauthorized data today.

Imagine a building with a security guard at the front door. When you entered an hour ago, the guard checked your ID and let you in. You're now inside. But in the last hour, your keycard was cancelled — you were fired.

The problem is: the guard only checks your ID *at the door*. Once you're inside, nobody re-checks. You can walk into any room, attend any meeting, read any file — because the original check at the door is all that ever happened.

A socket connection is the same. When the connection opens, the server checks the JWT and grants access. But a socket connection can stay open for hours. If:
- The user's role changes (team_lead → agent)
- The lead is reassigned to a different team
- The user is deactivated

...none of those changes are automatically re-checked on an existing socket. Every event the server broadcasts after that change can still reach a socket that should no longer receive it — because the server is still treating it as "the connection that was verified an hour ago."

**This system fixes that** by never trusting the connection's age. Before every event is delivered, it reads the current user and current lead from the database. The check happens at the moment of delivery, not at the moment of connection.

---

### Q2 — JWT still shows team_lead when the user was demoted. What does the server trust? What is the cost?

**What the server trusts: the database, not the JWT.**

The JWT in this system contains only `{ sub: userId }` — one field. No role. No team. No permissions. The JWT proves *who you are* (identity), never *what you can do* (authorization).

On every request — REST or Socket.IO event — the server does:

```
JWT verified → userId extracted
        ↓
User.findById(userId)     ← LIVE DB READ
        ↓
user.role checked here    ← Always current
```

So when an admin demotes a team_lead to agent, the next event delivery immediately evaluates with `role: "agent"` — regardless of what the old JWT says. The JWT becomes irrelevant for authorization the moment it is verified.

**The cost: one extra DB read per delivery.**

For 7 users (assessment scale): microseconds, irrelevant.

For 10,000 concurrent users: 10,000 DB reads per broadcast event. This is the R1/R7 tradeoff (see Q6). In production at scale, a versioned cache with explicit invalidation on role change would reduce this cost while still satisfying R1.

**Why this is the correct choice:**
If we stored `role: "team_lead"` in the JWT and trusted it, a demoted user would continue receiving team-lead-level events for up to `JWT_EXPIRES_IN` (1 hour) after demotion. In a real estate CRM handling sensitive client data, that is an unacceptable security window.

---

### Q3 — Replay authorization: at event-creation time or at replay time? Choose one and explain the downside.

**My choice: replay time. Authorization is evaluated when the replay is delivered, not when the original event was created.**

**Why:** The replay serves a user who just reconnected. The question "can this user see this event now?" should be answered against *current* state. If the lead was reassigned while they were offline, they may no longer be entitled.

**Implementation:**
```javascript
// sendReplay() in socketHandlers.js
for (const activity of activitiesAfterCursor) {
    const currentLead = await getCurrentLeadWithOwnerTeam(activity.leadId);
    if (!canSee(reconnectingUser, currentLead)) continue;  // Current check
    replayed.push(serializeForRecipient(activity, reconnectingUser, currentLead));
}
```

**The downside of choosing replay time:**

If U-03 (Bikash) was the owner of LD-01 when the original event was created — and therefore entitled to receive it at creation time — but is then reassigned *before* he reconnects, he will NOT receive the replay even though he was entitled when it happened.

This means replay does not accurately reconstruct "what you would have seen if you hadn't disconnected." It reconstructs "what you would see if you connected now."

**The alternative (event-creation time) downside:**
A user who lost entitlement (lead reassigned, role changed) would receive replayed events for data they are no longer authorized to access. This is a data leak.

**Verdict:** Replay-time authorization is the correct security choice. The data-reconstruction fidelity tradeoff is acceptable; unauthorized data delivery is not.

---

### Q4 — Pick one unreleased product from your CV. What stopped it from launching?

Miyofresh is one of the unreleased products listed in my CV. The product is approximately 99% complete from the development side, but it has not yet been publicly launched because it is currently waiting for the customer's final review and approval. The remaining work is primarily based on final customer feedback and release confirmation rather than a major technical blocker. This experience taught me that completing development and shipping a product are two different milestones — a production launch also depends on stakeholder review, acceptance, and release readiness.

---

### Q5 — Where did you use AI? Where did you work yourself? Where was AI wrong? How did you catch it?

I used Antigravity heavily for scaffolding and implementation. I reviewed the specification, tested the generated behavior, identified mismatches such as S7, S4 and the Part C questions, and directed the corrections.

**Where AI helped (heavy usage):**
- Generating boilerplate: initial file structure scaffolding, Mongoose model schemas, seed data shape.
- Writing the core socket event handlers and integration test boilerplate.
- Suggesting the atomic Counter approach for sequence generation.

**Where I guided, reviewed, and corrected (human oversight):**
- **S7 scenario identification**: AI initially wrote S7 as happening on LD-03. I caught that S7 in the PDF is about LD-01 *after* the S2 reassignment, and corrected it.
- **S4 mislabeled**: AI labeled S4 as "marketing write-block." The PDF S4 is about two-socket deactivation. S5 is the write-block. I corrected both the test and README.
- **NOTES.md wrong questions**: AI answered architecture questions (Q1-Q5: how does auth work, how does reassignment work, etc.) instead of the actual Part C assessment questions. I identified every question was wrong and required a full rewrite.
- **Variable masking length**: AI used `rest.length - 2` asterisks, which leaks phone number length. PDF shows fixed 8. I identified this as an information leakage issue and directed the correction.
- **`actor` variable in `sendReplay()`**: AI named the reconnecting user `actor` — implying it was the original activity creator. I identified this as a misleading name that could cause a logic bug, renamed it `reconnectingUser`, and verified authorization happens on the *recipient*.
- **The R1/R7 contradiction**: I made the conscious architectural decision to reject caching at socket connect time to prioritize R1 security over R7 performance, knowing the tradeoff.

---

### Q6 — Identify the contradictory rule, explain it, and explain what you did.

**The contradiction: R1 vs R7.**

- **R1 (Live Authorization):** "Authorization must reflect the current state at the moment the event is delivered." This means: if a lead is reassigned at 3:00pm, the 3:01pm event must not reach the old owner — even if the old owner's socket is still connected from 2:00pm.

- **R7 (Socket Lifetime Cache):** The assessment explicitly states to authorize once when the socket connects and cache the permission set for the lifetime of that socket. If you do this: at connect time, you read `role`, `team`, and accessible leads into `socket.permissions`. All subsequent delivery checks use this cache.

**Why they contradict:** R7 makes R1 impossible. If you cache permissions at connect time (2:00pm) and a reassignment happens at 3:00pm, the 3:01pm event delivery still uses the 2:00pm cache and delivers to the wrong recipient. The leak exists for the entire duration of the socket connection.

**What I did: R1 wins.**

Only `socket.userId` is stored on the socket (it never changes — the user's identity doesn't shift during a session). Everything else — `role`, `team`, `isActive`, lead ownership — is loaded from MongoDB on every event delivery.

```javascript
// broadcastActivity() — called for every new event
for (const recipient of allActiveUsers) {
    const recipientFromDB = await getCurrentUser(recipient._id); // Fresh DB read
    const leadFromDB = await getCurrentLeadWithOwnerTeam(leadId); // Fresh DB read
    if (!canSee(recipientFromDB, leadFromDB)) continue;           // Current check
    // ...
}
```

**Performance tradeoff I consciously accept:**

- At assessment scale (7 users): negligible — microseconds per broadcast.
- At production scale (10,000 concurrent users): 10,000 DB reads per broadcast. This requires a versioned permission cache with explicit invalidation events (role change, reassignment, deactivation each trigger cache bust). Redis + Mongoose middleware hooks would implement this.

**Why this is defensible:**

A security assessment that tests reassignment, role change, and deactivation *all at runtime* is specifically testing for R7 cache bugs. The correct answer for this assessment is live authorization. I preserved the performance intent of R7, but I did not allow a stale permission snapshot to become the authorization source because that would fail R1, R2, and R3. In production, I would reconcile both with an invalidatable/versioned permission cache. Correctness first; then optimize with explicit invalidation.

---

## Implementation Notes

### Architecture Overview

```
React Client
     │
     ├─── HTTP/REST ──▶ Express + Zod + Middleware
     │                         │
     └─── Socket.IO ──────────▶ Socket.IO Server
                                │
                       Authorization Service
                         ├── canSee()
                         ├── canEmit()
                         └── isMarketingWriteBlocked()
                                │
                          Per-Recipient Serializer
                                │
                           MongoDB (Mongoose)
                           (User, Lead, Activity, Counter)
```

### Phone Masking Design Decision

The PDF demonstrates the masking format using: `+971501112222 → +971********99`

Note that "99" does not match the actual last 2 digits of the sample number (which are "22"). The PDF is showing the FORMAT, not an exact transformation. The illustrative "99" suggests the format is: country code + 8 fixed asterisks + last 2 digits.

This implementation uses **exactly 8 asterisks + actual last 2 digits of the full number**:
```
+971501112222 → +971********22
+971552223344 → +971********44
```

**Why fixed 8:** A variable count (`rest.length - 2`) leaks the phone number's length. Fixed 8 prevents that information leakage.

**Assumption documented:** The PDF's "99" appears to be a distinct illustrative number whose last 2 digits happen to be "99". This implementation applies the same format pattern to the actual assessment phone numbers.

### Multi-Device Socket Registry

```
Map<userId, Set<socketId>>

U-02: { socket-A, socket-B }
          ↓ on deactivate
For each socketId in Set:
    socket.emit('user:deactivated')
    socket.disconnect(true)
```

### S7 Exact Scenario (PDF-aligned)

```
S2: Admin reassigns LD-01: U-01 → U-03
        ↓
S7: U-03 (Bikash) disconnects  [lastCursor = N]
        ↓
3 activities occur on LD-01    [seq: N+1, N+2, N+3]
        ↓
U-03 reconnects { lastCursor: N }
        ↓
Server: getActivitiesAfterCursor(N)
        ↓
For each: canSee(U-03 [reconnectingUser], LD-01 [current state])
        ↓
3 events replayed → U-03 (LD-01 phone: full, not masked)
```

### Exact Recipient List (S1–S8)

**S1: U-01 logs activity on LD-01**
- **MUST RECEIVE:** U-01 (Owner), U-04 (Sathya TL), U-06 (Marketing, masked), U-07 (Admin)
- **MUST NOT RECEIVE:** U-02 (Agent other), U-03 (Agent other team), U-05 (Rishal TL)

**S2: LD-01 reassigned U-01 → U-03 (Sathya → Rishal)**
- **MUST RECEIVE (State Change):** U-03 (New Owner), U-05 (Rishal TL), U-06 (Marketing), U-07 (Admin)
- **MUST NOT RECEIVE:** U-01 (Old Owner), U-02, U-04 (Sathya TL)

**S3: Activity on LD-01 immediately after S2**
- **MUST RECEIVE:** U-03 (New Owner), U-05 (Rishal TL), U-06 (Marketing, masked), U-07 (Admin)
- **MUST NOT RECEIVE (The Leak Test):** U-01 (Old Owner), U-04 (Old TL), U-02

**S4: U-02 deactivated while connected on two devices**
- **MUST RECEIVE:** None (U-02's sockets are forcefully disconnected immediately)
- **MUST NOT RECEIVE:** U-02 (Both devices disconnected, subsequent events dropped)

**S5: U-06 (Marketing) attempts to emit on LD-02**
- **MUST RECEIVE:** None (Action blocked. No activity created.)
- **MUST NOT RECEIVE:** All (No event broadcast)

**S6: U-06 connects from CRM origin**
- **MUST RECEIVE:** None (Connection refused at handshake)
- **MUST NOT RECEIVE:** All

**S7: U-03 offline 90s, 3 activities on LD-01, reconnects**
- **MUST RECEIVE (Replay):** U-03 (receives exactly the 3 missed events in sequence order)
- **MUST NOT RECEIVE:** U-01, U-04 (no longer entitled to LD-01 post-S2)

**S8: Two updates to LD-03 50ms apart**
- **MUST RECEIVE:** U-03 (Owner), U-05 (Rishal TL), U-06 (Marketing, masked), U-07 (Admin)
- **Condition:** Must receive both events in exact creation order `seq1 < seq2` without sequence collisions.

### Ten Traps

See the implementation-specific trap analysis in the architecture document. Key traps tested by the assessment:

1. Caching `role` on socket → reassignment/demotion invisible until reconnect
2. Authorization only at handshake → S3, S4 fail
3. Sending full payload to a room, masking in frontend → phone visible on wire
4. `max(seq)+1` without atomicity → S8 race condition
5. Replay with original-time entitlement → dispossessed users receive after disconnect
6. Marketing block only on socket path → REST bypass possible
7. Origin check on IP instead of Origin header → S6 fails
8. Disconnect only one socket on deactivation → S4 fails
9. Trusting JWT role → demotion invisible until token expires
10. `canSee(originalActor, lead)` in replay instead of `canSee(reconnectingUser, currentLead)`

### What I Did Not Finish

1. **Full live E2E coverage for S1 and S2 as independent Socket.IO scenarios**: While they are implicitly tested by the preconditions of S3 and S7, they don't have their own isolated live socket blocks in `integration.test.js`.
2. **OpenAPI/Swagger docs**: REST endpoints are documented in `README.md`, but there is no machine-readable spec.
3. **Redis-backed Socket Registry**: The current registry is a single-process in-memory `Map`. A multi-instance production deployment would require swapping this for a Redis-backed store to handle cross-node deactivations.
