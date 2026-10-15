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
const estamp_notifications_1 = require("./estamp-notifications");
const settings_service_1 = require("./settings.service");
const policy_service_1 = require("./policy.service");
const Policy_1 = require("../models/Policy");
const shared_2 = require("@launcherdesk/shared");
const sequence_1 = require("../utils/sequence");
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
    // A dedicated Counter document per prefix (LDE-REQ, LDE-ORD), atomically
    // incremented - the first request/order ever created (or the first
    // after a reset) is numbered 1, not a random suffix.
    const year = new Date().getFullYear();
    const seq = await (0, sequence_1.nextSequence)(prefix);
    return `${prefix}-${year}-${seq}`;
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
        // eventKey-gated: at most one "issued" notification/email per order.
        await (0, estamp_notifications_1.notifyOrderIssued)(order, request, actorId);
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
        await (0, estamp_notifications_1.notifyOrderFailed)(order, request, actorId);
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
            manualStampDuty: input.manualStampDuty,
            additionalAmount: input.additionalAmount,
            numberOfEStamps: input.numberOfEStamps,
        });
        if (!amount || amount <= 0) {
            throw ApiError_1.ApiError.badRequest("Stamp duty rate is not configured for this article. Please select a configured article or contact your administrator.", "DUTY_NOT_CONFIGURED");
        }
        // RESERVE (not debit) FIRST, atomically and conditionally on the
        // available balance (balance - reservedBalance) - nothing is spent
        // until the modification window closes (see chargeRequest). If this
        // fails, no request/order is created. Every failure path below that
        // does not end in a created request releases this reservation.
        const reserve = await (0, wallet_service_1.reserveFunds)({ organizationId: input.organizationId, amount });
        if (!reserve.success) {
            throw ApiError_1.ApiError.badRequest("Insufficient balance. Please add funds to continue.", "INSUFFICIENT_BALANCE");
        }
        const releaseOurReservation = () => (0, wallet_service_1.releaseReservation)({ organizationId: input.organizationId, amount });
        // Phase 17 - read live from SettingsService (DB override if present
        // and valid, else the registry default which mirrors env.js's
        // current default exactly) rather than the frozen-at-boot env value.
        // Deliberately read ONLY here, at creation time, to compute a FIXED
        // modificationDeadline stored on the request - a later setting
        // change must only affect requests created after the change, never
        // retroactively alter an already-created request's stored deadline
        // (exactly like changing env.REQUEST_MODIFY_WINDOW_MINUTES today
        // would only affect a fresh process's future requests).
        let request;
        try {
            const requestNumber = await nextSequenceNumber("LDE-REQ");
            const requestModifyWindowMinutes = await settings_service_1.SettingsService.getRequestModifyWindowMinutes();
            const modificationDeadline = new Date(Date.now() + requestModifyWindowMinutes * 60 * 1000);
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
                // A bulk row has no considerationPrice (it enters the duty
                // directly) - store the typed stamp duty amount in this field
                // instead, same precedent as a CUSTOM-rule article's
                // considerationPrice already being "the filer's entered duty".
                considerationPrice: input.manualStampDuty !== undefined && input.manualStampDuty !== null ? input.manualStampDuty : input.considerationPrice,
                stampDutyPaidBy: input.stampDutyPaidBy,
                numberOfEStamps: input.numberOfEStamps,
                extraFields: input.extraFields,
                calculatedStampDuty: amount,
                status: shared_1.EStampRequestStatus.MODIFICATION_WINDOW,
                modificationDeadline,
                idempotencyKey: input.idempotencyKey,
                chargeStatus: "RESERVED",
                reservedAmount: amount,
            });
        }
        catch (err) {
            // Whatever went wrong, this call did not create a request, so its
            // reservation must not stay held.
            await releaseOurReservation();
            // A concurrent request with the SAME idempotencyKey won this race -
            // hand back the request the winner created (which holds its own
            // reservation) instead of surfacing a raw duplicate-key error for
            // what is, from the caller's point of view, the exact same
            // double-submitted request.
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
            paymentStatus: "PENDING", // reserved; becomes PAID when charged at lock
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
        const buyer = await models_1.User.findById(input.createdBy);

        if (input.actorRole === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
            await (0, notification_service_1.notifyAllMasterAdmins)({
                type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
                title: "E-Stamp request created",
                message: `Assistant Master Admin created E-Stamp request ${request.requestNumber} for a client organization.`,
                relatedActorId: input.createdBy,
                organizationId: input.organizationId,
            });
        }

        // Real-time notification to all Master Admins about what was ordered
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_2.NotificationType.ESTAMP_STATUS,
            title: `New E-Stamp Order Placed: ${orderNumber}`,
            message: `${org?.name || "Client"} (${buyer?.fullName || buyer?.email || "Super Admin"}) placed E-Stamp request ${request.requestNumber} (Order ${orderNumber}) for ₹${amount}. Parties: ${request.firstParty} & ${request.secondParty}.`,
            relatedActorId: input.createdBy,
            organizationId: input.organizationId,
            metadata: {
                requestId: request._id,
                orderId: order._id,
                orderNumber,
                requestNumber: request.requestNumber,
                amount,
                organizationName: org?.name,
                buyerName: buyer?.fullName || buyer?.email,
                firstParty: request.firstParty,
                secondParty: request.secondParty,
                stateCode: request.stateCode,
            },
        });

        // ...and to the Assistant Master Admin assigned to this client, who
        // is the one that actually moves the order forward. In-app only here:
        // this runs once per row of a bulk batch, so emails are sent per
        // request by the single-request controller and once per batch by the
        // bulk flow instead of once per row.
        await (0, notification_service_1.notifyAssignedAssistant)(input.organizationId, {
            type: shared_2.NotificationType.ESTAMP_STATUS,
            title: `New E-Stamp Order Placed: ${orderNumber}`,
            message: `${org?.name || "Client"} (${buyer?.fullName || buyer?.email || "Super Admin"}) placed E-Stamp request ${request.requestNumber} (Order ${orderNumber}) for ₹${amount}. Parties: ${request.firstParty} & ${request.secondParty}.`,
            relatedActorId: input.createdBy,
            organizationId: input.organizationId,
            entityType: "EStampOrder",
            entityId: order._id,
            eventKey: `estamp-request:${request._id.toString()}:created`,
        });

        // Real-time notification to Organization Admins about what was ordered
        await (0, notification_service_1.notifyOrgAdmins)(input.organizationId, {
            type: shared_2.NotificationType.ESTAMP_STATUS,
            title: `New E-Stamp Order Placed: ${orderNumber}`,
            message: `E-Stamp request ${request.requestNumber} (Order ${orderNumber}) for ₹${amount} has been placed. Parties: ${request.firstParty} & ${request.secondParty}. Verification & modification window: 20 minutes.`,
            relatedActorId: input.createdBy,
            organizationId: input.organizationId,
            entityType: "EStampOrder",
            entityId: order._id,
            metadata: {
                requestId: request._id,
                orderId: order._id,
                orderNumber,
                requestNumber: request.requestNumber,
                amount,
            },
        });

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
        const changesAmount = updates.considerationPrice !== undefined || updates.numberOfEStamps !== undefined;
        if (changesAmount) {
            return this._modifyWithReservation(requestId, organizationId, actorId, actorRole, updates, req, now);
        }
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
    async verifyDocuments(requestId, organizationId, actorId, actorRole, notes, req) {
        const query = organizationId ? { _id: requestId, organizationId } : { _id: requestId };
        const request = await models_1.EStampRequest.findOne(query);
        if (!request) {
            throw ApiError_1.ApiError.notFound("E-Stamp request not found");
        }
        request.documentsVerified = true;
        request.verifiedBy = actorId;
        request.verifiedAt = new Date();
        if (notes) request.verificationNotes = String(notes).slice(0, 1000);
        await request.save();

        if (request.orderId) {
            await models_1.EStampOrder.findByIdAndUpdate(request.orderId, {
                documentsVerified: true,
                verifiedBy: actorId,
                verifiedAt: new Date(),
                verificationNotes: notes ? String(notes).slice(0, 1000) : undefined,
            });
        }

        await (0, audit_service_1.recordAudit)({
            actorId,
            actorRole: actorRole || "UNKNOWN",
            organizationId: request.organizationId,
            action: shared_2.AuditAction.ORDER_MODIFIED,
            entityType: "EStampRequest",
            entityId: request._id.toString(),
            metadata: { stage: "document_verification", documentsVerified: true, notes },
            req,
        });

        // Notify client / super admin that documents have been verified
        await (0, notification_service_1.notifyOrgAdmins)(request.organizationId, {
            type: shared_2.NotificationType.ESTAMP_STATUS,
            title: `Documents Verified: ${request.requestNumber}`,
            message: `Documents for E-Stamp request ${request.requestNumber} have been reviewed and confirmed correct by the administrative team.`,
            organizationId: request.organizationId,
            entityType: request.orderId ? "EStampOrder" : "EStampRequest",
            entityId: request.orderId || request._id,
            metadata: { requestId: request._id, orderId: request.orderId },
        });

        return request;
    },
    // A modify that changes considerationPrice/numberOfEStamps recalculates
    // the amount and moves the reservation by the difference:
    //   increase -> reserve the extra first (rejects INSUFFICIENT_BALANCE)
    //   decrease -> release the difference after the request is updated
    // The request update is conditional on the window still being open AND
    // reservedAmount still being the value the delta was computed from, so a
    // concurrent modify/cancel/lock can never leave the two out of step; on
    // any miss the extra reservation is given back.
    async _modifyWithReservation(requestId, organizationId, actorId, actorRole, updates, req, now) {
        const existing = await models_1.EStampRequest.findOne({ _id: requestId, organizationId });
        if (!existing)
            throw ApiError_1.ApiError.notFound("Request not found");
        if (existing.status !== shared_1.EStampRequestStatus.MODIFICATION_WINDOW || existing.modificationDeadline.getTime() <= now.getTime()) {
            const { code, message } = conflictCodeForBlockedMutation(existing);
            throw ApiError_1.ApiError.conflict(message, code);
        }
        if (existing.chargeStatus !== "RESERVED") {
            throw ApiError_1.ApiError.conflict("The amount of this request can no longer be changed", "AMOUNT_LOCKED");
        }
        const considerationPrice = updates.considerationPrice ?? existing.considerationPrice;
        const numberOfEStamps = updates.numberOfEStamps ?? existing.numberOfEStamps;
        const { amount: newAmount, articleVersionUsed } = await calculation_service_1.CalculationService.calculate({
            stateCode: existing.stateCode,
            articleId: existing.articleId.toString(),
            considerationPrice,
            numberOfEStamps,
        });
        const oldAmount = existing.reservedAmount;
        const delta = newAmount - oldAmount;
        if (delta > 0) {
            const reserve = await (0, wallet_service_1.reserveFunds)({ organizationId: existing.organizationId, amount: delta });
            if (!reserve.success) {
                throw ApiError_1.ApiError.badRequest("Insufficient balance for the new amount. Please add funds to continue.", "INSUFFICIENT_BALANCE");
            }
        }
        const updated = await models_1.EStampRequest.findOneAndUpdate({
            _id: requestId,
            organizationId,
            status: shared_1.EStampRequestStatus.MODIFICATION_WINDOW,
            modificationDeadline: { $gt: now },
            chargeStatus: "RESERVED",
            reservedAmount: oldAmount,
        }, { $set: { ...updates, considerationPrice, numberOfEStamps, calculatedStampDuty: newAmount, reservedAmount: newAmount, articleVersionUsed } }, { new: true });
        if (!updated) {
            if (delta > 0)
                await (0, wallet_service_1.releaseReservation)({ organizationId: existing.organizationId, amount: delta });
            const current = await models_1.EStampRequest.findOne({ _id: requestId, organizationId });
            if (current && current.status === shared_1.EStampRequestStatus.MODIFICATION_WINDOW && current.modificationDeadline.getTime() > Date.now()) {
                throw ApiError_1.ApiError.conflict("Request changed concurrently, please retry", "CONCURRENT_MODIFICATION");
            }
            const { code, message } = current ? conflictCodeForBlockedMutation(current) : { code: "INVALID_STATE", message: "Request is not in a modifiable state" };
            throw ApiError_1.ApiError.conflict(message, code);
        }
        if (delta < 0)
            await (0, wallet_service_1.releaseReservation)({ organizationId: existing.organizationId, amount: -delta });
        await models_1.EStampOrder.findOneAndUpdate({ requestId: updated._id }, { amount: newAmount });
        await (0, audit_service_1.recordAudit)({
            actorId,
            actorRole: actorRole || "UNKNOWN",
            organizationId,
            action: shared_2.AuditAction.ESTAMP_REQUEST_MODIFIED,
            entityType: "EStampRequest",
            entityId: updated._id.toString(),
            metadata: { updatedFields: Object.keys(updates), previousAmount: oldAmount, newAmount },
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
        // Cancelling inside the window costs nothing: give the reservation back.
        await this._releaseCancelled(updated);
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
        // Everyone told about the purchase hears it was cancelled: the client's
        // admins (their reservation is released) and the staff who would
        // otherwise go on to fulfil it.
        const cancelledOrder = await models_1.EStampOrder.findOne({ requestId: updated._id }).select("orderNumber");
        const cancelTitle = "E-Stamp request cancelled";
        const cancelMessage = `E-Stamp request ${updated.requestNumber} was cancelled within its modification window. Nothing has been charged and the reserved amount has been released.`;
        const cancelEmail = (portalPath) => ({
            method: "sendOrderStatusEmail",
            args: [{ orderNumber: cancelledOrder?.orderNumber, title: cancelTitle, message: cancelMessage, status: "Cancelled", portalPath }],
        });
        const cancelBase = {
            type: shared_2.NotificationType.ESTAMP_STATUS,
            title: cancelTitle,
            message: cancelMessage,
            relatedActorId: actorId,
            organizationId: updated.organizationId.toString(),
            entityType: "EStampRequest",
            entityId: updated._id,
            eventKey: `estamp-request:${updated._id.toString()}:cancelled`,
        };
        await (0, notification_service_1.notifyOrgAdmins)(updated.organizationId, { ...cancelBase, email: cancelEmail(`/estamps/requests/${updated._id.toString()}`) });
        const staffCancel = { ...cancelBase, eventKey: `${cancelBase.eventKey}:staff`, email: cancelEmail("/orders") };
        await (0, notification_service_1.notifyAllMasterAdmins)(staffCancel);
        await (0, notification_service_1.notifyAssignedAssistant)(updated.organizationId, staffCancel);
        // Nothing was ever debited for a request cancelled inside its window
        // (its reservation was released above). Legacy requests, debited at
        // submit before the ledger flow, are still not auto-refunded.
        return (await models_1.EStampRequest.findById(updated._id)) || updated;
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
    // Releases a cancelled request's reservation exactly once: chargeStatus
    // flips RESERVED -> RELEASED first (atomic, so only one caller wins),
    // then the wallet hold is dropped. A crash in between can only leave too
    // much held (never too little); the lock-job sweep also retries any
    // CANCELLED request still marked RESERVED.
    async _releaseCancelled(request) {
        const flipped = await models_1.EStampRequest.findOneAndUpdate({ _id: request._id, status: shared_1.EStampRequestStatus.CANCELLED, chargeStatus: "RESERVED" }, { $set: { chargeStatus: "RELEASED" } }, { new: true });
        if (!flipped)
            return false;
        await (0, wallet_service_1.releaseReservation)({ organizationId: flipped.organizationId, amount: flipped.reservedAmount || 0 });
        return true;
    },
    // Converts a LOCKED request's reservation into exactly one DEBIT ledger
    // entry (idempotency key estamp-charge:<requestId>). Safe to call any
    // number of times. On insufficient balance the request is marked
    // SHORTFALL (held from processing) and the assigned assistant - or every
    // Master Admin if none is assigned - is notified once.
    async chargeRequest(request) {
        const result = await (0, wallet_service_1.chargeReservation)({
            organizationId: request.organizationId,
            amount: request.reservedAmount || 0,
            referenceType: "ESTAMP_REQUEST",
            referenceId: request._id,
            idempotencyKey: `estamp-charge:${request._id.toString()}`,
            description: `E-Stamp request ${request.requestNumber}`,
            createdBy: null,
        });
        if (result.success) {
            const charged = await models_1.EStampRequest.findOneAndUpdate({ _id: request._id, chargeStatus: { $in: ["RESERVED", "SHORTFALL"] } }, { $set: { chargeStatus: "CHARGED", chargedAt: new Date() } }, { new: true });
            if (charged) {
                const paidOrder = await models_1.EStampOrder.findOneAndUpdate({ requestId: charged._id }, { paymentStatus: "PAID" }, { new: true });
                // Manual fulfilment: the order is now ready to stamp - tell the
                // assigned assistant (or every Master Admin) once.
                if (paidOrder && (await settings_service_1.SettingsService.getFulfilmentMode()) === "manual") {
                    await (0, estamp_notifications_1.notifyOrderToFulfil)(paidOrder);
                }
                await (0, audit_service_1.recordAudit)({
                    actorId: null,
                    actorRole: "SYSTEM_CRON",
                    actorType: "SYSTEM",
                    organizationId: charged.organizationId,
                    action: shared_2.AuditAction.BALANCE_CHANGED,
                    entityType: "EStampRequest",
                    entityId: charged._id.toString(),
                    metadata: { type: "DEBIT", amount: charged.reservedAmount, walletTransactionId: result.transaction?._id?.toString() },
                });
                // The window has closed: the request is now view-only for the
                // client. Emailed too, since this is the moment editing and
                // cancelling stop being possible.
                const chargedTitle = "E-Stamp Wallet Amount Charged";
                const chargedMessage = `20-minute window completed. ₹${charged.reservedAmount} has been deducted from your wallet for E-Stamp request ${charged.requestNumber}. The request is now locked: it can no longer be edited or cancelled, but you can still view it in the portal.`;
                await (0, notification_service_1.notifyOrgAdmins)(charged.organizationId, {
                    type: shared_2.NotificationType.PAYMENT,
                    title: chargedTitle,
                    message: chargedMessage,
                    organizationId: charged.organizationId,
                    entityType: paidOrder ? "EStampOrder" : "EStampRequest",
                    entityId: paidOrder?._id || charged._id,
                    metadata: { requestId: charged._id, orderId: paidOrder?._id, amount: charged.reservedAmount },
                    eventKey: `estamp-request:${charged._id.toString()}:charged`,
                    email: {
                        method: "sendOrderStatusEmail",
                        args: [{ orderNumber: paidOrder?.orderNumber, title: chargedTitle, message: chargedMessage, status: "Locked - view only", portalPath: `/estamps/requests/${charged._id.toString()}` }],
                    },
                });
            }
            return "CHARGED";
        }
        const short = await models_1.EStampRequest.findOneAndUpdate({ _id: request._id, chargeStatus: "RESERVED" }, { $set: { chargeStatus: "SHORTFALL" } }, { new: true });
        if (short) {
            await (0, audit_service_1.recordAudit)({
                actorId: null,
                actorRole: "SYSTEM_CRON",
                actorType: "SYSTEM",
                organizationId: short.organizationId,
                action: shared_2.AuditAction.ESTAMP_PROCESSING_FAILED,
                entityType: "EStampRequest",
                entityId: short._id.toString(),
                metadata: { stage: "charge", reason: "SHORTFALL", amount: short.reservedAmount },
            });
            const org = await models_1.Organization.findById(short.organizationId).select("name assignedAssistantId");
            const base = {
                type: shared_2.NotificationType.PAYMENT,
                title: "E-Stamp charge shortfall",
                message: `E-Stamp request ${short.requestNumber}${org ? ` (${org.name})` : ""} could not be charged: the balance is lower than the reserved ₹${short.reservedAmount}. It is on hold until the balance is corrected.`,
                organizationId: short.organizationId.toString(),
                entityType: "EStampRequest",
                entityId: short._id,
                eventKey: `estamp-charge:${short._id.toString()}:shortfall`,
            };
            if (org?.assignedAssistantId) {
                await (0, notification_service_1.notifyUser)({ ...base, recipientId: org.assignedAssistantId.toString(), recipientRole: shared_2.Role.ASSISTANT_MASTER_ADMIN });
            }
            else {
                await (0, notification_service_1.notifyAllMasterAdmins)(base);
            }
        }
        return "SHORTFALL";
    },
    // Crash-safety sweep, run on every job tick: charges any request past its
    // window that still holds a reservation - including SHORTFALL ones, so
    // they charge automatically once the balance is corrected - and releases
    // any CANCELLED request still marked RESERVED.
    async sweepReservations() {
        const pendingCharge = await models_1.EStampRequest.find({
            chargeStatus: { $in: ["RESERVED", "SHORTFALL"] },
            status: { $nin: [shared_1.EStampRequestStatus.MODIFICATION_WINDOW, shared_1.EStampRequestStatus.CANCELLED] },
        }).limit(500);
        let charged = 0;
        for (const request of pendingCharge) {
            if ((await this.chargeRequest(request)) === "CHARGED")
                charged += 1;
        }
        const cancelledHeld = await models_1.EStampRequest.find({ chargeStatus: "RESERVED", status: shared_1.EStampRequestStatus.CANCELLED }).limit(500);
        for (const request of cancelledHeld)
            await this._releaseCancelled(request);
        return charged;
    },
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
            // Window closed: the reservation becomes a real DEBIT now.
            if (locked.chargeStatus === "RESERVED")
                await this.chargeRequest(locked);
        }
        await this.sweepReservations();
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
        // Never submit to the provider before the amount is actually charged
        // (legacy requests have no chargeStatus - they were debited at submit).
        if (request.chargeStatus && request.chargeStatus !== "CHARGED") {
            throw ApiError_1.ApiError.conflict(request.chargeStatus === "SHORTFALL"
                ? "This request is on hold: the organization balance did not cover the charge"
                : "This request has not been charged yet", "CHARGE_PENDING");
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
