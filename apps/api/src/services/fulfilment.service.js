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
            issuedOrder = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, eStampStatus: { $in: exports.FULFILLABLE_ORDER_STATUSES } }, {
                $set: {
                    eStampStatus: ISSUED,
                    status: shared_1.OrderStatus.COMPLETED,
                    issuedAt,
                    providerReference: reference,
                    downloadStatus: "AVAILABLE",
                    fulfilledBy: actor.id,
                    fulfilmentNotes: cleanNotes,
                },
            }, { new: true });
            if (!issuedOrder)
                throw ApiError_1.ApiError.conflict("This order is no longer open for fulfilment", "ALREADY_ISSUED");
            const doneRequest = await models_1.EStampRequest.findOneAndUpdate({ _id: request._id, status: { $in: exports.FULFILLABLE_REQUEST_STATUSES }, chargeStatus: "CHARGED" }, { $set: { status: shared_1.EStampRequestStatus.DOWNLOAD_AVAILABLE } }, { new: true });
            if (!doneRequest)
                throw ApiError_1.ApiError.conflict("The request changed concurrently and cannot be fulfilled", "INVALID_STATE");
            request = doneRequest;
        }
        catch (err) {
            // Undo in reverse order, then remove the uploaded file.
            if (issuedOrder) {
                await models_1.EStampOrder.updateOne({ _id: order._id, eStampStatus: ISSUED }, { $set: previous, $unset: { issuedAt: "", providerReference: "", fulfilmentNotes: "" } }).catch(() => { });
            }
            if (document)
                await models_1.EStampDocument.deleteOne({ _id: document._id }).catch(() => { });
            await file_service_1.FileService.deleteAsset(asset).catch(() => { });
            throw err;
        }
        await audit(actor, issuedOrder, shared_1.AuditAction.ESTAMP_ISSUED, { stage: "manual_fulfilment", stampReference: reference, documentId: document._id.toString() }, req);
        await (0, audit_service_1.recordAudit)({
            actorId: actor.id,
            actorRole: actor.role,
            organizationId: issuedOrder.organizationId.toString(),
            action: shared_1.AuditAction.ESTAMP_UPLOADED,
            entityType: "FileAsset",
            entityId: asset._id.toString(),
            req,
        });
        // Reused, eventKey-gated client notifications (issued + certificate
        // available): each fires at most once per order.
        await (0, estamp_notifications_1.notifyOrderIssued)(issuedOrder, request, actor.id);
        await (0, estamp_notifications_1.notifyCertificateAvailable)(issuedOrder, actor.id);
        await notifyMastersIfAssistant(actor, issuedOrder, "E-Stamp issued", `Assistant Master Admin fulfilled order ${issuedOrder.orderNumber} and uploaded its certificate.`);
        return { order: issuedOrder, request, document };
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
        const failedOrder = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, eStampStatus: { $in: exports.FULFILLABLE_ORDER_STATUSES } }, { $set: { eStampStatus: FAILED, status: shared_1.OrderStatus.FAILED, failureReason: text, failedBy: actor.id } }, { new: true });
        if (!failedOrder)
            throw ApiError_1.ApiError.conflict("The order changed concurrently, please reload", "INVALID_STATE");
        let failedRequest = (await models_1.EStampRequest.findOneAndUpdate({ _id: request._id, status: { $in: exports.FULFILLABLE_REQUEST_STATUSES } }, { $set: { status: shared_1.EStampRequestStatus.FAILED } }, { new: true })) || request;
        await audit(actor, failedOrder, shared_1.AuditAction.ESTAMP_PROCESSING_FAILED, { stage: "manual_fulfilment", reason: text, refundBalance }, req);
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
