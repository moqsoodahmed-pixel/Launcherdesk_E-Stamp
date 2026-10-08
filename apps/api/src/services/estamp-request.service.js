"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EStampRequestService = void 0;
const uuid_1 = require("uuid");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const calculation_service_1 = require("./calculation.service");
const wallet_service_1 = require("./wallet.service");
const estamp_providers_1 = require("./estamp-providers");
const ApiError_1 = require("../utils/ApiError");
const audit_service_1 = require("./audit.service");
const notification_service_1 = require("./notification.service");
const settings_service_1 = require("./settings.service");
const policy_service_1 = require("./policy.service");
const Policy_1 = require("../models/Policy");
const shared_2 = require("@launcherdesk/shared");
// Proper state-machine-oriented service for the E-Stamp request lifecycle.
// Nothing outside this service should mutate an EStampRequest.status directly.
const ALLOWED_TRANSITIONS = {
    [shared_1.EStampRequestStatus.DRAFT]: [shared_1.EStampRequestStatus.PAYMENT_PENDING, shared_1.EStampRequestStatus.CANCELLED],
    [shared_1.EStampRequestStatus.PAYMENT_PENDING]: [shared_1.EStampRequestStatus.PAYMENT_SUCCESS, shared_1.EStampRequestStatus.FAILED, shared_1.EStampRequestStatus.CANCELLED],
    [shared_1.EStampRequestStatus.PAYMENT_SUCCESS]: [shared_1.EStampRequestStatus.REQUEST_CREATED],
    [shared_1.EStampRequestStatus.REQUEST_CREATED]: [shared_1.EStampRequestStatus.MODIFICATION_WINDOW],
    [shared_1.EStampRequestStatus.MODIFICATION_WINDOW]: [shared_1.EStampRequestStatus.LOCKED, shared_1.EStampRequestStatus.CANCELLED],
    [shared_1.EStampRequestStatus.LOCKED]: [shared_1.EStampRequestStatus.PROCESSING, shared_1.EStampRequestStatus.CANCELLED],
    [shared_1.EStampRequestStatus.PROCESSING]: [shared_1.EStampRequestStatus.COMPLETED, shared_1.EStampRequestStatus.FAILED],
    [shared_1.EStampRequestStatus.COMPLETED]: [shared_1.EStampRequestStatus.DOWNLOAD_AVAILABLE],
    [shared_1.EStampRequestStatus.DOWNLOAD_AVAILABLE]: [],
    [shared_1.EStampRequestStatus.CANCELLED]: [],
    [shared_1.EStampRequestStatus.FAILED]: [],
};
function assertTransition(from, to) {
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
        throw ApiError_1.ApiError.conflict(`Invalid request state transition: ${from} -> ${to}`);
    }
}
// The ORDER's own provider-processing state machine (EStampOrder.eStampStatus,
// see shared EStampOrderProcessingStatus) - deliberately separate from the
// EStampRequest state machine above. Request = customer/business lifecycle;
// Order = provider processing lifecycle. Kept in sync by processOrder/
// syncEStampOrderStatus, never mutated directly anywhere else.
const ORDER_ALLOWED_TRANSITIONS = {
    [shared_1.EStampOrderProcessingStatus.CREATED]: [shared_1.EStampOrderProcessingStatus.SUBMITTING],
    // SUBMITTING can go back to itself conceptually via a safe retry (the
    // atomic claim in processOrder is what actually prevents concurrent
    // double-submission, not this table) - modelled here as also being able
    // to reach SUBMITTED/PROCESSING/FAILED once the provider call resolves
    // or a later sync determines the outcome of an interrupted submission.
    [shared_1.EStampOrderProcessingStatus.SUBMITTING]: [shared_1.EStampOrderProcessingStatus.SUBMITTED, shared_1.EStampOrderProcessingStatus.PROCESSING, shared_1.EStampOrderProcessingStatus.ISSUED, shared_1.EStampOrderProcessingStatus.FAILED],
    [shared_1.EStampOrderProcessingStatus.SUBMITTED]: [shared_1.EStampOrderProcessingStatus.PROCESSING, shared_1.EStampOrderProcessingStatus.ISSUED, shared_1.EStampOrderProcessingStatus.FAILED],
    [shared_1.EStampOrderProcessingStatus.PROCESSING]: [shared_1.EStampOrderProcessingStatus.ISSUED, shared_1.EStampOrderProcessingStatus.FAILED],
    [shared_1.EStampOrderProcessingStatus.ISSUED]: [], // terminal - reachable only via syncEStampOrderStatus
    [shared_1.EStampOrderProcessingStatus.FAILED]: [], // terminal - no automatic FAILED -> ISSUED; that would require an explicit, separately-audited re-submission starting a NEW attempt, not an in-place transition
};
function assertOrderTransition(from, to) {
    if (!ORDER_ALLOWED_TRANSITIONS[from]?.includes(to)) {
        throw ApiError_1.ApiError.conflict(`Invalid order state transition: ${from} -> ${to}`, "INVALID_STATE_TRANSITION");
    }
}
function isInternalRole(role) {
    return role === shared_2.Role.MASTER_ADMIN || role === shared_2.Role.ASSISTANT_MASTER_ADMIN;
}
// Phase 12 hardening - pure, informational-only window computation shared by
// getRequest/listRequests responses. NEVER consulted by modifyRequest/
// cancelRequest/lockExpiredRequests as a gate - those use an atomic
// conditional DB update as the real authority (see below). This only tells
// the frontend "here's what the server currently believes", so the UI can
// stop re-deriving canModify from its own client-side timer.
// Boundary rule: strictly `deadline > now` - at-or-past the exact deadline
// instant is CLOSED, not open (this is the fix for the previous `<` bug).
function computeWindowInfo(request, now = new Date()) {
    const isOpen = request.status === shared_1.EStampRequestStatus.MODIFICATION_WINDOW &&
        !!request.modificationDeadline &&
        request.modificationDeadline.getTime() > now.getTime();
    const windowExpiresAt = request.status === shared_1.EStampRequestStatus.MODIFICATION_WINDOW ? request.modificationDeadline : null;
    const windowRemainingSeconds = request.modificationDeadline
        ? Math.max(0, Math.floor((request.modificationDeadline.getTime() - now.getTime()) / 1000))
        : 0;
    return {
        canModify: isOpen,
        canCancel: isOpen,
        windowExpiresAt,
        windowRemainingSeconds,
    };
}
exports.computeWindowInfo = computeWindowInfo;
// Shared cause-classification for a blocked modify/cancel attempt, once we
// already know the atomic conditional update did NOT match. Distinguishes
// "wrong status entirely" from "right status, but the deadline has already
// passed" so API consumers/tests can tell the two apart instead of getting
// one generic conflict message.
function conflictCodeForBlockedMutation(existing) {
    if (existing.status !== shared_1.EStampRequestStatus.MODIFICATION_WINDOW) {
        return { code: "INVALID_STATE", message: "Request is not in a modifiable state" };
    }
    return { code: "WINDOW_EXPIRED", message: "Modification window has expired" };
}
// Loads an order + its request, enforcing tenant isolation identically to
// every other tenant-scoped lookup in this codebase (same "not found" for
// missing vs. belongs-to-another-org, so existence is never confirmed).
async function loadOwnedOrder(orderId, organizationId, actorRole) {
    const order = await models_1.EStampOrder.findById(orderId);
    if (!order || (!isInternalRole(actorRole) && order.organizationId.toString() !== organizationId)) {
        throw ApiError_1.ApiError.notFound("Order not found");
    }
    const request = await models_1.EStampRequest.findById(order.requestId);
    if (!request || request.orderId?.toString() !== order._id.toString()) {
        // Relationship integrity: an order must always point back at the
        // request that points at it. If this ever fails, something is
        // structurally wrong - never silently proceed against mismatched data.
        throw ApiError_1.ApiError.internal("Order/request relationship is inconsistent");
    }
    return { order, request };
}
async function nextSequenceNumber(prefix) {
    // Simple, safe-enough Phase 1 approach: timestamp + random suffix.
    // For high-throughput production use, replace with a dedicated Counter collection.
    const year = new Date().getFullYear();
    const rand = Math.floor(Math.random() * 900000 + 100000);
    return `${prefix}-${year}-${rand}`;
}
// Applies a (already-obtained, trusted) provider status result to an order +
// its request. Shared by syncEStampOrderStatus (result freshly fetched via
// provider.checkStatus) and handleProviderWebhook (result taken from a
// signature-verified webhook payload) - one place owns the actual state
// transition + audit + notification logic, regardless of how the result
// was obtained.
async function applyProviderResult(order, request, result, actorId, actorRole, req) {
    if (order.eStampStatus === shared_2.EStampOrderProcessingStatus.ISSUED || order.eStampStatus === shared_2.EStampOrderProcessingStatus.FAILED) {
        return { order, request, alreadyTerminal: true };
    }
    order.lastSyncedAt = new Date();
    order.providerRawStatus = result.status;
    if (result.status === "ISSUED") {
        assertOrderTransition(order.eStampStatus, shared_2.EStampOrderProcessingStatus.ISSUED);
        order.eStampStatus = shared_2.EStampOrderProcessingStatus.ISSUED;
        order.status = shared_1.OrderStatus.COMPLETED;
        order.issuedAt = new Date();
        await order.save();
        assertTransition(request.status, shared_1.EStampRequestStatus.COMPLETED);
        request.status = shared_1.EStampRequestStatus.COMPLETED;
        await request.save();
        await (0, audit_service_1.recordAudit)({
            actorId, actorRole: actorRole || "UNKNOWN", actorType: actorId ? "USER" : "SYSTEM", organizationId: order.organizationId.toString(),
            action: shared_2.AuditAction.ESTAMP_ISSUED, entityType: "EStampOrder", entityId: order._id.toString(),
            metadata: { providerReference: order.providerReference }, req,
        });
        const requester = await models_1.User.findById(request.createdBy).select("role email");
        if (requester) {
            // eventKey = one issuance per order - even if this branch were
            // somehow reached twice (it structurally can't be, see the
            // terminal-state guard above), the unique index on
            // Notification.eventKey/EmailLog.eventKey is the actual
            // guarantee against a duplicate "issued" email/notification.
            await (0, notification_service_1.notifyUser)({
                recipientId: request.createdBy.toString(),
                recipientRole: requester.role,
                type: shared_2.NotificationType.ESTAMP_STATUS,
                title: "E-Stamp issued",
                message: `Your E-Stamp request ${request.requestNumber} has been issued.`,
                organizationId: order.organizationId.toString(),
                relatedActorId: actorId,
                entityType: "EStampOrder",
                entityId: order._id,
                eventKey: `estamp-order:${order._id.toString()}:issued`,
                email: requester.email ? { to: requester.email, method: "sendOrderIssuedEmail", args: [order.orderNumber] } : undefined,
            });
        }
        if (actorRole === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
            await (0, notification_service_1.notifyAllMasterAdmins)({
                type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
                title: "E-Stamp issued",
                message: `Assistant Master Admin's order ${order.orderNumber} was confirmed issued by the provider.`,
                relatedActorId: actorId,
                organizationId: order.organizationId.toString(),
            });
        }
    }
    else if (result.status === "FAILED") {
        assertOrderTransition(order.eStampStatus, shared_2.EStampOrderProcessingStatus.FAILED);
        order.eStampStatus = shared_2.EStampOrderProcessingStatus.FAILED;
        order.status = shared_1.OrderStatus.FAILED;
        order.failureReason = result.rawResponse?.reason ? String(result.rawResponse.reason).slice(0, 500) : "Provider reported failure";
        await order.save();
        assertTransition(request.status, shared_1.EStampRequestStatus.FAILED);
        request.status = shared_1.EStampRequestStatus.FAILED;
        await request.save();
        await (0, audit_service_1.recordAudit)({
            actorId, actorRole: actorRole || "UNKNOWN", actorType: actorId ? "USER" : "SYSTEM", organizationId: order.organizationId.toString(),
            action: shared_2.AuditAction.ESTAMP_PROCESSING_FAILED, entityType: "EStampOrder", entityId: order._id.toString(),
            metadata: { providerReference: order.providerReference, reason: order.failureReason }, req,
        });
        const failedRequester = await models_1.User.findById(request.createdBy).select("role email");
        if (failedRequester) {
            await (0, notification_service_1.notifyUser)({
                recipientId: request.createdBy.toString(),
                recipientRole: failedRequester.role,
                type: shared_2.NotificationType.ESTAMP_STATUS,
                title: "E-Stamp processing failed",
                message: `E-Stamp processing for your request ${request.requestNumber} failed.`,
                organizationId: order.organizationId.toString(),
                relatedActorId: actorId,
                entityType: "EStampOrder",
                entityId: order._id,
                eventKey: `estamp-order:${order._id.toString()}:failed`,
                email: failedRequester.email ? { to: failedRequester.email, method: "sendOrderFailedEmail", args: [order.orderNumber, order.failureReason] } : undefined,
            });
        }
        if (actorRole === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
            await (0, notification_service_1.notifyAllMasterAdmins)({
                type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
                title: "E-Stamp processing failed",
                message: `Assistant Master Admin's order ${order.orderNumber} failed provider processing.`,
                relatedActorId: actorId,
                organizationId: order.organizationId.toString(),
            });
        }
    }
    else {
        // Still pending/unknown at the provider - not an error, just not
        // resolved yet. Move SUBMITTING/SUBMITTED -> PROCESSING to reflect
        // that a real submission is confirmed in flight (as opposed to the
        // uncertain "we don't know if it even reached the provider" state).
        if (order.eStampStatus === shared_2.EStampOrderProcessingStatus.SUBMITTING || order.eStampStatus === shared_2.EStampOrderProcessingStatus.SUBMITTED) {
            assertOrderTransition(order.eStampStatus, shared_2.EStampOrderProcessingStatus.PROCESSING);
            order.eStampStatus = shared_2.EStampOrderProcessingStatus.PROCESSING;
        }
        await order.save();
    }
    return { order, request };
}
exports.EStampRequestService = {
    async createRequest(input) {
        // Double-submission protection: if the caller already submitted this
        // exact form once (same organization + client-generated key), return
        // the request that resulted from the FIRST submission rather than
        // creating a second one and charging the wallet again.
        if (input.idempotencyKey) {
            const existingRequest = await models_1.EStampRequest.findOne({
                organizationId: input.organizationId,
                idempotencyKey: input.idempotencyKey,
            });
            if (existingRequest) {
                const existingOrder = await models_1.EStampOrder.findOne({ requestId: existingRequest._id });
                return { request: existingRequest, order: existingOrder };
            }
        }
        const org = await models_1.Organization.findById(input.organizationId);
        if (!org || !org.isEstampServiceEnabled) {
            throw ApiError_1.ApiError.forbidden("E-Stamp service is not enabled for your organization");
        }
        // Phase 17 - the ONE sanctioned bridge to Phase 16's PolicyService,
        // gated behind a feature flag that defaults to false. When the flag
        // is off (out-of-the-box behavior), this call never happens at all -
        // byte-for-byte identical to the pre-Phase-17 codebase. Only when
        // Master Admin explicitly turns POLICY_ACKNOWLEDGEMENT_ENABLED on
        // does request creation require the actor to have accepted the
        // current TERMS policy. Deliberately before any wallet debit - a
        // rejected request must never charge the wallet.
        if (await settings_service_1.SettingsService.isFeatureEnabled("POLICY_ACKNOWLEDGEMENT_ENABLED")) {
            await policy_service_1.PolicyService.assertAcceptedCurrent(input.createdBy, Policy_1.PolicyType.TERMS);
        }
        const { amount, articleVersionUsed } = await calculation_service_1.CalculationService.calculate({
            stateCode: input.stateCode,
            articleId: input.articleId,
            considerationPrice: input.considerationPrice,
            numberOfEStamps: input.numberOfEStamps,
        });
        // Debit wallet FIRST, atomically and conditionally on sufficient balance -
        // the backend is authoritative; if this fails, no request/order is created.
        // Deriving the wallet's own idempotency key from the same client-supplied
        // key (when present) means a retried request also can't double-debit
        // even if it raced past the findOne check above.
        const walletIdempotencyKey = input.idempotencyKey
            ? `estamp-request:${input.organizationId}:${input.idempotencyKey}`
            : `estamp-request:${(0, uuid_1.v4)()}`;
        const debit = await (0, wallet_service_1.debitWalletIfSufficient)({
            organizationId: input.organizationId,
            amount,
            referenceType: "ESTAMP_REQUEST",
            idempotencyKey: walletIdempotencyKey,
            description: "E-Stamp request charge",
            createdBy: input.createdBy,
        });
        if (!debit.success) {
            throw ApiError_1.ApiError.badRequest("Insufficient balance. Please add funds to continue.", "INSUFFICIENT_BALANCE");
        }
        const requestNumber = await nextSequenceNumber("LDE-REQ");
        // Phase 17 - read live from SettingsService (DB override if present
        // and valid, else the registry default which mirrors env.js's
        // current default exactly) rather than the frozen-at-boot env value.
        // Deliberately read ONLY here, at creation time, to compute a FIXED
        // modificationDeadline stored on the request - a later setting
        // change must only affect requests created after the change, never
        // retroactively alter an already-created request's stored deadline
        // (exactly like changing env.REQUEST_MODIFY_WINDOW_MINUTES today
        // would only affect a fresh process's future requests).
        const requestModifyWindowMinutes = await settings_service_1.SettingsService.getRequestModifyWindowMinutes();
        const modificationDeadline = new Date(Date.now() + requestModifyWindowMinutes * 60 * 1000);
        let request;
        try {
            request = await models_1.EStampRequest.create({
                requestNumber,
                organizationId: input.organizationId,
                createdBy: input.createdBy,
                stateCode: input.stateCode.toUpperCase(),
                articleId: input.articleId,
                articleVersionUsed,
                firstParty: input.firstParty,
                secondParty: input.secondParty,
                descriptionOfDocument: input.descriptionOfDocument,
                propertyDescription: input.propertyDescription,
                considerationPrice: input.considerationPrice,
                stampDutyPaidBy: input.stampDutyPaidBy,
                numberOfEStamps: input.numberOfEStamps,
                extraFields: input.extraFields,
                calculatedStampDuty: amount,
                status: shared_1.EStampRequestStatus.MODIFICATION_WINDOW,
                modificationDeadline,
                idempotencyKey: input.idempotencyKey,
            });
        }
        catch (err) {
            // A concurrent request with the SAME idempotencyKey won this race -
            // the wallet debit above already protected the money; hand back
            // the request the winner created instead of surfacing a raw
            // duplicate-key error for what is, from the caller's point of
            // view, the exact same double-submitted request.
            if (err?.code === 11000 && input.idempotencyKey) {
                const winner = await models_1.EStampRequest.findOne({ organizationId: input.organizationId, idempotencyKey: input.idempotencyKey });
                if (winner) {
                    const winnerOrder = await models_1.EStampOrder.findOne({ requestId: winner._id });
                    return { request: winner, order: winnerOrder };
                }
            }
            throw err;
        }
        const orderNumber = await nextSequenceNumber("LDE-ORD");
        const order = await models_1.EStampOrder.create({
            orderNumber,
            organizationId: input.organizationId,
            requestId: request._id,
            createdBy: input.createdBy,
            stateCode: request.stateCode,
            articleId: request.articleId,
            amount,
            paymentStatus: "PAID", // paid via wallet balance
            eStampStatus: request.status,
            status: shared_1.OrderStatus.ONGOING,
        });
        request.orderId = order._id;
        await request.save();
        await (0, audit_service_1.recordAudit)({
            actorId: input.createdBy,
            actorRole: input.actorRole || "UNKNOWN",
            organizationId: input.organizationId,
            action: shared_2.AuditAction.ESTAMP_REQUEST_CREATED,
            entityType: "EStampRequest",
            entityId: request._id.toString(),
            req: input.req,
        });
        if (input.actorRole === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
            await (0, notification_service_1.notifyAllMasterAdmins)({
                type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
                title: "E-Stamp request created",
                message: `Assistant Master Admin created E-Stamp request ${request.requestNumber} for a client organization.`,
                relatedActorId: input.createdBy,
                organizationId: input.organizationId,
            });
        }
        return { request, order };
    },
    // Modification is limited to non-financial descriptive fields (see
    // updateEStampRequestSchema) - the calculation/wallet debit made at
    // creation time is never touched here.
    //
    // Phase 12 hardening: this used to be a check-then-act
    // (find -> assertWithinModificationWindow -> Object.assign -> save())
    // sequence, which is racy - between the read and the save(), a
    // concurrent cancel or the lockExpiredRequests cron could move the
    // request out of MODIFICATION_WINDOW, and this call would still
    // silently persist its descriptive-field changes onto a request that
    // had, by then, already been locked/cancelled in the database (since
    // Object.assign never touches `status`, Mongoose would never re-check
    // it). Replaced with a single atomic conditional update: the DB itself
    // is the only place status+deadline are ever compared-and-set, so
    // whichever concurrent operation's conditional update reaches Mongo
    // first is the one that wins - there is no window for a lost precondition.
    async modifyRequest(requestId, organizationId, actorId, actorRole, updates, req) {
        const now = new Date();
        const updated = await models_1.EStampRequest.findOneAndUpdate({
            _id: requestId,
            organizationId,
            status: shared_1.EStampRequestStatus.MODIFICATION_WINDOW,
            modificationDeadline: { $gt: now },
        }, { $set: updates }, { new: true });
        if (!updated) {
            const existing = await models_1.EStampRequest.findOne({ _id: requestId, organizationId });
            if (!existing)
                throw ApiError_1.ApiError.notFound("Request not found");
            const { code, message } = conflictCodeForBlockedMutation(existing);
            throw ApiError_1.ApiError.conflict(message, code);
        }
        await (0, audit_service_1.recordAudit)({
            actorId,
            actorRole: actorRole || "UNKNOWN",
            organizationId,
            action: shared_2.AuditAction.ESTAMP_REQUEST_MODIFIED,
            entityType: "EStampRequest",
            entityId: updated._id.toString(),
            metadata: { updatedFields: Object.keys(updates) },
            req,
        });
        if (actorRole === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
            await (0, notification_service_1.notifyAllMasterAdmins)({
                type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
                title: "E-Stamp request modified",
                message: `Assistant Master Admin modified E-Stamp request ${updated.requestNumber}.`,
                relatedActorId: actorId,
                organizationId,
            });
        }
        return updated;
    },
    // Backend-authoritative 20-minute window check - never trust a frontend
    // timer. Kept for the boundary-check unit tests
    // (modification-window.test.js) that exercise it directly; no longer
    // consulted by modifyRequest/cancelRequest themselves (see their atomic
    // conditional updates above/below), since a separate check-then-act call
    // to this helper is exactly the race Phase 12 closes.
    // Boundary fix: was `<` (so an exact now===deadline tie was treated as
    // still-open); now `<=`, so the exact expiry instant is rejected too,
    // matching computeWindowInfo's strict `now < deadline` rule.
    assertWithinModificationWindow(request) {
        if (request.status !== shared_1.EStampRequestStatus.MODIFICATION_WINDOW) {
            throw ApiError_1.ApiError.conflict("Request is not in a modifiable state", "INVALID_STATE");
        }
        if (request.modificationDeadline.getTime() <= Date.now()) {
            throw ApiError_1.ApiError.conflict("Modification window has expired", "WINDOW_EXPIRED");
        }
    },
    // Phase 12 hardening: same atomic-conditional-update treatment as
    // modifyRequest, PLUS idempotency - a repeat cancel of an
    // already-cancelled request is a clean no-op (returns the existing
    // cancelled request, no error, no second audit/notify/order-update)
    // rather than a race where two concurrent callers could both fall
    // through the old check-then-act sequence and both re-run
    // recordAudit/notifyAllMasterAdmins for the same real-world cancellation.
    async cancelRequest(requestId, organizationId, actorId, actorRole, req) {
        const now = new Date();
        const updated = await models_1.EStampRequest.findOneAndUpdate({
            _id: requestId,
            organizationId,
            status: shared_1.EStampRequestStatus.MODIFICATION_WINDOW,
            modificationDeadline: { $gt: now },
        }, { $set: { status: shared_1.EStampRequestStatus.CANCELLED, cancelledAt: now } }, { new: true });
        if (!updated) {
            const existing = await models_1.EStampRequest.findOne({ _id: requestId, organizationId });
            if (!existing)
                throw ApiError_1.ApiError.notFound("Request not found");
            if (existing.status === shared_1.EStampRequestStatus.CANCELLED) {
                // Idempotent no-op: this exact cancellation already happened
                // (either an earlier call by this same actor, or a concurrent
                // one that won the race above). Return the same object the
                // client would have gotten from the original successful call
                // - same response shape, no re-audit, no re-notify.
                return existing;
            }
            const { code, message } = conflictCodeForBlockedMutation(existing);
            throw ApiError_1.ApiError.conflict(message, code);
        }
        await models_1.EStampOrder.findOneAndUpdate({ requestId: updated._id }, { status: shared_1.OrderStatus.CANCELLED });
        await (0, audit_service_1.recordAudit)({
            actorId,
            actorRole: actorRole || "UNKNOWN",
            organizationId,
            action: shared_2.AuditAction.ESTAMP_REQUEST_CANCELLED,
            entityType: "EStampRequest",
            entityId: updated._id.toString(),
            req,
        });
        if (actorRole === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
            await (0, notification_service_1.notifyAllMasterAdmins)({
                type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
                title: "E-Stamp request cancelled",
                message: `Assistant Master Admin cancelled E-Stamp request ${updated.requestNumber}.`,
                relatedActorId: actorId,
                organizationId,
            });
        }
        // NOTE: Phase 4 does not auto-refund to wallet on cancellation - refund
        // policy must be confirmed against Terms/No-Refund policy before
        // implementing automatic reversal. This is a deliberate, documented
        // business-decision gap, not an oversight - see module 12/19 of the
        // phase spec. The wallet debit made at creation time is left untouched.
        return updated;
    },
    // Phase 12 hardening: the old version did find() then, per document, a
    // blind `request.status = LOCKED; await request.save()` - itself a
    // check-then-act race against a concurrent modify/cancel. If a cancel
    // committed between this cron's find() and its save(), the cron's save
    // (on a stale in-memory doc still showing MODIFICATION_WINDOW) could
    // overwrite that legitimate concurrent cancellation back to LOCKED,
    // silently undoing it. Fixed the same way as modify/cancel: each
    // candidate is locked via its OWN atomic conditional update, re-checking
    // status+deadline at write time - a candidate that lost the race to a
    // concurrent cancel/modify simply fails to match (locked === null) and is
    // skipped, never overwritten.
    async lockExpiredRequests() {
        const now = new Date();
        const expired = await models_1.EStampRequest.find({
            status: shared_1.EStampRequestStatus.MODIFICATION_WINDOW,
            modificationDeadline: { $lte: now },
        });
        let lockedCount = 0;
        for (const candidate of expired) {
            const locked = await models_1.EStampRequest.findOneAndUpdate({
                _id: candidate._id,
                status: shared_1.EStampRequestStatus.MODIFICATION_WINDOW,
                modificationDeadline: { $lte: now },
            }, { $set: { status: shared_1.EStampRequestStatus.LOCKED, lockedAt: now } }, { new: true });
            if (!locked)
                continue; // lost the race to a concurrent cancel/modify - do NOT overwrite whatever it became
            // Keep the linked order's processing state in sync: it becomes
            // ready-for-submission the moment its request locks, without
            // waiting for a separate admin action to notice.
            await models_1.EStampOrder.findOneAndUpdate({ requestId: locked._id, eStampStatus: shared_1.EStampRequestStatus.MODIFICATION_WINDOW }, { eStampStatus: shared_2.EStampOrderProcessingStatus.CREATED });
            // Phase 15 - this cron performs a real lifecycle mutation
            // (MODIFICATION_WINDOW -> LOCKED) but previously only logged an
            // aggregate count, with no investigable per-request trail.
            // System-attributed (actorId null, never a fabricated human id) -
            // "SYSTEM_CRON" extends the same magic-actorRole-string
            // convention already used for "SYSTEM_WEBHOOK", plus the new
            // actorType field for clean filtering.
            await (0, audit_service_1.recordAudit)({
                actorId: null,
                actorRole: "SYSTEM_CRON",
                actorType: "SYSTEM",
                organizationId: locked.organizationId,
                action: shared_2.AuditAction.ESTAMP_REQUEST_LOCKED,
                entityType: "EStampRequest",
                entityId: locked._id.toString(),
                metadata: { modificationDeadline: locked.modificationDeadline },
            });
            lockedCount += 1;
        }
        return lockedCount;
    },
    // Submits an order to the E-Stamp provider. Safe under retries, restarts,
    // and concurrent invocations - see the 14-step contract in the Phase 7
    // spec. Never touches the wallet (that happened once, at request
    // creation) and never fabricates a success/issued result.
    async processOrder(orderId, organizationId, actorId, actorRole, req) {
        const { order, request } = await loadOwnedOrder(orderId, organizationId, actorRole);
        // Idempotent no-op: already reached a terminal outcome. Checked
        // BEFORE the request-status guards below - by the time an order is
        // ISSUED/FAILED, its request has already moved to COMPLETED/FAILED
        // too (see applyProviderResult), which would otherwise trip the
        // "must be locked" guard and turn a harmless retry-of-a-finished-
        // order into a hard error instead of a no-op.
        if (order.eStampStatus === shared_2.EStampOrderProcessingStatus.ISSUED || order.eStampStatus === shared_2.EStampOrderProcessingStatus.FAILED) {
            return { order, request, alreadyTerminal: true };
        }
        if (request.status === shared_1.EStampRequestStatus.CANCELLED || request.status === shared_1.EStampRequestStatus.FAILED) {
            throw ApiError_1.ApiError.conflict("Cannot process a cancelled or failed request", "INVALID_STATE_TRANSITION");
        }
        if (![shared_1.EStampRequestStatus.LOCKED, shared_1.EStampRequestStatus.PROCESSING].includes(request.status)) {
            throw ApiError_1.ApiError.conflict("Request must be locked (modification window closed) before it can be submitted for processing", "INVALID_STATE_TRANSITION");
        }
        // Already submitted (has a provider reference) - do NOT submit again.
        // A retry in this state must go through sync (checkStatus) to
        // determine what actually happened, per the provider-timeout /
        // unknown-result handling requirement - never blindly resubmit.
        if (order.providerReference) {
            return this.syncEStampOrderStatus(orderId, organizationId, actorId, actorRole, req);
        }
        // Atomic claim: only ONE concurrent call can move CREATED -> SUBMITTING
        // for this order. A second, simultaneous call sees matchedCount 0 and
        // treats itself as "someone else is already submitting this" rather
        // than racing to call the provider twice.
        const claimed = await models_1.EStampOrder.findOneAndUpdate({ _id: order._id, eStampStatus: shared_2.EStampOrderProcessingStatus.CREATED }, { eStampStatus: shared_2.EStampOrderProcessingStatus.SUBMITTING, $inc: { retryCount: 1 } }, { new: true });
        if (!claimed) {
            // Lost the race, or not in a submittable state - re-read and
            // report the current (authoritative) state rather than erroring.
            const current = await models_1.EStampOrder.findById(order._id);
            return { order: current, request, alreadySubmitting: true };
        }
        if (request.status !== shared_1.EStampRequestStatus.PROCESSING) {
            request.status = shared_1.EStampRequestStatus.PROCESSING;
            await request.save();
        }
        const provider = (0, estamp_providers_1.getEStampProvider)();
        let result;
        try {
            result = await provider.issueEStamp({
                requestId: request._id.toString(),
                organizationId: request.organizationId.toString(),
                stateCode: request.stateCode,
                articleCode: request.articleId.toString(),
                firstParty: request.firstParty,
                secondParty: request.secondParty,
                considerationPrice: request.considerationPrice,
                stampDutyAmount: request.calculatedStampDuty,
                // Stable per-order key - a real provider that supports
                // idempotency keys receives the SAME value on every retry of
                // this same order, never a fresh random one.
                idempotencyKey: claimed._id.toString(),
            });
        }
        catch (err) {
            // Provider call failed/timed out. We do NOT know whether the
            // provider actually received and accepted it before the failure -
            // leaving the order in SUBMITTING (not FAILED) is deliberate: a
            // future sync/retry can still resolve the true outcome instead of
            // this code guessing "rejected" and potentially causing a
            // duplicate submission later.
            claimed.providerRawStatus = "SUBMIT_ERROR";
            claimed.failureReason = err?.message ? String(err.message).slice(0, 500) : "Provider submission failed";
            await claimed.save();
            await (0, audit_service_1.recordAudit)({
                actorId, actorRole: actorRole || "UNKNOWN", organizationId: order.organizationId.toString(),
                action: shared_2.AuditAction.ESTAMP_PROCESSING_FAILED, entityType: "EStampOrder", entityId: order._id.toString(),
                metadata: { stage: "submit", reason: "provider_call_error" }, req,
            });
            return { order: claimed, request, uncertain: true };
        }
        assertOrderTransition(shared_2.EStampOrderProcessingStatus.SUBMITTING, shared_2.EStampOrderProcessingStatus.SUBMITTED);
        claimed.providerReference = result.providerReference;
        claimed.providerRawStatus = result.status;
        claimed.eStampStatus = shared_2.EStampOrderProcessingStatus.SUBMITTED;
        claimed.submittedAt = new Date();
        await claimed.save();
        await (0, audit_service_1.recordAudit)({
            actorId, actorRole: actorRole || "UNKNOWN", organizationId: order.organizationId.toString(),
            action: shared_2.AuditAction.ORDER_MODIFIED, entityType: "EStampOrder", entityId: order._id.toString(),
            metadata: { stage: "submitted", providerReference: result.providerReference }, req,
        });
        if (actorRole === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
            await (0, notification_service_1.notifyAllMasterAdmins)({
                type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
                title: "E-Stamp order submitted for processing",
                message: `Assistant Master Admin submitted order ${order.orderNumber} to the E-Stamp provider.`,
                relatedActorId: actorId,
                organizationId: order.organizationId.toString(),
            });
        }
        return { order: claimed, request };
    },
    // Confirms the actual current status of a previously-submitted order.
    // This is the ONLY path by which an order can ever reach ISSUED/FAILED -
    // never inferred, never assumed from a client callback.
    async syncEStampOrderStatus(orderId, organizationId, actorId, actorRole, req) {
        const { order, request } = await loadOwnedOrder(orderId, organizationId, actorRole);
        if (!order.providerReference) {
            throw ApiError_1.ApiError.badRequest("Order has not been submitted to the provider yet", "NOT_SUBMITTED");
        }
        if (order.eStampStatus === shared_2.EStampOrderProcessingStatus.ISSUED || order.eStampStatus === shared_2.EStampOrderProcessingStatus.FAILED) {
            // Idempotent: terminal state already reached, duplicate sync/webhook is a no-op.
            return { order, request, alreadyTerminal: true };
        }
        const provider = (0, estamp_providers_1.getEStampProvider)();
        const result = await provider.checkStatus(order.providerReference);
        return applyProviderResult(order, request, result, actorId, actorRole, req);
    },
    // Operator-triggered retry of a stuck/uncertain order. Reuses processOrder
    // exactly - it is already idempotent/retry-safe (atomic claim, no
    // re-submission once a provider reference exists), so a dedicated retry
    // codepath would only duplicate that logic.
    async retryOrder(orderId, organizationId, actorId, actorRole, req) {
        return this.processOrder(orderId, organizationId, actorId, actorRole, req);
    },
    // Handles an inbound E-Stamp provider webhook. `rawBody`/`signatureHeader`
    // are verified via the PROVIDER'S OWN webhook-verification method, kept
    // isolated inside the provider adapter (see estamp-providers) rather than
    // invented here - for the mock provider this is a clearly test/dev-only
    // scheme; a real provider's actual signature scheme is unknown and its
    // adapter throws rather than fabricate one (see RealEStampProvider).
    // The order is identified ONLY by the provider's own reference/
    // correlation id in the verified payload - organizationId is never taken
    // from the webhook body.
    async handleProviderWebhook(rawBody, signatureHeader) {
        const provider = (0, estamp_providers_1.getEStampProvider)();
        if (typeof provider.verifyWebhookSignature !== "function") {
            throw ApiError_1.ApiError.notImplemented("This E-Stamp provider does not support webhook verification", "ESTAMP_PROVIDER_NOT_CONFIGURED");
        }
        if (!signatureHeader || !provider.verifyWebhookSignature(rawBody, signatureHeader)) {
            throw ApiError_1.ApiError.unauthorized("Invalid E-Stamp provider webhook signature");
        }
        const payload = JSON.parse(rawBody.toString("utf8"));
        const providerReference = payload?.providerReference;
        if (!providerReference) {
            return { handled: false, reason: "missing_provider_reference" };
        }
        const order = await models_1.EStampOrder.findOne({ providerReference });
        if (!order) {
            // Unknown/foreign reference - never throw (the provider would
            // retry a failing webhook indefinitely); acknowledge and stop.
            return { handled: false, reason: "unknown_order" };
        }
        const request = await models_1.EStampRequest.findById(order.requestId);
        if (!request || request.orderId?.toString() !== order._id.toString()) {
            return { handled: false, reason: "inconsistent_order" };
        }
        if (order.eStampStatus === shared_2.EStampOrderProcessingStatus.ISSUED || order.eStampStatus === shared_2.EStampOrderProcessingStatus.FAILED) {
            return { handled: true, alreadyProcessed: true, orderId: order._id };
        }
        const result = { status: payload.status, rawResponse: payload };
        const outcome = await applyProviderResult(order, request, result, null, "SYSTEM_WEBHOOK", undefined);
        return { handled: true, orderId: order._id, status: outcome.order.eStampStatus };
    },
    async issueEStamp(requestId) {
        const request = await models_1.EStampRequest.findById(requestId);
        if (!request)
            throw ApiError_1.ApiError.notFound("Request not found");
        assertTransition(request.status, shared_1.EStampRequestStatus.PROCESSING);
        request.status = shared_1.EStampRequestStatus.PROCESSING;
        await request.save();
        const provider = (0, estamp_providers_1.getEStampProvider)();
        const result = await provider.issueEStamp({
            requestId: request._id.toString(),
            organizationId: request.organizationId.toString(),
            stateCode: request.stateCode,
            articleCode: request.articleId.toString(),
            firstParty: request.firstParty,
            secondParty: request.secondParty,
            considerationPrice: request.considerationPrice,
            stampDutyAmount: request.calculatedStampDuty,
        });
        if (result.status === "ISSUED") {
            request.status = shared_1.EStampRequestStatus.COMPLETED;
            await request.save();
        }
        else if (result.status === "FAILED") {
            request.status = shared_1.EStampRequestStatus.FAILED;
            await request.save();
        }
        return { request, providerResult: result };
    },
};
