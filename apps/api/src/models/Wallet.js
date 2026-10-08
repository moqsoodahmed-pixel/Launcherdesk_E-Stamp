"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletTransaction = exports.Wallet = void 0;
const mongoose_1 = require("mongoose");
const shared_1 = require("@launcherdesk/shared");
const walletSchema = new mongoose_1.Schema({
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true, unique: true, index: true },
    balance: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, default: "INR" },
    version: { type: Number, default: 0 },
}, { timestamps: true });
exports.Wallet = (0, mongoose_1.model)("Wallet", walletSchema);
const walletTransactionSchema = new mongoose_1.Schema({
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    type: { type: String, enum: Object.values(shared_1.WalletTransactionType), required: true },
    amount: { type: Number, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    referenceType: {
        type: String,
        enum: ["PAYMENT", "ESTAMP_REQUEST", "MANUAL_ADJUSTMENT", "REFUND"],
        required: true,
    },
    referenceId: { type: mongoose_1.Schema.Types.ObjectId },
    idempotencyKey: { type: String, required: true, unique: true },
    description: { type: String },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });
walletTransactionSchema.index({ organizationId: 1, createdAt: -1 });
exports.WalletTransaction = (0, mongoose_1.model)("WalletTransaction", walletTransactionSchema);
