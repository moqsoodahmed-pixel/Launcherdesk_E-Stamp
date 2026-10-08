"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTP = void 0;
const mongoose_1 = require("mongoose");
const otpSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: { type: String, enum: ["LOGIN", "PASSWORD_RESET"], required: true },
    codeHash: { type: String, required: true },
    challengeToken: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, required: true },
    consumedAt: { type: Date, default: null },
    lastSentAt: { type: Date, default: () => new Date() },
}, { timestamps: { createdAt: true, updatedAt: false } });
// TTL cleanup: purge OTP docs an hour after expiry
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
exports.OTP = (0, mongoose_1.model)("OTP", otpSchema);
