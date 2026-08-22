'use strict';

const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema(
  {
    // Stable human-readable identifier (LD-01 ... LD-03)
    leadCode: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
leadSchema.index({ leadCode: 1 }, { unique: true });
leadSchema.index({ ownerId: 1 });

module.exports = mongoose.model('Lead', leadSchema);
