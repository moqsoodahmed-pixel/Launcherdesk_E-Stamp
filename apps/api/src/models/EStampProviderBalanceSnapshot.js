"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EStampProviderBalanceSnapshot = void 0;
const mongoose_1 = require("mongoose");
// A point-in-time record of the EXTERNAL E-Stamp provider's own account
// balance - never the client organization's LauncherDesk wallet (see
// models/Wallet.js for that, a completely separate concept). Retained
// historically (append-only) so Master Admin can see balance over time and
// so the API never has to call the provider on every dashboard render - it
// serves the latest snapshot and lets an operator explicitly refresh.
const eStampProviderBalanceSnapshotSchema = new mongoose_1.Schema({
    provider: { type: String, required: true }, // the ESTAMP_PROVIDER value active when this snapshot was taken (e.g. "mock")
    status: {
        type: String,
        enum: ["AVAILABLE", "NOT_CONFIGURED", "UNAVAILABLE", "ERROR"],
        required: true,
    },
    // Only meaningful when status === "AVAILABLE". Deliberately NOT required/
    // defaulted to 0 - a missing value here must never be confused with a
    // real zero balance.
    available: { type: Number },
    currency: { type: String },
    unit: { type: String },
    source: { type: String, required: true }, // "mock" | "real" | "error" - never presented to the UI as ambiguous
    errorMessage: { type: String }, // safe, human-readable only - never a raw provider payload/credential
    fetchedAt: { type: Date, required: true },
    fetchedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });
eStampProviderBalanceSnapshotSchema.index({ fetchedAt: -1 });
exports.EStampProviderBalanceSnapshot = (0, mongoose_1.model)("EStampProviderBalanceSnapshot", eStampProviderBalanceSnapshotSchema);
