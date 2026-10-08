"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadEStamp = exports.uploadFile = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const file_service_1 = require("../services/file.service");
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const audit_service_1 = require("../services/audit.service");
const notification_service_1 = require("../services/notification.service");
const models_2 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const sanitizeFilename_1 = require("../utils/sanitizeFilename");
// Internal roles (Master/Assistant Master Admin) always have organizationId
// === null on their OWN account - they act ON BEHALF OF a client org, so the
// target org must come from the request, never from their own record.
function resolveUploadOrgId(req) {
    const isInternal = req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
    if (isInternal) {
        const organizationId = req.body.organizationId;
        if (!organizationId)
            throw ApiError_1.ApiError.badRequest("organizationId is required when uploading as an internal admin");
        return organizationId;
    }
    return req.user.organizationId;
}
exports.uploadFile = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const file = req.file;
    if (!file)
        throw ApiError_1.ApiError.badRequest("No file provided");
    const organizationId = resolveUploadOrgId(req);
    const fileType = req.body.fileType || "OTHER";
    // Attaching the actual E-Stamp certificate/document is an operational
    // action distinct from ordinary supporting-document uploads (which any
    // ESTAMP_UPLOAD-permitted actor may do) - it is what makes a
    // provider-issued order downloadable, so it requires ORDER_MANAGE too.
    let order = null;
    if (fileType === "ESTAMP_DOCUMENT" && req.body.orderId) {
        if (!req.user.permissions.includes(shared_1.Permission.ORDER_MANAGE)) {
            throw ApiError_1.ApiError.forbidden("You do not have permission to attach an E-Stamp certificate to an order");
        }
        order = await models_1.EStampOrder.findOne({ _id: req.body.orderId, organizationId });
        if (!order)
            throw ApiError_1.ApiError.notFound("Order not found");
        if (order.eStampStatus !== shared_1.EStampOrderProcessingStatus.ISSUED) {
            // Never let a certificate be attached before the provider has
            // actually confirmed issuance - that would make the download
            // path available for something that was never really issued.
            throw ApiError_1.ApiError.conflict("The E-Stamp provider has not confirmed this order as issued yet", "NOT_ISSUED");
        }
        const existingDoc = await models_1.EStampDocument.findOne({ orderId: order._id });
        if (existingDoc) {
            throw ApiError_1.ApiError.conflict("A certificate is already attached to this order", "DOCUMENT_ALREADY_ATTACHED");
        }
    }
    const asset = await file_service_1.FileService.upload({
        organizationId,
        ownerUserId: req.user.id,
        fileBuffer: file.buffer,
        originalFileName: file.originalname,
        mimeType: file.mimetype,
        fileType,
        requestId: req.body.requestId,
        orderId: req.body.orderId,
    });
    if (order) {
        let doc;
        try {
            doc = await models_1.EStampDocument.create({
                organizationId,
                requestId: order.requestId,
                orderId: order._id,
                fileAssetId: asset._id,
                providerReference: order.providerReference,
                issuedAt: order.issuedAt || new Date(),
            });
        }
        catch (err) {
            // Belt-and-suspenders against the pre-check above: if a concurrent
            // request won a genuine race (both passed the findOne check before
            // either created its document), the model's own unique index on
            // `orderId` is the real backstop - surface it as the SAME clean
            // 409 the pre-check would have given, never a raw Mongo
            // duplicate-key error bubbling up as an uncaught 500.
            if (err?.code === 11000) {
                throw ApiError_1.ApiError.conflict("A certificate is already attached to this order", "DOCUMENT_ALREADY_ATTACHED");
            }
            throw err;
        }
        order.downloadStatus = "AVAILABLE";
        await order.save();
        await models_1.EStampRequest.findOneAndUpdate({ _id: order.requestId, status: shared_1.EStampRequestStatus.COMPLETED }, { status: shared_1.EStampRequestStatus.DOWNLOAD_AVAILABLE });
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            organizationId,
            action: shared_1.AuditAction.ORDER_MODIFIED,
            entityType: "EStampOrder",
            entityId: order._id.toString(),
            metadata: { action: "certificate_attached", documentId: doc._id.toString() },
            req,
        });
        // Certificate-available notification fires HERE - only now that an
        // actual downloadable document exists, never merely because the
        // order reached ISSUED (that already notified separately, in
        // estamp-request.service.js's applyProviderResult). eventKey is
        // per-order, so this can never fire twice even if this endpoint were
        // somehow called again for the same order (blocked above anyway by
        // the existingDoc check, but this is the same defense-in-depth
        // pattern used everywhere else in this codebase).
        const request = await models_1.EStampRequest.findById(order.requestId);
        const requester = request ? await models_2.User.findById(request.createdBy).select("role email") : null;
        if (request && requester) {
            await (0, notification_service_1.notifyUser)({
                recipientId: request.createdBy.toString(),
                recipientRole: requester.role,
                type: shared_1.NotificationType.ESTAMP_STATUS,
                title: "E-Stamp certificate available",
                message: `Your E-Stamp certificate for order ${order.orderNumber} is ready to download.`,
                organizationId,
                relatedActorId: req.user.id,
                entityType: "EStampOrder",
                entityId: order._id,
                eventKey: `estamp-order:${order._id.toString()}:certificate_available`,
                email: requester.email ? { to: requester.email, method: "sendEStampReadyEmail", args: [order.orderNumber] } : undefined,
            });
        }
    }
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId,
        action: shared_1.AuditAction.ESTAMP_UPLOADED,
        entityType: "FileAsset",
        entityId: asset._id.toString(),
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "File uploaded",
            message: `Assistant Master Admin uploaded a file (${asset.fileType}).`,
            relatedActorId: req.user.id,
            organizationId,
        });
    }
    return (0, ApiResponse_1.created)(res, asset);
});
exports.downloadEStamp = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const isInternal = req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
    const filter = { orderId: req.params.orderId };
    if (!isInternal)
        filter.organizationId = req.user.organizationId;
    const doc = await models_1.EStampDocument.findOne(filter).populate("fileAssetId");
    if (!doc)
        throw ApiError_1.ApiError.notFound("E-Stamp document not found or not yet available");
    const asset = await models_1.FileAsset.findById(doc.fileAssetId);
    if (!asset)
        throw ApiError_1.ApiError.notFound("Underlying file not found");
    const url = await file_service_1.FileService.getSignedUrl(asset.cloudinaryPublicId);
    // Build a clean, sanitized suggested filename - never trust the raw
    // orderNumber blindly for anything security-relevant (it is
    // server-generated today, but treated as untrusted input defensively).
    const order = await models_1.EStampOrder.findById(doc.orderId).select("orderNumber");
    const filename = (0, sanitizeFilename_1.buildCertificateFilename)(order?.orderNumber, asset.mimeType);
    doc.downloadHistory.push({
        downloadedBy: req.user.id,
        downloadedByRole: req.user.role,
        organizationId: doc.organizationId,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        downloadedAt: new Date(),
    });
    await doc.save();
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: doc.organizationId.toString(),
        action: shared_1.AuditAction.ESTAMP_DOWNLOADED,
        entityType: "EStampDocument",
        entityId: doc._id.toString(),
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        // In-app oversight fan-out only, matching every other
        // Assistant-oversight "activity" notification in this codebase
        // (login, balance change, request created/modified/cancelled, order
        // submitted/issued/failed - see estamp-request.service.js and
        // auth.service.js): notifyAllMasterAdmins is deliberately in-app
        // only, never paired with an email to anyone. This call used to ALSO
        // email the downloading Assistant their OWN email address about
        // their own just-performed download (via
        // EmailService.sendEStampDownloadNotification) - that was a
        // copy-paste bug, not a deliberate pattern: no other Assistant
        // activity notification site sends an email at all, let alone one
        // addressed to the actor about their own action. Removed; the
        // in-app notification below is the complete, correct oversight
        // signal.
        //
        // Note this notification is intentionally NOT eventKey-gated, so it
        // fires on every repeated download by the same actor - this matches
        // the established convention for "activity" notifications about an
        // action that can legitimately recur (compare
        // EStampRequestService.modifyRequest, which also notifies
        // Master Admins on every successful modification, un-gated) as
        // opposed to a one-time "state transition" notification (issued/
        // failed/cancelled/certificate-available), which IS eventKey-gated
        // to fire exactly once. Each repeated download is itself
        // newsworthy oversight information, so repeating the notification is
        // deliberate, not a bug.
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "E-Stamp downloaded",
            message: `Assistant Master Admin downloaded E-Stamp for order.`,
            relatedActorId: req.user.id,
            organizationId: doc.organizationId.toString(),
            metadata: { orderId: req.params.orderId },
        });
    }
    return (0, ApiResponse_1.ok)(res, {
        url,
        filename,
        contentType: asset.mimeType,
        fileSize: asset.sizeBytes,
    });
});