"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EStampOrder = void 0;
const mongoose_1 = require("mongoose");
const shared_1 = require("@launcherdesk/shared");
const eStampOrderSchema = new mongoose_1.Schema({
    orderNumber: { type: String, required: true, unique: true },
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    requestId: { type: mongoose_1.Schema.Types.ObjectId, ref: "EStampRequest", required: true, unique: true },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    stateCode: { type: String, required: true },
    articleId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Article", required: true },
    amount: { type: Number, required: true },
    paymentStatus: { type: String, enum: ["PENDING", "PAID", "FAILED"], default: "PENDING" },
    // The order's own provider-processing lifecycle (see shared
    // EStampOrderProcessingStatus) - kept as a plain String, not a hard
    // mongoose enum, to avoid a destructive type change; the application
    // layer (estamp-request.service.js's canTransitionOrder) is what
    // actually enforces the controlled vocabulary/valid transitions.
    eStampStatus: { type: String, required: true },
    status: { type: String, enum: Object.values(shared_1.OrderStatus), default: shared_1.OrderStatus.ONGOING, index: true },
    processingStatus: { type: String },
    downloadStatus: { type: String, enum: ["NOT_AVAILABLE", "AVAILABLE", "DOWNLOADED"], default: "NOT_AVAILABLE" },
    // Provider processing metadata - populated only by processOrder/
    // syncEStampOrderStatus, never by client input.
    providerReference: { type: String, index: true },
    providerRawStatus: { type: String },
    failureReason: { type: String },
    submittedAt: { type: Date },
    issuedAt: { type: Date },
    lastSyncedAt: { type: Date },
    retryCount: { type: Number, default: 0 },
}, { timestamps: true });
eStampOrderSchema.index({ organizationId: 1, status: 1 });
eStampOrderSchema.index({ organizationId: 1, createdAt: -1 });
// Supports Phase 9 order-management filters: state/processing-status
// filtering and Master Admin's global state-wise queries.
eStampOrderSchema.index({ organizationId: 1, eStampStatus: 1 });
eStampOrderSchema.index({ stateCode: 1, createdAt: -1 });
exports.EStampOrder = (0, mongoose_1.model)("EStampOrder", eStampOrderSchema);
