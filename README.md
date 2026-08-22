# Lyka One — Party Line: Backend

Real-time activity feed backend for a real-estate CRM with **authorization evaluated at the moment of event delivery** — not at socket connect time.

## Architecture Overview

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
                         └── marketingWriteBlock()
                                │
                          Per-Recipient Serializer
                                │
                           MongoDB (Mongoose)
                           (User, Lead, Activity, Counter)
```

## Core Security Principle

> **Authorization is a property of the moment an event is delivered — not the moment the socket connection was opened.**

A user's role, team, or lead ownership can change while their socket remains connected. Therefore:

- **Socket handshake**: verifies JWT identity and current `isActive` + origin only.
- **Every event delivery**: fetches current user/lead state from DB, evaluates `canSee()`.
- Reassignment, role changes, and deactivation take effect on the **next event**.

## R1 vs R7 Design Decision

The assessment intentionally creates a contradiction:
- **R1**: Use live/current state at delivery time.
- **R7**: (implied) cache permissions at connect time for efficiency.

**Resolution**: We cache ONLY `userId` on the socket (it never changes). Role, team, isActive, and lead ownership are **always fetched fresh from DB** on event delivery. This satisfies R1 completely without breaking reassignment or revocation.

## Tech Stack

| Component | Library |
|---|---|
| HTTP Server | Node.js + Express |
| Real-time | Socket.IO |
| Database | MongoDB + Mongoose |
| Auth | JWT (jsonwebtoken) |
| Passwords | bcryptjs (bcrypt, 12 rounds) |
| Validation | Zod |
| Security | Helmet, CORS, express-rate-limit |
| Config | dotenv |

## Installation

```bash
cd Backend
npm install
```

## Environment Setup

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret key (min 16 chars) |
| `JWT_EXPIRES_IN` | Token expiry (e.g., `1h`) |
| `PORT` | Server port (default 5000) |
| `CRM_ORIGIN` | Allowed origin for CRM users |
| `MARKETING_ORIGIN` | Allowed origin for Marketing user |

## Seed Database

Creates the 7 exact assessment users and 3 leads. **Safe to run multiple times** (idempotent):

```bash
npm run seed
```

### Demo Credentials

| UserCode | Name | Email | Password | Role | Team |
|---|---|---|---|---|---|
| U-01 | Ravi Kumar | ravi@lykaone.com | Ravi@1234 | agent | Sathya |
| U-02 | Priya Menon | priya@lykaone.com | Priya@1234 | agent | Sathya |
| U-03 | Bikash Thapa | bikash@lykaone.com | Bikash@1234 | agent | Rishal |
| U-04 | Sathya K | sathya@lykaone.com | Sathya@1234 | team_lead | Sathya |
| U-05 | Rishal S | rishal@lykaone.com | Rishal@1234 | team_lead | Rishal |
| U-06 | Marketing | marketing@lykaone.com | Marketing@1234 | marketing | — |
| U-07 | Vignesh | vignesh@lykaone.com | Vignesh@1234 | admin | — |

## Run Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

## API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | ❌ | Login, returns JWT |
| GET | `/api/state` | ✅ Any | Ground-truth state for testing |
| GET | `/api/users` | ✅ Any | List all users |
| PATCH | `/api/users/:id/role` | ✅ Admin | Change user role |
| PATCH | `/api/users/:id/deactivate` | ✅ Admin | Deactivate + disconnect sockets |
| GET | `/api/leads` | ✅ Any | Get accessible leads (filtered) |
| PATCH | `/api/leads/:id/reassign` | ✅ Admin | Reassign lead owner |
| GET | `/api/leads/:id/activities` | ✅ Any | Get lead activities |
| POST | `/api/leads/:id/activities` | ✅ Non-marketing | Create activity |
| GET | `/health` | ❌ | Health check |

## Socket.IO Events

### Client → Server
| Event | Payload | Description |
|---|---|---|
| `activity:create` | `{ leadId, type, message }` | Create activity |

Pass `lastCursor` in `socket.auth` on reconnect for replay.

### Server → Client
| Event | Description |
|---|---|
| `activity:new` | New activity (per-recipient serialized) |
| `lead:reassigned` | Lead ownership changed |
| `user:roleChanged` | Role changed |
| `user:deactivated` | Account deactivated |
| `activity:replay` | Missed events on reconnect |
| `error` | Error event |

## Authorization Rules

| Role | Can See | Can Emit |
|---|---|---|
| agent | Only their own leads | Only their own leads |
| team_lead | All leads on their current team | All leads on their current team |
| marketing | All leads (masked phone) | **Never** |
| admin | Everything | Everything |

## Phone Masking (Server-side)

Marketing receives a masked phone number. Masking happens **before `socket.emit()`** — the full number never travels over the wire to marketing.

```
Original:  +971501112222
Marketing: +971********22
```

> **Format**: country code prefix (+971) + exactly **8 asterisks** (fixed count, prevents length leakage) + last **2 digits** of the full number.

## Origin Simulation (Development Testing)

To test the Marketing origin lock, run the marketing client from `http://localhost:3001`. A valid Marketing JWT presented from `http://localhost:3000` (CRM origin) will be **rejected at the Socket.IO handshake**.

## Run Automated Tests (S1-S8 Matrix)

```bash
npm test
```

Tests all 8 assessment scenarios:

| Scenario | Description |
|---|---|
| S1 | Agent creates activity on own lead — correct recipients receive |
| S2 | LD-01 reassigned U-01 → U-03 |
| S3 | Post-reassignment access — old owner/TL blocked, new owner/TL allowed |
| S4 | U-02 connected on two devices — deactivation disconnects BOTH sockets immediately |
| S5 | Marketing emit attempt rejected by centralized write-block |
| S6 | Marketing valid token from CRM origin — Socket.IO handshake rejected |
| S7 | Cursor-based replay on reconnect — only entitled missed events, in order, once each |
| S8 | Two concurrent events 50ms apart maintain correct sequence order |

## Security Features

- ✅ bcrypt (12 rounds) — no plain passwords in DB
- ✅ Minimal JWT (sub only) — no role/team in token
- ✅ Live DB state for all authorization decisions
- ✅ Marketing write-block (centralized)
- ✅ Server-side phone masking
- ✅ Origin validation at Socket.IO handshake
- ✅ Multi-device deactivation (Socket Registry)
- ✅ Atomic sequence counter (no race conditions)
- ✅ Helmet + CORS + Rate limiting
- ✅ Zod input validation
- ✅ `passwordHash` excluded from all API responses

## Known Assumptions

- Single-instance deployment: Socket Registry is in-process memory.  
  For multi-instance, Redis-based shared state is required.
- Sequence counter uses MongoDB `findOneAndUpdate($inc)` — atomic and race-safe for single-instance.
- Marketing origin checking uses the HTTP `Origin` header from the Socket.IO handshake.

## Demo Recording Guide

This guide is for the 4-minute demonstration screencast required by the assessment.

**0:00–0:25: Overview**
Briefly show the application, the seeded users (from `/api/state` or UI), and the initial state.

**0:25–0:55: Control Panel**
Show the Admin Control Panel. Briefly explain its capability to manipulate live state without touching the DB directly.

**0:55–1:30: Initial State**
Show initial `LD-01` access across relevant connected accounts (U-01, U-04, U-06, U-07).

**1:30–2:20: Reassignment (S2/S3 Leak Test)**
Perform cross-team reassignment of `LD-01` from `U-01` to `U-03`.

**2:20–3:00: Immediate Revocation**
Emit activity immediately after reassignment and show:
- New owner (`U-03`) receives
- New team lead (`U-05`) receives
- Old owner (`U-01`) does NOT receive
- Old team lead (`U-04`) does NOT receive
- Marketing (`U-06`) receives masked data
- Admin (`U-07`) receives permitted full data

**3:00–3:30: Refusals**
Briefly demonstrate marketing write refusal and/or origin restriction if practical.

**3:30–4:00: Conclusion**
Show the test suite results (`npm test` passing) and conclude.
