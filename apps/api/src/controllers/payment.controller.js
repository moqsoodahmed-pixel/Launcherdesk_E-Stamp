"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.razorpayWebhook = exports.getPayment = exports.listPayments = exports.verifyRazorpayPayment = exports.createRazorpayOrder = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const payment_service_1 = require("../services/payment.service");
const models_1 = require("../models");
const audit_service_1 = require("../services/audit.service");
const notification_service_1 = require("../services/notification.service");
const ApiError_1 = require("../utils/ApiError");
const shared_1 = require("@launcherdesk/shared");
const mongoose_1 = require("mongoose");
function isInternalActor(req) {
    return req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
// organizationId is NEVER trusted from a tenant actor's request body - only
// an internal actor (already permission-gated) may specify which
// organization a payment/order belongs to.
function resolveOrgId(req) {
    return isInternalActor(req) ? req.query.organizationId || req.body.organizationId : req.user.organizationId;
}
exports.createRazorpayOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveOrgId(req);
    if (!organizationId)
        throw ApiError_1.ApiError.badRequest("organizationId is required");
    const { amount } = req.body;
    const result = await payment_service_1.PaymentService.createOrder({ organizationId, userId: req.user.id, amount });
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId,
        action: shared_1.AuditAction.PAYMENT_VIEWED,
        entityType: "Payment",
        entityId: result.paymentId.toString(),
        metadata: { action: "order_created", amount },
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Wallet funding order created",
            message: `Assistant Master Admin created a wallet funding order of ₹${amount} for a client organization.`,
            relatedActorId: req.user.id,
            organizationId,
        });
    }
    return (0, ApiResponse_1.created)(res, result);
});
exports.verifyRazorpayPayment = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    // Tenant actors may only ever verify a payment that belongs to their own
    // organization. Checked BEFORE any signature verification/wallet credit
    // happens - this must fail closed, not merely be checked after the fact,
    // so a tenant actor can never even attempt to verify someone else's
    // order id (which matters especially in non-production/mock mode, where
    // the mock signature scheme uses a fixed, publicly-known dev secret).
    const existing = await models_1.Payment.findOne({ razorpayOrderId: razorpay_order_id });
    if (!existing || (!isInternalActor(req) && existing.organizationId.toString() !== req.user.organizationId)) {
        throw ApiError_1.ApiError.notFound("Payment order not found");
    }
    let payment;
    try {
        payment = await payment_service_1.PaymentService.confirmPayment({
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature,
            userId: req.user.id,
        });
    }
    catch (err) {
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: shared_1.AuditAction.PAYMENT_VERIFIED,
            entityType: "Payment",
            entityId: razorpay_order_id,
            metadata: { result: "failed", code: err?.code },
            req,
        });
        throw err;
    }
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: payment.organizationId.toString(),
        action: shared_1.AuditAction.PAYMENT_VERIFIED,
        entityType: "Payment",
        entityId: payment._id.toString(),
        metadata: { result: "success" },
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Wallet funding payment verified",
            message: `Assistant Master Admin's wallet funding payment of ₹${payment.amount} was verified and credited.`,
            relatedActorId: req.user.id,
            organizationId: payment.organizationId.toString(),
        });
    }
    // Payment success/failure notification (in-app + email) is dispatched
    // centrally by PaymentService itself (see notifyPaymentOutcome), exactly
    // once per payment regardless of whether it's reached via this route or
    // the webhook - never duplicated here.
    return (0, ApiResponse_1.ok)(res, payment);
});
// List payments - tenant actors see only their own organization's payments;
// internal actors may filter by organizationId (never required to, unlike
// tenant actors who can never escape their own).
exports.listPayments = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { page = "1", limit = "20", status, search, dateFrom, dateTo } = req.query;
    const filter = {};
    if (isInternalActor(req)) {
        if (req.query.organizationId) {
            if (!mongoose_1.Types.ObjectId.isValid(req.query.organizationId))
                throw ApiError_1.ApiError.badRequest("Invalid organizationId", "INVALID_ORGANIZATION_ID");
            filter.organizationId = new mongoose_1.Types.ObjectId(req.query.organizationId);
        }
    }
    else {
        // Tenant actors: always their own organization, whatever the query says.
        filter.organizationId = new mongoose_1.Types.ObjectId(req.user.organizationId);
    }
    if (status) {
        if (!Object.values(shared_1.PaymentStatus).includes(status))
            throw ApiError_1.ApiError.badRequest("Invalid status filter", "INVALID_STATUS");
        filter.status = status;
    }
    if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to = dateTo ? new Date(dateTo) : null;
        if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
            throw ApiError_1.ApiError.badRequest("Invalid date range", "INVALID_DATE_RANGE");
        }
        if (from && to && from.getTime() > to.getTime()) {
            throw ApiError_1.ApiError.badRequest("`dateFrom` must not be after `dateTo`", "INVALID_DATE_RANGE");
        }
        filter.createdAt = {};
        if (from)
            filter.createdAt.$gte = from;
        if (to)
            filter.createdAt.$lte = to;
    }
    if (search) {
        // Only fields that exist on Payment itself; literal (escaped) match.
        const rx = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
        filter.$or = [{ razorpayOrderId: rx }, { razorpayPaymentId: rx }];
    }
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const [items, total] = await Promise.all([
        models_1.Payment.find(filter)
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        models_1.Payment.countDocuments(filter),
    ]);
    // Display-only organization name, internal actors only.
    let rows = items;
    if (isInternalActor(req) && items.length) {
        const orgs = await models_1.Organization.find({ _id: { $in: [...new Set(items.map((p) => p.organizationId.toString()))] } }).select("name");
        const names = new Map(orgs.map((o) => [o._id.toString(), o.name]));
        rows = items.map((p) => ({ ...p.toObject(), organizationName: names.get(p.organizationId.toString()) ?? null }));
    }
    return (0, ApiResponse_1.ok)(res, { items: rows, total, page: pageNum, limit: limitNum });
});
exports.getPayment = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const payment = await models_1.Payment.findById(req.params.id);
    // Identical "not found" for a genuinely missing payment and one that
    // belongs to another organization - existence is never confirmed to a
    // tenant actor probing another org's payment ids.
    if (!payment || (!isInternalActor(req) && payment.organizationId.toString() !== req.user.organizationId)) {
        throw ApiError_1.ApiError.notFound("Payment not found");
    }
    // The real ledger entry this payment produced (if any) - the wallet
    // effect is reported from the WalletTransaction record, never inferred
    // from payment.status alone. Only exposed to actors who may view the
    // wallet ledger.
    let walletEffect = null;
    if (req.user.permissions.includes(shared_1.Permission.WALLET_VIEW)) {
        const tx = await models_1.WalletTransaction.findOne({ referenceType: "PAYMENT", referenceId: payment._id.toString() });
        walletEffect = tx ? { type: tx.type, amount: tx.amount, balanceAfter: tx.balanceAfter, at: tx.createdAt } : { credited: false };
    }
    return (0, ApiResponse_1.ok)(res, { ...payment.toObject(), walletEffect });
});
// Razorpay server-to-server webhook. Deliberately NOT behind `authenticate` -
// Razorpay cannot present a LauncherDesk session token. Trust is established
// entirely by the webhook signature (see PaymentService.handleWebhook),
// which is the only thing standing between this route and an attacker
// forging a fake "payment succeeded" event.
exports.razorpayWebhook = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    const result = await payment_service_1.PaymentService.handleWebhook(req.rawBody, signature);
    if (result.handled && !result.alreadyProcessed) {
        await (0, audit_service_1.recordAudit)({
            actorId: null,
            actorRole: "SYSTEM_WEBHOOK",
            actorType: "SYSTEM",
            action: shared_1.AuditAction.PAYMENT_VERIFIED,
            entityType: "Payment",
            entityId: result.paymentId?.toString(),
            metadata: { source: "webhook", status: result.status },
        });
    }
    // Always 200 for anything that passed signature verification, including
    // ignored/unknown events - Razorpay retries aggressively on non-2xx, and
    // there is nothing further to do with those event types here.
    return (0, ApiResponse_1.ok)(res, { received: true });
});
