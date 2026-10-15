"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextSequence = nextSequence;
const models_1 = require("../models");
// Atomically returns the next integer in the named sequence, starting at 1
// for a counter that has never been used (or was reset - see
// scripts/reset-live-database.js). findByIdAndUpdate's $inc is a single
// atomic database operation, so two concurrent callers can never be handed
// the same number - unlike a read-then-increment-then-write pattern, which
// would race.
async function nextSequence(name) {
    const counter = await models_1.Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { new: true, upsert: true });
    return counter.seq;
}
