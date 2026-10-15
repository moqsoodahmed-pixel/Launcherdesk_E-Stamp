"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Counter = void 0;
const mongoose_1 = require("mongoose");
// Backs every sequential, human-facing reference number this app generates
// (invoice/order/request/batch numbers) - one document per counter name,
// atomically incremented via findByIdAndUpdate's $inc (never read-then-write,
// which would race under concurrent requests). A fresh/reset database with
// no Counter documents starts every sequence at 1, exactly once per name.
const counterSchema = new mongoose_1.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
}, { timestamps: true });
exports.Counter = (0, mongoose_1.model)("Counter", counterSchema);
