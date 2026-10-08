"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EStampRequest = void 0;
const mongoose_1 = require("mongoose");
const shared_1 = require("@launcherdesk/shared");
const eStampRequestSchema = new mongoose_1.Schema({
    requestNumber: { type: String, required: true, unique: true },
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    stateCode: { type: String, required: true, uppercase: true },
    articleId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Article", required: true },
    articleVersionUsed: { type: Number, required: true },
    firstParty: { type: String, required: true, trim: true, maxlength: 300 },
    secondParty: { type: String, required: true, trim: true, maxlength: 300 },
    descriptionOfDocument: { type: String, required: true, trim: true, maxlength: 1000 },
    propertyDescription: { type: String, trim: true, maxlength: 2000 },
    considerationPrice: { type: Number, required: true, min: 0 },
    stampDutyPaidBy: { type: String, required: true, trim: true },
    numberOfEStamps: { type: Number, required: true, min: 1, max: 100, default: 1 },
    extraFields: { type: mongoose_1.Schema.Types.Mixed },
    calculatedStampDuty: { type: Number, required: true, min: 0 },
    status: {
        type: String,
        enum: Object.values(shared_1.EStampRequestStatus),
        default: shared_1.EStampRequestStatus.DRAFT,
        index: true,
    },
    modificationDeadline: { type: Date, required: true },
    lockedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelReason: { type: String },
    paymentId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Payment" },
    orderId: { type: mongoose_1.Schema.Types.ObjectId, ref: "EStampOrder" },
    // Client-generated, one-per-form-submission key. Lets createRequest
    // detect an accidental double-submit (e.g. double-click, retried
    // network request) and return the ALREADY-created request instead of
    // charging the wallet a second time. Optional/sparse so existing
    // records and any caller that omits it are unaffected.
    idempotencyKey: { type: String },
}, { timestamps: true });
eStampRequestSchema.index({ organizationId: 1, createdAt: -1 });
eStampRequestSchema.index({ organizationId: 1, status: 1 });
eStampRequestSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
// Phase 12 hardening: lockExpiredRequests() now runs a global (no
// organizationId filter) atomic query keyed on exactly {status,
// modificationDeadline} on every invocation - without this index that's a
// full collection scan as the table grows.
eStampRequestSchema.index({ status: 1, modificationDeadline: 1 });
exports.EStampRequest = (0, mongoose_1.model)("EStampRequest", eStampRequestSchema);
