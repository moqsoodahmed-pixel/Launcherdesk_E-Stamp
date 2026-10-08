"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BulkEStampBatch = void 0;
const mongoose_1 = require("mongoose");
const shared_1 = require("@launcherdesk/shared");
// Phase 11 - one document per bulk CSV/XLSX upload. Individual row state
// lives on BulkEStampBatchItem, never inline here (up to
// BULK_ESTAMP_MAX_ROWS rows per batch would make this document unbounded).
const bulkEStampBatchSchema = new mongoose_1.Schema({
    batchNumber: { type: String, required: true, unique: true },
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    fileName: { type: String, required: true },
    fileType: { type: String, enum: ["CSV", "XLSX"], required: true },
    status: {
        type: String,
        enum: Object.values(shared_1.BulkBatchStatus),
        default: shared_1.BulkBatchStatus.UPLOADED,
        index: true,
    },
    totalRows: { type: Number, default: 0 },
    validRows: { type: Number, default: 0 },
    invalidRows: { type: Number, default: 0 },
    // Populated only as confirmBatch actually creates EStampRequests / marks
    // rows FAILED - never guessed ahead of time.
    createdRequests: { type: Number, default: 0 },
    failedRows: { type: Number, default: 0 },
    // Sum of calculatedAmount across valid/created rows - informational
    // (the actual charge is always the per-row debit inside
    // EStampRequestService.createRequest, never this aggregate).
    totalStampDuty: { type: Number, default: 0 },
    // Structural failure reason only (bad file, bad headers, row count
    // exceeded) - never set merely because some/all rows failed row-level
    // validation, that is a normal PREVIEW_READY outcome.
    errorSummary: { type: String },
}, { timestamps: true });
bulkEStampBatchSchema.index({ organizationId: 1, createdAt: -1 });
bulkEStampBatchSchema.index({ organizationId: 1, status: 1 });
exports.BulkEStampBatch = (0, mongoose_1.model)("BulkEStampBatch", bulkEStampBatchSchema);
