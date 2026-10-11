"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletTransaction = exports.Wallet = void 0;
const mongoose_1 = require("mongoose");
const shared_1 = require("@launcherdesk/shared");
const walletSchema = new mongoose_1.Schema({
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true, unique: true, index: true },
    balance: { type: Number, required: true, default: 0, min: 0 },
    // Sum of amounts held for requests still in their modification window.
    // Available to spend = balance - reservedBalance. Only ever changed by
    // the atomic conditional updates in wallet.service.js.
    reservedBalance: { type: Number, default: 0, min: 0 },
    // Ids of the most recent ledger entries applied to this balance - the
    // guard that makes each entry move the balance at most once, even when
    // an interrupted write is retried (see wallet.service applyLedgerEntry).
    appliedTxIds: { type: [mongoose_1.Schema.Types.ObjectId], default: undefined, select: false },
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
        enum: ["PAYMENT", "ESTAMP_REQUEST", "ESTAMP_REQUEST_REVERSAL", "MANUAL_ADJUSTMENT", "REFUND"],
        required: true,
    },
    referenceId: { type: mongoose_1.Schema.Types.ObjectId },
    idempotencyKey: { type: String, required: true, unique: true },
    description: { type: String },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
    // true only between "ledger entry inserted" and "wallet updated"; such
    // entries are hidden from the ledger and flagged by reconcileWallets().
    pending: { type: Boolean },
}, { timestamps: { createdAt: true, updatedAt: false } });
walletTransactionSchema.index({ organizationId: 1, createdAt: -1 });
exports.WalletTransaction = (0, mongoose_1.model)("WalletTransaction", walletTransactionSchema);
