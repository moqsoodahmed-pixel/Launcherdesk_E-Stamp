"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BulkEStampBatchItem = void 0;
const mongoose_1 = require("mongoose");
// Phase 11 - one document per spreadsheet row of a BulkEStampBatch.
// rowNumber is 1-based and matches the original spreadsheet row (accounting
// for the header row), preserved through validate -> preview -> confirm so
// every user-facing error can always point back at the exact row the user
// authored.
const bulkEStampBatchItemSchema = new mongoose_1.Schema({
    batchId: { type: mongoose_1.Schema.Types.ObjectId, ref: "BulkEStampBatch", required: true, index: true },
    // Duplicated from the parent batch (rather than always populate()-ing)
    // so tenant-scoped queries can filter directly on this collection.
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    rowNumber: { type: Number, required: true },
    status: {
        type: String,
        enum: ["PENDING", "VALID", "INVALID", "CREATED", "FAILED"],
        default: "PENDING",
    },
    // Only the whitelisted createEStampRequestSchema-shaped fields as
    // originally submitted - never arbitrary extra spreadsheet columns.
    inputData: { type: mongoose_1.Schema.Types.Mixed },
    validationErrors: { type: [String], default: [] },
    calculatedAmount: { type: Number },
    articleVersionUsed: { type: Number },
    requestId: { type: mongoose_1.Schema.Types.ObjectId, ref: "EStampRequest" },
    orderId: { type: mongoose_1.Schema.Types.ObjectId, ref: "EStampOrder" },
    // Deterministic `bulk:<batchId>:row:<rowNumber>` - identical to what is
    // passed as EStampRequestService.createRequest's idempotencyKey, so a
    // resulting EStampRequest can always be found by this same value.
    idempotencyKey: { type: String },
    failureReason: { type: String },
    // Flagged only - never auto-rejected or merged. A duplicate suspicion is
    // informational; the row still proceeds through preview/confirm.
    isDuplicateSuspect: { type: Boolean, default: false },
}, { timestamps: true });
bulkEStampBatchItemSchema.index({ batchId: 1, rowNumber: 1 }, { unique: true });
bulkEStampBatchItemSchema.index({ batchId: 1, status: 1 });
// Belt-and-suspenders alongside EStampRequest's own
// {organizationId,idempotencyKey} unique-sparse index.
bulkEStampBatchItemSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
exports.BulkEStampBatchItem = (0, mongoose_1.model)("BulkEStampBatchItem", bulkEStampBatchItemSchema);
