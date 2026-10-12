"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Payment = void 0;
const mongoose_1 = require("mongoose");
const shared_1 = require("@launcherdesk/shared");
const paymentSchema = new mongoose_1.Schema({
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, index: true },
    razorpaySignature: { type: String, select: false },
    status: { type: String, enum: Object.values(shared_1.PaymentStatus), default: shared_1.PaymentStatus.CREATED, index: true },
    verifiedAt: { type: Date },
    // Non-sensitive, human-readable reason only (e.g. "signature mismatch") -
    // never a raw provider error payload that might carry sensitive detail.
    failureReason: { type: String },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    plan: { type: String, default: "Wallet Top-up & E-Stamping Balance" },
    stampsCount: { type: Number, default: 0 },
    // Set only when the order was created from a catalog EstampPackage
    // (never from arbitrary client input) - lets the frontend derive real
    // subscription validity/expiry instead of guessing from the plan string.
    packageKey: { type: String, default: null },
    invoiceNumber: { type: String },
    // Ledger flow: a verified Razorpay payment does NOT credit the wallet.
    // It waits as PENDING_CREDIT until the assigned Assistant Master Admin
    // (or a Master Admin) credits it. Deliberately no schema default: a
    // legacy SUCCESS payment without this field was already auto-credited
    // and must read as credited, never as pending (see
    // scripts/migrate-balance-ledger.js).
    balanceStatus: { type: String, enum: ["PENDING_CREDIT", "CREDITED"] },
    creditedAt: { type: Date },
    creditedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    walletTransactionId: { type: mongoose_1.Schema.Types.ObjectId, ref: "WalletTransaction" },
}, { timestamps: true });
paymentSchema.index({ organizationId: 1, createdAt: -1 });
paymentSchema.index({ organizationId: 1, status: 1 });
paymentSchema.index({ balanceStatus: 1, organizationId: 1 });
exports.Payment = (0, mongoose_1.model)("Payment", paymentSchema);
