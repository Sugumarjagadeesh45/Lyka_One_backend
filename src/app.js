'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');

const env    = require('./config/env');
const logger = require('./utils/logger');
const errorMiddleware = require('./middlewares/error.middleware');
const { apiRateLimiter }  = require('./middlewares/rateLimit.middleware');

// Routes
const authRoutes     = require('./routes/auth.routes');
const userRoutes     = require('./routes/user.routes');
const leadRoutes     = require('./routes/lead.routes');
const activityRoutes = require('./routes/activity.routes');

// State endpoint (debug/assessment test helper)
const { authMiddleware, adminOnly } = require('./middlewares/auth.middleware');
const User = require('./models/User');
const Lead = require('./models/Lead');

const app = express();

// ─────────── Security Headers ───────────
app.use(helmet());

// ─────────── CORS ───────────
app.use(cors({
  origin: [env.CRM_ORIGIN, env.MARKETING_ORIGIN],
  credentials: true,
}));

// ─────────── Body Parsing ───────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ─────────── Global Rate Limiter ───────────
app.use('/api', apiRateLimiter);

// ─────────── Health ───────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: env.NODE_ENV });
});

// ─────────── REST API Routes ───────────
app.use('/api/auth',                 authRoutes);
app.use('/api/users',                userRoutes);
app.use('/api/leads',                leadRoutes);
app.use('/api/leads/:id/activities', activityRoutes);

// ─────────── GET /api/state (Assessment debug endpoint) ───────────
// Returns ground-truth state for evaluating S1–S8 scenarios.
// Never exposes passwordHash.
app.get('/api/state', authMiddleware, async (req, res, next) => {
  try {
    const users = await User.find().select('-passwordHash').lean();
    const leads = await Lead.find().populate('ownerId', 'userCode name role team').lean();

    res.json({
      success: true,
      state: {
        users: users.map(u => ({
          id:       String(u._id),
          userCode: u.userCode,
          name:     u.name,
          email:    u.email,
          role:     u.role,
          team:     u.team,
          isActive: u.isActive,
          origin:   u.origin,
        })),
        leads: leads.map(l => ({
          id:        String(l._id),
          leadCode:  l.leadCode,
          name:      l.name,
          phone:     l.phone,
          ownerId:   String(l.ownerId._id || l.ownerId),
          ownerCode: l.ownerId?.userCode || null,
          ownerName: l.ownerId?.name || null,
          ownerTeam: l.ownerId?.team || null,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────── 404 ───────────
app.use((req, res) => {
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Route not found' });
});

// ─────────── Central Error Handler ───────────
app.use(errorMiddleware);

module.exports = app;
