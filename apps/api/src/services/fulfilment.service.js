"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FulfilmentService = exports.FULFILLABLE_ORDER_STATUSES = exports.FULFILLABLE_REQUEST_STATUSES = void 0;
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const ApiError_1 = require("../utils/ApiError");
const audit_service_1 = require("./audit.service");
const notification_service_1 = require("./notification.service");
const file_service_1 = require("./file.service");
const wallet_service_1 = require("./wallet.service");
const estamp_notifications_1 = require("./estamp-notifications");
const mongoose_1 = require("mongoose");
const crypto_1 = require("../utils/crypto");
// MANUAL FULFILMENT (ESTAMP_FULFILMENT=manual). There is no external E-Stamp
// vendor: the organization's assigned Assistant Master Admin stamps outside
// the app, then uploads the certificate here. No E-Stamp provider is ever
// instantiated on these paths.
//
// An order is fulfillable only when its request has left the modification
// window (LOCKED/PROCESSING) AND the reserved amount has actually been
// CHARGED - never inside the window, never CANCELLED, never SHORTFALL.
exports.FULFILLABLE_REQUEST_STATUSES = [shared_1.EStampRequestStatus.LOCKED, shared_1.EStampRequestStatus.PROCESSING];
exports.FULFILLABLE_ORDER_STATUSES = [shared_1.EStampOrderProcessingStatus.CREATED, shared_1.EStampOrderProcessingStatus.PROCESSING];
const { CREATED, PROCESSING, ISSUED, FAILED } = shared_1.EStampOrderProcessingStatus;
const { NOT_SENT, SENT, ACCEPTED, UPLOADED, REJECTED, APPROVED } = shared_1.VendorStatus;
// Vendor stage rules. A missing vendorStatus (orders created before the
// vendor workflow) counts as NOT_SENT.
exports.DISPATCHABLE_VENDOR_STATUSES = [NOT_SENT, REJECTED];
exports.RECALLABLE_VENDOR_STATUSES = [SENT, ACCEPTED];
exports.VENDOR_UPLOADABLE_STATUSES = [SENT, ACCEPTED, REJECTED, UPLOADED];
// Vendor certificates: PDF/PNG/JPG only (narrower than FileService's
// allowlist, which also takes CSV/XLSX for bulk uploads).
exports.VENDOR_CERTIFICATE_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];
function cleanReference(stampReference) {
    const reference = typeof stampReference === "string" ? stampReference.trim() : "";
    if (reference.length < 3 || reference.length > 100) {
        throw ApiError_1.ApiError.badRequest("Stamp reference must be 3 to 100 characters", "VALIDATION_ERROR");
    }
    return reference;
}
function cleanReason(reason) {
    const text = typeof reason === "string" ? reason.trim() : "";
    if (text.length < 5 || text.length > 500) {
        throw ApiError_1.ApiError.badRequest("A reason of 5 to 500 characters is required", "VALIDATION_ERROR");
    }
    return text;
}
function notifyVendor(vendorId, order, { title, message, eventKey }) {
    // Vendors only ever learn the order number - never client details.
    return (0, notification_service_1.notify)({
        recipientId: vendorId.toString(),
        recipientRole: shared_1.Role.VENDOR,
        type: shared_1.NotificationType.VENDOR_ACTIVITY,
        title,
        message,
        entityType: "EStampOrder",
        entityId: order ? order._id : undefined,
        eventKey,
    });
}
function assertRequestFulfillable(request) {
    if (!request)
        throw ApiError_1.ApiError.internal("Order/request relationship is inconsistent");
    if (request.status === shared_1.EStampRequestStatus.MODIFICATION_WINDOW) {
        throw ApiError_1.ApiError.conflict("The request is still in its modification window", "WINDOW_OPEN");
    }
    if (!exports.FULFILLABLE_REQUEST_STATUSES.includes(request.status)) {
        throw ApiError_1.ApiError.conflict(`The request is ${request.status} and cannot be fulfilled`, "INVALID_STATE");
    }
    if (request.chargeStatus !== "CHARGED") {
        throw ApiError_1.ApiError.conflict(request.chargeStatus === "SHORTFALL"
            ? "The client's balance did not cover this request; it is on hold"
            : "This request has not been charged yet", "CHARGE_PENDING");
    }
}
function audit(actor, order, action, metadata, req) {
    return (0, audit_service_1.recordAudit)({
        actorId: actor.id,
        actorRole: actor.role,
        organizationId: order.organizationId.toString(),
        action,
        entityType: "EStampOrder",
        entityId: order._id.toString(),
        metadata,
        req,
    });
}
async function notifyMastersIfAssistant(actor, order, title, message) {
    if (actor.role !== shared_1.Role.ASSISTANT_MASTER_ADMIN)
        return;
    await (0, notification_service_1.notifyAllMasterAdmins)({
        type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
        title,
        message,
        relatedActorId: actor.id,
        organizationId: order.organizationId.toString(),
    });
}
// The ONE issue step, shared by manual fulfilment (fulfil, which uploads
// the certificate itself) and vendor approval (which issues from the
// vendor's already-stored asset). ALL-OR-NOTHING:
//   1. EStampDocument (unique per order - the single-winner guard)
//   2. order -> ISSUED/COMPLETED/AVAILABLE, conditional on still CREATED/PROCESSING
//      (plus `extraFilter`, e.g. vendorStatus UPLOADED for an approval)
//   3. request -> DOWNLOAD_AVAILABLE, conditional on LOCKED/PROCESSING + CHARGED
// Any failure undoes what was done (in reverse); the asset is deleted only
// when this call created it (`ownsAsset`) - a vendor's upload is kept.
async function issueWithAsset(order, request, actor, { asset, reference, notes, ownsAsset, stage, extraFilter = {}, extraSet = {}, arrayFilters }, req) {
    const previous = { eStampStatus: order.eStampStatus, status: order.status, downloadStatus: order.downloadStatus };
    let document = null;
    let issuedOrder = null;
    const issuedAt = new Date();
    try {
        try {
            document = await models_1.EStampDocument.create({
                organizationId: order.organizationId,
                requestId: request._id,
                orderId: order._id,
                fileAssetId: asset._id,
                providerReference: reference,
                issuedAt,
            });
        }
        catch (err) {
            if (err?.code === 11000)
                throw ApiError_1.ApiError.conflict("This order has already been issued", "ALREADY_ISSUED");
            throw err;
        }
        issuedOrder = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, eStampStatus: { $in: exports.FULFILLABLE_ORDER_STATUSES }, ...extraFilter }, {
            $set: {
                eStampStatus: ISSUED,
                status: shared_1.OrderStatus.COMPLETED,
                issuedAt,
                providerReference: reference,
                downloadStatus: "AVAILABLE",
                fulfilledBy: actor.id,
                fulfilmentNotes: notes,
                ...extraSet,
            },
        }, { new: true, ...(arrayFilters ? { arrayFilters } : {}) });
        if (!issuedOrder)
            throw ApiError_1.ApiError.conflict("This order is no longer open for fulfilment", "ALREADY_ISSUED");
        const doneRequest = await models_1.EStampRequest.findOneAndUpdate({ _id: request._id, status: { $in: exports.FULFILLABLE_REQUEST_STATUSES }, chargeStatus: "CHARGED" }, { $set: { status: shared_1.EStampRequestStatus.DOWNLOAD_AVAILABLE } }, { new: true });
        if (!doneRequest)
            throw ApiError_1.ApiError.conflict("The request changed concurrently and cannot be fulfilled", "INVALID_STATE");
        request = doneRequest;
    }
    catch (err) {
        // Undo in reverse order, then remove the uploaded file if it was ours.
        if (issuedOrder) {
            const restore = { ...previous };
            for (const key of Object.keys(extraSet)) {
                if (!key.includes("$") && order[key] !== undefined)
                    restore[key] = order[key];
            }
            await models_1.EStampOrder.updateOne({ _id: order._id, eStampStatus: ISSUED }, { $set: restore, $unset: { issuedAt: "", providerReference: "", fulfilmentNotes: "" } }).catch(() => { });
        }
        if (document)
            await models_1.EStampDocument.deleteOne({ _id: document._id }).catch(() => { });
        if (ownsAsset)
            await file_service_1.FileService.deleteAsset(asset).catch(() => { });
        throw err;
    }
    await audit(actor, issuedOrder, shared_1.AuditAction.ESTAMP_ISSUED, { stage, stampReference: reference, documentId: document._id.toString() }, req);
    if (ownsAsset) {
        await (0, audit_service_1.recordAudit)({
            actorId: actor.id,
            actorRole: actor.role,
            organizationId: issuedOrder.organizationId.toString(),
            action: shared_1.AuditAction.ESTAMP_UPLOADED,
            entityType: "FileAsset",
            entityId: asset._id.toString(),
            req,
        });
    }
    // Reused, eventKey-gated client notifications (issued + certificate
    // available): each fires at most once per order.
    await (0, estamp_notifications_1.notifyOrderIssued)(issuedOrder, request, actor.id);
    await (0, estamp_notifications_1.notifyCertificateAvailable)(issuedOrder, actor.id);
    await notifyMastersIfAssistant(actor, issuedOrder, "E-Stamp issued", stage === "vendor_approval"
        ? `Assistant Master Admin approved the vendor certificate for order ${issuedOrder.orderNumber}.`
        : `Assistant Master Admin fulfilled order ${issuedOrder.orderNumber} and uploaded its certificate.`);
    return { order: issuedOrder, request, document };
}
exports.FulfilmentService = {
    // POST /orders/:id/start - CREATED -> PROCESSING (and request LOCKED ->
    // PROCESSING). Idempotent: starting an order already in progress returns
    // it unchanged.
    async start(order, request, actor, req) {
        if (order.eStampStatus === PROCESSING)
            return { order, request, alreadyStarted: true };
        if (order.eStampStatus !== CREATED) {
            throw ApiError_1.ApiError.conflict(`The order is ${order.eStampStatus} and cannot be started`, "INVALID_STATE");
        }
        assertRequestFulfillable(request);
        const now = new Date();
        const started = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, eStampStatus: CREATED }, { $set: { eStampStatus: PROCESSING, fulfilledBy: actor.id, startedAt: now } }, { new: true });
        if (!started) {
            const current = await models_1.EStampOrder.findById(order._id);
            if (current?.eStampStatus === PROCESSING)
                return { order: current, request, alreadyStarted: true };
            throw ApiError_1.ApiError.conflict("The order changed concurrently, please reload", "INVALID_STATE");
        }
        const updatedRequest = (await models_1.EStampRequest.findOneAndUpdate({ _id: request._id, status: shared_1.EStampRequestStatus.LOCKED }, { $set: { status: shared_1.EStampRequestStatus.PROCESSING } }, { new: true })) || request;
        await audit(actor, started, shared_1.AuditAction.ORDER_MODIFIED, { stage: "fulfilment_started" }, req);
        await notifyMastersIfAssistant(actor, started, "Order fulfilment started", `Assistant Master Admin started fulfilling order ${started.orderNumber}.`);
        return { order: started, request: updatedRequest };
    },
    // POST /orders/:id/fulfil - ALL-OR-NOTHING. Upload, then:
    //   1. EStampDocument (unique per order - the single-winner guard)
    //   2. order -> ISSUED/COMPLETED/AVAILABLE, conditional on still CREATED/PROCESSING
    //   3. request -> DOWNLOAD_AVAILABLE, conditional on LOCKED/PROCESSING
    // Any failure undoes what was done (in reverse) and deletes the uploaded
    // asset, so there is never an ISSUED order without a certificate and
    // never an orphaned certificate file.
    async fulfil(order, request, actor, { file, stampReference, notes }, req) {
        if (order.eStampStatus === ISSUED)
            throw ApiError_1.ApiError.conflict("This order has already been issued", "ALREADY_ISSUED");
        if (!exports.FULFILLABLE_ORDER_STATUSES.includes(order.eStampStatus)) {
            throw ApiError_1.ApiError.conflict(`The order is ${order.eStampStatus} and cannot be fulfilled`, "INVALID_STATE");
        }
        assertRequestFulfillable(request);
        if (!file)
            throw ApiError_1.ApiError.badRequest("A certificate file is required", "FILE_REQUIRED");
        const reference = typeof stampReference === "string" ? stampReference.trim() : "";
        if (reference.length < 3 || reference.length > 100) {
            throw ApiError_1.ApiError.badRequest("Stamp reference must be 3 to 100 characters", "VALIDATION_ERROR");
        }
        const cleanNotes = typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 1000) : undefined;
        if (await models_1.EStampDocument.exists({ orderId: order._id })) {
            throw ApiError_1.ApiError.conflict("A certificate is already attached to this order", "ALREADY_ISSUED");
        }
        // Same MIME allowlist, size limit and executable-signature check as
        // every other upload (FileService.validate runs inside upload()).
        const asset = await file_service_1.FileService.upload({
            organizationId: order.organizationId.toString(),
            ownerUserId: actor.id,
            fileBuffer: file.buffer,
            originalFileName: file.originalname,
            mimeType: file.mimetype,
            fileType: "ESTAMP_DOCUMENT",
            requestId: request._id,
            orderId: order._id,
        });
        return issueWithAsset(order, request, actor, { asset, reference, notes: cleanNotes, ownsAsset: true, stage: "manual_fulfilment" }, req);
    },
    // POST /orders/:id/fail - order + request FAILED. Only when refundBalance
    // is true: ONE CREDIT reversing the charge (idempotency key
    // estamp-refund:<requestId>, so never twice). Never refunds otherwise.
    async fail(order, request, actor, { reason, refundBalance }, req) {
        const text = typeof reason === "string" ? reason.trim() : "";
        if (text.length < 5 || text.length > 500) {
            throw ApiError_1.ApiError.badRequest("A reason of 5 to 500 characters is required", "VALIDATION_ERROR");
        }
        if (typeof refundBalance !== "boolean") {
            throw ApiError_1.ApiError.badRequest("refundBalance must be true or false", "VALIDATION_ERROR");
        }
        if (order.eStampStatus === ISSUED)
            throw ApiError_1.ApiError.conflict("An issued order cannot be marked failed", "ALREADY_ISSUED");
        if (order.eStampStatus === FAILED)
            throw ApiError_1.ApiError.conflict("This order is already marked failed", "ALREADY_FAILED");
        if (!request || !exports.FULFILLABLE_REQUEST_STATUSES.includes(request.status)) {
            throw ApiError_1.ApiError.conflict("Only a locked request can be marked failed", "INVALID_STATE");
        }
        const charged = request.chargeStatus === "CHARGED" || !request.chargeStatus;
        if (refundBalance && !charged) {
            throw ApiError_1.ApiError.conflict("Nothing has been charged for this request, so there is nothing to reverse", "NOTHING_TO_REFUND");
        }
        const failedOrder = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, eStampStatus: { $in: exports.FULFILLABLE_ORDER_STATUSES } }, {
            // Also takes the order away from any vendor it is with: the
            // vendor stage is cleared (upload history is kept).
            $set: { eStampStatus: FAILED, status: shared_1.OrderStatus.FAILED, failureReason: text, failedBy: actor.id, vendorStatus: NOT_SENT },
            $unset: { vendorId: "" },
        }, { new: true });
        if (!failedOrder)
            throw ApiError_1.ApiError.conflict("The order changed concurrently, please reload", "INVALID_STATE");
        let failedRequest = (await models_1.EStampRequest.findOneAndUpdate({ _id: request._id, status: { $in: exports.FULFILLABLE_REQUEST_STATUSES } }, { $set: { status: shared_1.EStampRequestStatus.FAILED } }, { new: true })) || request;
        await audit(actor, failedOrder, shared_1.AuditAction.ESTAMP_PROCESSING_FAILED, { stage: "manual_fulfilment", reason: text, refundBalance, ...(order.vendorId ? { vendorId: order.vendorId.toString(), vendorStatus: order.vendorStatus } : {}) }, req);
        let refund = null;
        if (refundBalance) {
            const amount = request.reservedAmount || request.calculatedStampDuty;
            refund = await (0, wallet_service_1.creditWallet)({
                organizationId: request.organizationId,
                amount,
                referenceType: "ESTAMP_REQUEST_REVERSAL",
                referenceId: request._id,
                idempotencyKey: `estamp-refund:${request._id.toString()}`,
                description: `Reversal of E-Stamp request ${request.requestNumber}: ${text}`.slice(0, 500),
                createdBy: actor.id,
            });
            failedRequest = (await models_1.EStampRequest.findOneAndUpdate({ _id: request._id }, { $set: { refundedAt: refund.createdAt || new Date() } }, { new: true })) || failedRequest;
            await (0, audit_service_1.recordAudit)({
                actorId: actor.id,
                actorRole: actor.role,
                organizationId: request.organizationId.toString(),
                action: shared_1.AuditAction.BALANCE_CHANGED,
                entityType: "EStampRequest",
                entityId: request._id.toString(),
                metadata: { type: "CREDIT", source: "estamp_request_reversal", amount, walletTransactionId: refund._id.toString() },
                req,
            });
        }
        await (0, estamp_notifications_1.notifyOrderFailed)(failedOrder, failedRequest, actor.id, `Your E-Stamp request ${request.requestNumber} could not be completed: ${text}${refund ? ` ₹${refund.amount} has been returned to your balance.` : ""}`);
        await notifyMastersIfAssistant(actor, failedOrder, "Order marked failed", `Assistant Master Admin marked order ${failedOrder.orderNumber} as failed${refund ? " and reversed the charge" : ""}.`);
        return { order: failedOrder, request: failedRequest, refund };
    },
    // ---- Vendor stage ----------------------------------------------------
    // POST /orders/dispatch - per order, atomic and idempotent. The caller
    // (order.controller) has already enforced organization access. Returns
    // { orderId, ok, reason?, alreadySent? } and never throws for a single
    // order's business rule, so one bad order never blocks the rest.
    async dispatchOne(order, request, vendor, actor, req) {
        const id = order._id.toString();
        if (order.eStampStatus === ISSUED)
            return { orderId: id, ok: false, reason: "ALREADY_ISSUED" };
        if (order.eStampStatus === FAILED)
            return { orderId: id, ok: false, reason: "ALREADY_FAILED" };
        if (!request || !exports.FULFILLABLE_REQUEST_STATUSES.includes(request.status))
            return { orderId: id, ok: false, reason: "NOT_LOCKED" };
        if (request.chargeStatus !== "CHARGED")
            return { orderId: id, ok: false, reason: "NOT_CHARGED" };
        if (!exports.FULFILLABLE_ORDER_STATUSES.includes(order.eStampStatus))
            return { orderId: id, ok: false, reason: "INVALID_STATE" };
        const current = order.vendorStatus || NOT_SENT;
        if (!exports.DISPATCHABLE_VENDOR_STATUSES.includes(current)) {
            const sameVendor = order.vendorId && order.vendorId.toString() === vendor._id.toString();
            if (sameVendor && [SENT, ACCEPTED, UPLOADED].includes(current))
                return { orderId: id, ok: true, alreadySent: true };
            return { orderId: id, ok: false, reason: "ALREADY_WITH_VENDOR" };
        }
        const now = new Date();
        const sent = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, eStampStatus: { $in: exports.FULFILLABLE_ORDER_STATUSES }, vendorStatus: { $in: [...exports.DISPATCHABLE_VENDOR_STATUSES, null] } }, {
            $set: {
                vendorStatus: SENT,
                vendorId: vendor._id,
                eStampStatus: PROCESSING,
                dispatchedAt: now,
                dispatchedBy: actor.id,
                startedAt: order.startedAt || now,
                vendorDeclined: false,
            },
            $unset: { vendorDeclineReason: "", vendorAcceptedAt: "" },
        }, { new: true });
        if (!sent)
            return { orderId: id, ok: false, reason: "CHANGED_CONCURRENTLY" };
        await models_1.EStampRequest.updateOne({ _id: request._id, status: shared_1.EStampRequestStatus.LOCKED }, { $set: { status: shared_1.EStampRequestStatus.PROCESSING } });
        await audit(actor, sent, shared_1.AuditAction.ORDER_DISPATCHED, { vendorId: vendor._id.toString(), previousVendorStatus: current }, req);
        return { orderId: id, ok: true };
    },
    // One in-app notification per dispatch call, keyed on the exact set of
    // orders sent, so a retried request never notifies twice.
    async notifyVendorDispatched(vendor, orderIds) {
        if (!orderIds.length)
            return;
        const key = (0, crypto_1.sha256Hex)([...orderIds].sort().join(","));
        await notifyVendor(vendor._id, null, {
            title: "New orders to stamp",
            message: orderIds.length === 1 ? "1 order has been sent to you." : `${orderIds.length} orders have been sent to you.`,
            eventKey: `vendor-dispatch:${vendor._id.toString()}:${key}`,
        });
    },
    // POST /orders/:id/recall - SENT/ACCEPTED only, back to NOT_SENT.
    async recall(order, actor, req) {
        if (!exports.RECALLABLE_VENDOR_STATUSES.includes(order.vendorStatus)) {
            throw ApiError_1.ApiError.conflict("Only an order the vendor has not uploaded for can be recalled", "INVALID_STATE");
        }
        const recalled = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, vendorStatus: { $in: exports.RECALLABLE_VENDOR_STATUSES } }, { $set: { vendorStatus: NOT_SENT }, $unset: { vendorId: "", vendorAcceptedAt: "" } }, { new: true });
        if (!recalled)
            throw ApiError_1.ApiError.conflict("The order changed concurrently, please reload", "INVALID_STATE");
        await audit(actor, recalled, shared_1.AuditAction.ORDER_RECALLED, { vendorId: order.vendorId?.toString(), previousVendorStatus: order.vendorStatus }, req);
        if (order.vendorId) {
            await notifyVendor(order.vendorId, recalled, { title: "Order recalled", message: `Order ${recalled.orderNumber} was recalled by LauncherDesk.` });
        }
        return { order: recalled };
    },
    // POST /vendor/orders/:id/accept - SENT -> ACCEPTED (idempotent).
    async vendorAccept(order, actor, req) {
        if (order.vendorStatus === ACCEPTED)
            return { order, alreadyAccepted: true };
        if (order.vendorStatus !== SENT)
            throw ApiError_1.ApiError.conflict(`The order is ${order.vendorStatus} and cannot be accepted`, "INVALID_STATE");
        const accepted = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, vendorId: actor.id, vendorStatus: SENT }, { $set: { vendorStatus: ACCEPTED, vendorAcceptedAt: new Date() } }, { new: true });
        if (!accepted) {
            const current = await models_1.EStampOrder.findById(order._id);
            if (current?.vendorStatus === ACCEPTED && current.vendorId?.toString() === actor.id)
                return { order: current, alreadyAccepted: true };
            throw ApiError_1.ApiError.conflict("The order changed concurrently, please reload", "INVALID_STATE");
        }
        await audit(actor, accepted, shared_1.AuditAction.VENDOR_ORDER_ACCEPTED, {}, req);
        return { order: accepted };
    },
    // POST /vendor/orders/:id/upload - stores the certificate and adds a
    // PENDING history entry; any earlier PENDING entry becomes SUPERSEDED
    // (its asset is kept). Never issues anything: only an assistant's
    // approval creates the EStampDocument clients can download.
    async vendorUpload(order, actor, { file, stampReference, notes }, req) {
        if (!exports.FULFILLABLE_ORDER_STATUSES.includes(order.eStampStatus)) {
            throw ApiError_1.ApiError.conflict("This order is closed", "INVALID_STATE");
        }
        if (!exports.VENDOR_UPLOADABLE_STATUSES.includes(order.vendorStatus) || order.vendorDeclined) {
            throw ApiError_1.ApiError.conflict(`The order is ${order.vendorStatus} and cannot take an upload`, "INVALID_STATE");
        }
        if (!file)
            throw ApiError_1.ApiError.badRequest("A certificate file is required", "FILE_REQUIRED");
        const reference = cleanReference(stampReference);
        const cleanNotes = typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 1000) : undefined;
        if (!exports.VENDOR_CERTIFICATE_MIME_TYPES.includes(file.mimetype)) {
            throw ApiError_1.ApiError.badRequest(`Unsupported file type: ${file.mimetype}`, "UNSUPPORTED_FILE_TYPE");
        }
        // Same size limit and executable-signature check as every upload
        // (FileService.validate runs inside upload()). fileType
        // ESTAMP_DOCUMENT keeps it out of the client-visible supporting
        // documents; a client can only reach it once approval wraps it in an
        // EStampDocument.
        const asset = await file_service_1.FileService.upload({
            organizationId: order.organizationId.toString(),
            ownerUserId: actor.id,
            fileBuffer: file.buffer,
            originalFileName: file.originalname,
            mimeType: file.mimetype,
            fileType: "ESTAMP_DOCUMENT",
            requestId: order.requestId,
            orderId: order._id,
        });
        const entryId = new mongoose_1.Types.ObjectId();
        const uploaded = await models_1.EStampOrder.findOneAndUpdate({
            _id: order._id,
            vendorId: actor.id,
            vendorStatus: { $in: exports.VENDOR_UPLOADABLE_STATUSES },
            vendorDeclined: { $ne: true },
            eStampStatus: { $in: exports.FULFILLABLE_ORDER_STATUSES },
        }, {
            $set: { vendorStatus: UPLOADED },
            $push: { vendorUploads: { _id: entryId, fileAssetId: asset._id, stampReference: reference, notes: cleanNotes, uploadedBy: actor.id, uploadedAt: new Date(), status: shared_1.VendorUploadStatus.PENDING } },
        }, { new: true });
        if (!uploaded) {
            await file_service_1.FileService.deleteAsset(asset).catch(() => { });
            throw ApiError_1.ApiError.conflict("The order changed concurrently, please reload", "INVALID_STATE");
        }
        // Mongo cannot $push and update array elements in one operation, so
        // the earlier PENDING entry is superseded right after.
        const superseded = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id }, { $set: { "vendorUploads.$[p].status": shared_1.VendorUploadStatus.SUPERSEDED } }, { new: true, arrayFilters: [{ "p.status": shared_1.VendorUploadStatus.PENDING, "p._id": { $ne: entryId } }] });
        await audit(actor, uploaded, shared_1.AuditAction.VENDOR_UPLOADED, { uploadId: entryId.toString(), fileAssetId: asset._id.toString(), stampReference: reference }, req);
        await (0, estamp_notifications_1.notifyOrderStaff)(uploaded, {
            title: "Vendor certificate to review",
            message: `A vendor uploaded the certificate for order ${uploaded.orderNumber}.`,
            eventKey: `estamp-order:${uploaded._id.toString()}:vendor-upload:${entryId.toString()}`,
        });
        return { order: superseded || uploaded, uploadId: entryId };
    },
    // POST /vendor/orders/:id/cannot-process - the vendor hands it back
    // (vendorStatus REJECTED + vendorDeclined); the assistant re-dispatches
    // or fulfils it another way.
    async vendorCannotProcess(order, actor, { reason }, req) {
        const text = cleanReason(reason);
        const allowed = [SENT, ACCEPTED, REJECTED];
        if (!allowed.includes(order.vendorStatus) || order.vendorDeclined) {
            throw ApiError_1.ApiError.conflict(`The order is ${order.vendorStatus} and cannot be handed back`, "INVALID_STATE");
        }
        const declined = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, vendorId: actor.id, vendorStatus: { $in: allowed }, vendorDeclined: { $ne: true } }, { $set: { vendorStatus: REJECTED, vendorDeclined: true, vendorDeclineReason: text } }, { new: true });
        if (!declined)
            throw ApiError_1.ApiError.conflict("The order changed concurrently, please reload", "INVALID_STATE");
        await audit(actor, declined, shared_1.AuditAction.VENDOR_DECLINED, { reason: text }, req);
        await (0, estamp_notifications_1.notifyOrderStaff)(declined, {
            title: "Vendor cannot process order",
            message: `The vendor cannot process order ${declined.orderNumber}: ${text}`.slice(0, 1000),
            eventKey: `estamp-order:${declined._id.toString()}:vendor-declined:${declined.dispatchedAt ? declined.dispatchedAt.getTime() : 0}`,
        });
        return { order: declined };
    },
    // POST /orders/:id/vendor-approve - runs the SAME issue step as manual
    // fulfilment, from the vendor's PENDING asset. Idempotent: an order
    // already approved returns { alreadyApproved: true } with no second
    // document and no second set of notifications.
    async vendorApprove(order, request, actor, req) {
        if (order.vendorStatus === APPROVED && order.eStampStatus === ISSUED)
            return { order, request, alreadyApproved: true };
        if (order.eStampStatus === ISSUED)
            throw ApiError_1.ApiError.conflict("This order has already been issued", "ALREADY_ISSUED");
        if (order.vendorStatus !== UPLOADED)
            throw ApiError_1.ApiError.conflict(`The order is ${order.vendorStatus}; there is no vendor upload to approve`, "INVALID_STATE");
        assertRequestFulfillable(request);
        const pending = [...(order.vendorUploads || [])].reverse().find((u) => u.status === shared_1.VendorUploadStatus.PENDING);
        if (!pending)
            throw ApiError_1.ApiError.conflict("There is no vendor upload awaiting review", "INVALID_STATE");
        const asset = await models_1.FileAsset.findById(pending.fileAssetId);
        if (!asset)
            throw ApiError_1.ApiError.conflict("The vendor's file is missing; ask the vendor to re-upload", "FILE_MISSING");
        const now = new Date();
        let result;
        try {
            result = await issueWithAsset(order, request, actor, {
                asset,
                reference: pending.stampReference,
                notes: pending.notes,
                ownsAsset: false,
                stage: "vendor_approval",
                extraFilter: { vendorStatus: UPLOADED },
                extraSet: {
                    vendorStatus: APPROVED,
                    "vendorUploads.$[u].status": shared_1.VendorUploadStatus.APPROVED,
                    "vendorUploads.$[u].reviewedBy": actor.id,
                    "vendorUploads.$[u].reviewedAt": now,
                },
                arrayFilters: [{ "u._id": pending._id }],
            }, req);
        }
        catch (err) {
            // Lost a race with a concurrent approve: same answer as a repeat.
            if (err?.code === "ALREADY_ISSUED") {
                const current = await models_1.EStampOrder.findById(order._id);
                if (current?.vendorStatus === APPROVED && current.eStampStatus === ISSUED)
                    return { order: current, request, alreadyApproved: true };
            }
            throw err;
        }
        await audit(actor, result.order, shared_1.AuditAction.VENDOR_UPLOAD_APPROVED, { uploadId: pending._id.toString(), fileAssetId: asset._id.toString(), stampReference: pending.stampReference, documentId: result.document._id.toString() }, req);
        if (order.vendorId) {
            await notifyVendor(order.vendorId, result.order, {
                title: "Certificate approved",
                message: `Your certificate for order ${result.order.orderNumber} was approved.`,
                eventKey: `estamp-order:${order._id.toString()}:vendor-approved`,
            });
        }
        return result;
    },
    // POST /orders/:id/vendor-reject - UPLOADED -> REJECTED; the vendor
    // re-uploads. The rejected file stays in the history and is never issued.
    async vendorReject(order, actor, { reason }, req) {
        const text = cleanReason(reason);
        if (order.vendorStatus !== UPLOADED)
            throw ApiError_1.ApiError.conflict(`The order is ${order.vendorStatus}; there is no vendor upload to reject`, "INVALID_STATE");
        const pending = [...(order.vendorUploads || [])].reverse().find((u) => u.status === shared_1.VendorUploadStatus.PENDING);
        if (!pending)
            throw ApiError_1.ApiError.conflict("There is no vendor upload awaiting review", "INVALID_STATE");
        const rejected = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, vendorStatus: UPLOADED, eStampStatus: { $in: exports.FULFILLABLE_ORDER_STATUSES } }, {
            $set: {
                vendorStatus: REJECTED,
                "vendorUploads.$[u].status": shared_1.VendorUploadStatus.REJECTED,
                "vendorUploads.$[u].reviewNotes": text,
                "vendorUploads.$[u].reviewedBy": actor.id,
                "vendorUploads.$[u].reviewedAt": new Date(),
            },
        }, { new: true, arrayFilters: [{ "u._id": pending._id }] });
        if (!rejected)
            throw ApiError_1.ApiError.conflict("The order changed concurrently, please reload", "INVALID_STATE");
        await audit(actor, rejected, shared_1.AuditAction.VENDOR_UPLOAD_REJECTED, { uploadId: pending._id.toString(), reason: text }, req);
        if (rejected.vendorId) {
            await notifyVendor(rejected.vendorId, rejected, {
                title: "Certificate needs re-upload",
                message: `Your certificate for order ${rejected.orderNumber} was rejected: ${text}`.slice(0, 1000),
                eventKey: `estamp-order:${order._id.toString()}:vendor-rejected:${pending._id.toString()}`,
            });
        }
        return { order: rejected };
    },
    // Counts for the vendor dashboard (GET /vendor/orders/summary): by
    // vendorStatus, plus the oldest order still waiting on the vendor.
    async vendorSummary(vendorId) {
        const vid = new mongoose_1.Types.ObjectId(vendorId);
        const rows = await models_1.EStampOrder.aggregate([
            { $match: { vendorId: vid } },
            { $group: { _id: "$vendorStatus", count: { $sum: 1 } } },
        ]);
        const summary = { total: 0, SENT: 0, ACCEPTED: 0, UPLOADED: 0, REJECTED: 0, APPROVED: 0 };
        for (const row of rows) {
            if (summary[row._id] !== undefined) {
                summary[row._id] = row.count;
                summary.total += row.count;
            }
        }
        const oldest = await models_1.EStampOrder.findOne({ vendorId: vid, vendorStatus: { $in: [SENT, ACCEPTED, REJECTED] } }).sort({ dispatchedAt: 1 }).select("dispatchedAt");
        const oldestAt = oldest?.dispatchedAt || null;
        return { ...summary, oldestWaitingAt: oldestAt, oldestWaitingMinutes: oldestAt ? Math.floor((Date.now() - oldestAt.getTime()) / 60000) : null };
    },
    // Request filter for the "orders to fulfil" queue (orders are then
    // filtered to these requests and to CREATED/PROCESSING).
    fulfillableRequestFilter() {
        return { status: { $in: exports.FULFILLABLE_REQUEST_STATUSES }, chargeStatus: "CHARGED" };
    },
    // Dashboard numbers for the fulfilment queue within `orgScope` (an
    // orgAccess-style organizationId filter value, or undefined = all).
    async summary(orgScope) {
        const scope = orgScope === undefined ? {} : { organizationId: orgScope };
        const requests = await models_1.EStampRequest.find({ ...scope, ...this.fulfillableRequestFilter() }).select("_id lockedAt");
        const lockedAtById = new Map(requests.map((r) => [r._id.toString(), r.lockedAt]));
        const orders = requests.length
            ? await models_1.EStampOrder.find({ requestId: { $in: requests.map((r) => r._id) }, eStampStatus: { $in: exports.FULFILLABLE_ORDER_STATUSES } }).select("requestId createdAt")
            : [];
        let oldest = null;
        for (const o of orders) {
            const at = lockedAtById.get(o.requestId.toString()) || o.createdAt;
            if (!oldest || at < oldest)
                oldest = at;
        }
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const fulfilledToday = await models_1.EStampOrder.countDocuments({ ...scope, eStampStatus: ISSUED, issuedAt: { $gte: startOfToday }, fulfilledBy: { $exists: true } });
        return {
            toFulfil: orders.length,
            oldestLockedAt: oldest,
            oldestAgeMinutes: oldest ? Math.floor((Date.now() - new Date(oldest).getTime()) / 60000) : null,
            fulfilledToday,
        };
    },
};
