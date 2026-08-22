'use strict';

const mongoose = require('mongoose');

/**
 * Counter model — provides concurrency-safe monotonic sequence generation.
 *
 * WHY THIS EXISTS:
 * The naive approach of querying the max sequence and doing +1 is NOT safe
 * when two activity:create events arrive simultaneously (race condition — both
 * read the same max and produce duplicate sequences, breaking ordering).
 *
 * Using findOneAndUpdate with $inc on a single Counter document is an
 * atomic operation in MongoDB, guaranteeing unique, monotonically increasing
 * integers even under concurrent writes.
 *
 * This satisfies assessment requirement S8 (two events 50ms apart must arrive
 * in order with distinct sequence numbers).
 *
 * PRODUCTION NOTE: In a multi-replica deployment, a distributed counter
 * (e.g., Redis INCR) would be preferred. For single-instance assessment, this
 * MongoDB atomic approach is sufficient.
 */
const counterSchema = new mongoose.Schema({
  _id:     { type: String, required: true },   // e.g. "activity_sequence"
  seq:     { type: Number, default: 0 },
});

counterSchema.statics.nextSequence = async function (name) {
  const doc = await this.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
