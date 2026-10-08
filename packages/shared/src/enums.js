"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditAction = exports.NotificationType = exports.OrganizationStatus = exports.PaymentStatus = exports.WalletTransactionType = exports.OrderStatus = exports.EStampRequestStatus = exports.BulkBatchStatus = void 0;
var EStampRequestStatus;
(function (EStampRequestStatus) {
    EStampRequestStatus["DRAFT"] = "DRAFT";
    EStampRequestStatus["PAYMENT_PENDING"] = "PAYMENT_PENDING";
    EStampRequestStatus["PAYMENT_SUCCESS"] = "PAYMENT_SUCCESS";
    EStampRequestStatus["REQUEST_CREATED"] = "REQUEST_CREATED";
    EStampRequestStatus["MODIFICATION_WINDOW"] = "MODIFICATION_WINDOW";
    EStampRequestStatus["LOCKED"] = "LOCKED";
    EStampRequestStatus["PROCESSING"] = "PROCESSING";
    EStampRequestStatus["COMPLETED"] = "COMPLETED";
    EStampRequestStatus["DOWNLOAD_AVAILABLE"] = "DOWNLOAD_AVAILABLE";
    EStampRequestStatus["CANCELLED"] = "CANCELLED";
    EStampRequestStatus["FAILED"] = "FAILED";
})(EStampRequestStatus || (exports.EStampRequestStatus = EStampRequestStatus = {}));
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["ONGOING"] = "ONGOING";
    OrderStatus["COMPLETED"] = "COMPLETED";
    OrderStatus["CANCELLED"] = "CANCELLED";
    OrderStatus["FAILED"] = "FAILED";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
// The ORDER's own provider-processing lifecycle - finer-grained than
// OrderStatus (which stays the coarse ONGOING/COMPLETED/CANCELLED/FAILED
// customer-facing status). Stored in EStampOrder.eStampStatus, which was
// already a plain String field - this enum is the controlled vocabulary the
// application layer enforces on it, without a destructive schema/migration
// change to that field's type.
var EStampOrderProcessingStatus;
(function (EStampOrderProcessingStatus) {
    EStampOrderProcessingStatus["CREATED"] = "CREATED";
    EStampOrderProcessingStatus["SUBMITTING"] = "SUBMITTING";
    EStampOrderProcessingStatus["SUBMITTED"] = "SUBMITTED";
    EStampOrderProcessingStatus["PROCESSING"] = "PROCESSING";
    EStampOrderProcessingStatus["ISSUED"] = "ISSUED";
    EStampOrderProcessingStatus["FAILED"] = "FAILED";
})(EStampOrderProcessingStatus || (exports.EStampOrderProcessingStatus = EStampOrderProcessingStatus = {}));
// Bulk E-Stamp batch lifecycle (Phase 11). UPLOADED/VALIDATING are
// transient (the upload request itself moves a batch through both before
// responding); PREVIEW_READY is the steady state a user reviews before
// confirming. FAILED here means a STRUCTURAL failure (bad file, bad
// headers, row-count exceeded) - never "some rows were invalid", which is
// a legitimate PREVIEW_READY outcome. PARTIALLY_FAILED/COMPLETED/FAILED
// (post-confirm) are terminal, decided from the per-row outcome counts
// once the confirm loop finishes; CANCELLED is only reachable pre-confirm.
var BulkBatchStatus;
(function (BulkBatchStatus) {
    BulkBatchStatus["UPLOADED"] = "UPLOADED";
    BulkBatchStatus["VALIDATING"] = "VALIDATING";
    BulkBatchStatus["PREVIEW_READY"] = "PREVIEW_READY";
    BulkBatchStatus["CONFIRMED"] = "CONFIRMED";
    BulkBatchStatus["PROCESSING"] = "PROCESSING";
    BulkBatchStatus["COMPLETED"] = "COMPLETED";
    BulkBatchStatus["PARTIALLY_FAILED"] = "PARTIALLY_FAILED";
    BulkBatchStatus["FAILED"] = "FAILED";
    BulkBatchStatus["CANCELLED"] = "CANCELLED";
})(BulkBatchStatus || (exports.BulkBatchStatus = BulkBatchStatus = {}));
var WalletTransactionType;
(function (WalletTransactionType) {
    WalletTransactionType["CREDIT"] = "CREDIT";
    WalletTransactionType["DEBIT"] = "DEBIT";
    WalletTransactionType["REFUND"] = "REFUND";
    WalletTransactionType["ADJUSTMENT"] = "ADJUSTMENT";
})(WalletTransactionType || (exports.WalletTransactionType = WalletTransactionType = {}));
var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["CREATED"] = "CREATED";
    PaymentStatus["SUCCESS"] = "SUCCESS";
    PaymentStatus["FAILED"] = "FAILED";
    PaymentStatus["REFUNDED"] = "REFUNDED";
})(PaymentStatus || (exports.PaymentStatus = PaymentStatus = {}));
var OrganizationStatus;
(function (OrganizationStatus) {
    OrganizationStatus["PENDING_APPROVAL"] = "PENDING_APPROVAL";
    OrganizationStatus["ACTIVE"] = "ACTIVE";
    OrganizationStatus["RESTRICTED"] = "RESTRICTED";
    OrganizationStatus["SUSPENDED"] = "SUSPENDED";
    OrganizationStatus["DEACTIVATED"] = "DEACTIVATED";
})(OrganizationStatus || (exports.OrganizationStatus = OrganizationStatus = {}));
var NotificationType;
(function (NotificationType) {
    NotificationType["ASSISTANT_ADMIN_ACTIVITY"] = "ASSISTANT_ADMIN_ACTIVITY";
    NotificationType["SECURITY_ALERT"] = "SECURITY_ALERT";
    NotificationType["ESTAMP_STATUS"] = "ESTAMP_STATUS";
    NotificationType["PAYMENT"] = "PAYMENT";
    NotificationType["GENERAL"] = "GENERAL";
})(NotificationType || (exports.NotificationType = NotificationType = {}));
var AuditAction;
(function (AuditAction) {
    AuditAction["LOGIN"] = "LOGIN";
    AuditAction["LOGOUT"] = "LOGOUT";
    AuditAction["LOGIN_FAILED"] = "LOGIN_FAILED";
    AuditAction["OTP_SENT"] = "OTP_SENT";
    AuditAction["OTP_VERIFIED"] = "OTP_VERIFIED";
    AuditAction["OTP_FAILED"] = "OTP_FAILED";
    AuditAction["PASSWORD_RESET_REQUESTED"] = "PASSWORD_RESET_REQUESTED";
    AuditAction["PASSWORD_RESET_COMPLETED"] = "PASSWORD_RESET_COMPLETED";
    AuditAction["USER_CREATED"] = "USER_CREATED";
    AuditAction["USER_MODIFIED"] = "USER_MODIFIED";
    AuditAction["USER_DEACTIVATED"] = "USER_DEACTIVATED";
    AuditAction["ORG_CREATED"] = "ORG_CREATED";
    AuditAction["ORG_VIEWED"] = "ORG_VIEWED";
    AuditAction["ORG_MODIFIED"] = "ORG_MODIFIED";
    AuditAction["ORG_STATUS_CHANGED"] = "ORG_STATUS_CHANGED";
    AuditAction["BALANCE_VIEWED"] = "BALANCE_VIEWED";
    AuditAction["BALANCE_CHANGED"] = "BALANCE_CHANGED";
    AuditAction["PAYMENT_VIEWED"] = "PAYMENT_VIEWED";
    AuditAction["PAYMENT_VERIFIED"] = "PAYMENT_VERIFIED";
    AuditAction["ESTAMP_REQUEST_CREATED"] = "ESTAMP_REQUEST_CREATED";
    AuditAction["ESTAMP_REQUEST_MODIFIED"] = "ESTAMP_REQUEST_MODIFIED";
    AuditAction["ESTAMP_REQUEST_CANCELLED"] = "ESTAMP_REQUEST_CANCELLED";
    AuditAction["ESTAMP_UPLOADED"] = "ESTAMP_UPLOADED";
    AuditAction["ESTAMP_DOWNLOADED"] = "ESTAMP_DOWNLOADED";
    AuditAction["ARTICLE_MANAGED"] = "ARTICLE_MANAGED";
    AuditAction["ARTICLE_ACCESSED"] = "ARTICLE_ACCESSED";
    AuditAction["ORDER_MODIFIED"] = "ORDER_MODIFIED";
    AuditAction["ORDER_VIEWED"] = "ORDER_VIEWED";
    AuditAction["ESTAMP_ISSUED"] = "ESTAMP_ISSUED";
    AuditAction["ESTAMP_PROCESSING_FAILED"] = "ESTAMP_PROCESSING_FAILED";
    AuditAction["PERMISSION_CHANGED"] = "PERMISSION_CHANGED";
    AuditAction["SETTINGS_CHANGED"] = "SETTINGS_CHANGED";
    AuditAction["ESTAMP_PROVIDER_BALANCE_VIEWED"] = "ESTAMP_PROVIDER_BALANCE_VIEWED";
    AuditAction["ESTAMP_PROVIDER_BALANCE_REFRESHED"] = "ESTAMP_PROVIDER_BALANCE_REFRESHED";
    AuditAction["ESTAMP_PROVIDER_USAGE_VIEWED"] = "ESTAMP_PROVIDER_USAGE_VIEWED";
    // Phase 11 - Bulk E-Stamp Request Management. Metadata for these must
    // only ever contain counts/ids/batchNumber - never the uploaded file's
    // raw contents or full parsed rows.
    AuditAction["BULK_BATCH_UPLOADED"] = "BULK_BATCH_UPLOADED";
    AuditAction["BULK_BATCH_VALIDATED"] = "BULK_BATCH_VALIDATED";
    AuditAction["BULK_BATCH_CONFIRMED"] = "BULK_BATCH_CONFIRMED";
    AuditAction["BULK_BATCH_COMPLETED"] = "BULK_BATCH_COMPLETED";
    AuditAction["BULK_BATCH_FAILED"] = "BULK_BATCH_FAILED";
    AuditAction["BULK_BATCH_CANCELLED"] = "BULK_BATCH_CANCELLED";
    // Phase 15 - the lockExpiredRequests cron transitions a request out of
    // MODIFICATION_WINDOW into LOCKED; this is a real lifecycle mutation and
    // is now audited per-request (system-attributed: actorId null,
    // actorType SYSTEM), matching how every other lifecycle transition in
    // this codebase is audited.
    AuditAction["ESTAMP_REQUEST_LOCKED"] = "ESTAMP_REQUEST_LOCKED";
    // Phase 16 - Terms/Privacy/Refund policy versioning. Metadata for these
    // must only ever contain {type, version} (or similarly safe identifiers)
    // - never the policy `content` itself (see policy.service.js).
    AuditAction["POLICY_CREATED"] = "POLICY_CREATED";
    AuditAction["POLICY_PUBLISHED"] = "POLICY_PUBLISHED";
    AuditAction["POLICY_ACKNOWLEDGED"] = "POLICY_ACKNOWLEDGED";
})(AuditAction || (exports.AuditAction = AuditAction = {}));