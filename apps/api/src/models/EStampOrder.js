"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EStampOrder = void 0;
const mongoose_1 = require("mongoose");
const shared_1 = require("@launcherdesk/shared");
// One vendor certificate upload. History is append-only: a re-upload marks
// the previous PENDING/REJECTED entry SUPERSEDED (its FileAsset is kept), so
// at most one entry is ever PENDING. Only an APPROVED entry ever becomes an
// EStampDocument (the one thing the client download path serves).
const vendorUploadSchema = new mongoose_1.Schema({
    fileAssetId: { type: mongoose_1.Schema.Types.ObjectId, ref: "FileAsset", required: true },
    stampReference: { type: String, required: true },
    notes: { type: String, maxlength: 1000 },
    uploadedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: () => new Date() },
    status: { type: String, enum: Object.values(shared_1.VendorUploadStatus), default: shared_1.VendorUploadStatus.PENDING },
    reviewNotes: { type: String, maxlength: 500 },
    reviewedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
});
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
    // Manual fulfilment (ESTAMP_FULFILMENT=manual): who stamped it and when.
    // providerReference holds the stamp reference typed in at fulfilment.
    fulfilledBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    startedAt: { type: Date },
    fulfilmentNotes: { type: String, maxlength: 1000 },
    failedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    // Document review and verification by admin / staff
    documentsVerified: { type: Boolean, default: false },
    verifiedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    verifiedAt: { type: Date },
    verificationNotes: { type: String, maxlength: 1000 },
    // Vendor stage (internal only - stripped from every client payload).
    vendorId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", index: true },
    vendorStatus: { type: String, enum: Object.values(shared_1.VendorStatus), default: shared_1.VendorStatus.NOT_SENT, index: true },
    dispatchedAt: { type: Date },
    dispatchedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    vendorAcceptedAt: { type: Date },
    // Set by POST /vendor/orders/:id/cannot-process (vendorStatus REJECTED);
    // cleared by the next dispatch.
    vendorDeclined: { type: Boolean, default: false },
    vendorDeclineReason: { type: String, maxlength: 500 },
    vendorUploads: { type: [vendorUploadSchema], default: [] },
}, { timestamps: true });
eStampOrderSchema.index({ organizationId: 1, status: 1 });
eStampOrderSchema.index({ organizationId: 1, createdAt: -1 });
// Supports Phase 9 order-management filters: state/processing-status
// filtering and Master Admin's global state-wise queries.
eStampOrderSchema.index({ organizationId: 1, eStampStatus: 1 });
eStampOrderSchema.index({ stateCode: 1, createdAt: -1 });
eStampOrderSchema.index({ vendorId: 1, vendorStatus: 1, updatedAt: 1 });
// Vendor fields never leave the API for a client role.
const VENDOR_FIELDS = ["vendorId", "vendorStatus", "dispatchedAt", "dispatchedBy", "vendorAcceptedAt", "vendorDeclined", "vendorDeclineReason", "vendorUploads"];
exports.VENDOR_FIELDS = VENDOR_FIELDS;
function stripVendorFields(plain) {
    if (!plain)
        return plain;
    const copy = typeof plain.toObject === "function" ? plain.toObject() : { ...plain };
    for (const key of VENDOR_FIELDS)
        delete copy[key];
    return copy;
}
exports.stripVendorFields = stripVendorFields;
exports.EStampOrder = (0, mongoose_1.model)("EStampOrder", eStampOrderSchema);
