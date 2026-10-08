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
}, { timestamps: true });
paymentSchema.index({ organizationId: 1, createdAt: -1 });
paymentSchema.index({ organizationId: 1, status: 1 });
exports.Payment = (0, mongoose_1.model)("Payment", paymentSchema);
