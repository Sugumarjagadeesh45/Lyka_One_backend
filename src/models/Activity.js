'use strict';

const mongoose = require('mongoose');

/**
 * Activity model.
 *
 * `sequence` is a monotonically increasing integer used as the cursor
 * for ordered replay. It is NOT generated as "max+1" here — that is handled
 * by the Counter model to avoid race conditions on concurrent inserts.
 */
const activitySchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    sequence: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for ordering and replay queries
activitySchema.index({ leadId: 1, sequence: 1 });
activitySchema.index({ sequence: 1 });
activitySchema.index({ createdAt: 1 });

module.exports = mongoose.model('Activity', activitySchema);
