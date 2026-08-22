'use strict';

const mongoose = require('mongoose');
const { ROLES, ORIGINS } = require('../utils/constants');

const userSchema = new mongoose.Schema(
  {
    // Stable human-readable identifier (U-01 ... U-07)
    userCode: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      // NEVER returned in API responses (see transform below)
    },
    role: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
    },
    team: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    origin: {
      type: String,
      enum: Object.values(ORIGINS),
      default: ORIGINS.CRM,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        // Safety guarantee: passwordHash never leaks in JSON responses
        delete ret.passwordHash;
        return ret;
      },
    },
  }
);

// Indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ userCode: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ team: 1 });

module.exports = mongoose.model('User', userSchema);
