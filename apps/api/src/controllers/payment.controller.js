"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCreditSummary = exports.reconcilePayment = exports.creditBalance = exports.razorpayWebhook = exports.getPayment = exports.listPayments = exports.verifyRazorpayPayment = exports.createRazorpayOrder = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const dateRange_1 = require("../utils/dateRange");
const ApiResponse_1 = require("../utils/ApiResponse");
const payment_service_1 = require("../services/payment.service");
const models_1 = require("../models");
const audit_service_1 = require("../services/audit.service");
const notification_service_1 = require("../services/notification.service");
const ApiError_1 = require("../utils/ApiError");
const shared_1 = require("@launcherdesk/shared");
const mongoose_1 = require("mongoose");
const orgAccess_1 = require("../utils/orgAccess");
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
    if (isInternalActor(req))
        await (0, orgAccess_1.assertCanActOnOrganization)(req, organizationId);
    const { packageKey, amount, plan, stampsCount } = req.body;
    let orderParams = { organizationId, userId: req.user.id, amount, plan, stampsCount };
    // A catalog purchase NEVER trusts client-supplied amount/plan/stampsCount -
    // the server looks the package up and uses only its own price/name/count,
    // so a tampered client can never pay less than the real price or claim
    // more stamps than the package actually grants.
    if (packageKey) {
        const pkg = await models_1.EstampPackage.findOne({ key: String(packageKey).toLowerCase().trim(), isActive: true });
        if (!pkg)
            throw ApiError_1.ApiError.badRequest("Unknown or inactive package", "INVALID_PACKAGE");
        orderParams = {
            organizationId,
            userId: req.user.id,
            amount: pkg.price,
            plan: `${pkg.name} (${pkg.stampsCount} E-Stamps)`,
            stampsCount: pkg.stampsCount,
            packageKey: pkg.key,
        };
    }
    const result = await payment_service_1.PaymentService.createOrder(orderParams);
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
    if (isInternalActor(req) && !(await (0, orgAccess_1.canAccessOrganization)(req, existing.organizationId))) {
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
            message: `Assistant Master Admin's wallet funding payment of ₹${payment.amount} was verified and is waiting to be credited.`,
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
    const { page = "1", limit = "20", status, search, dateFrom, dateTo, balanceStatus } = req.query;
    const filter = {};
    if (isInternalActor(req)) {
        // Master Admin: everything (optionally one org). Assistant: only
        // assigned organizations.
        await (0, orgAccess_1.scopeOrganizationFilter)(req, filter, req.query.organizationId);
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
    // Credit queue. PENDING_CREDIT = verified, not yet added to the balance.
    // CREDITED also matches legacy SUCCESS payments that predate the field
    // (they were auto-credited at verify time).
    if (balanceStatus) {
        if (balanceStatus === "PENDING_CREDIT") {
            filter.status = shared_1.PaymentStatus.SUCCESS;
            filter.balanceStatus = "PENDING_CREDIT";
        }
        else if (balanceStatus === "CREDITED") {
            filter.status = shared_1.PaymentStatus.SUCCESS;
            filter.balanceStatus = { $ne: "PENDING_CREDIT" };
        }
        else {
            throw ApiError_1.ApiError.badRequest("Invalid balanceStatus filter", "INVALID_STATUS");
        }
    }
    if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to = dateTo ? (0, dateRange_1.parseDateTo)(dateTo) : null;
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
    // Enrich records with organization and creator (Super Admin) details.
    let rows = items;
    if (items.length) {
        const orgIds = [...new Set(items.map((p) => p.organizationId?.toString()).filter(Boolean))];
        const userIds = [...new Set(items.map((p) => p.createdBy?.toString()).filter(Boolean))];
        const [orgs, users] = await Promise.all([
            isInternalActor(req) ? models_1.Organization.find({ _id: { $in: orgIds } }).select("name") : Promise.resolve([]),
            models_1.User.find({ _id: { $in: userIds } }).select("name email role"),
        ]);
        const names = new Map(orgs.map((o) => [o._id.toString(), o.name]));
        const userMap = new Map(users.map((u) => [u._id.toString(), u]));
        rows = items.map((p) => {
            const u = userMap.get(p.createdBy?.toString());
            const isSuccess = p.status === shared_1.PaymentStatus.SUCCESS;
            const invoiceNum = p.invoiceNumber || (isSuccess ? `INV-${new Date(p.createdAt).getFullYear()}-${p._id.toString().slice(-6).toUpperCase()}` : null);
            const row = {
                ...p.toObject(),
                createdByName: u?.name ?? null,
                createdByEmail: u?.email ?? null,
                createdByRole: u?.role ?? null,
                plan: p.plan || "Wallet Top-up & E-Stamping Balance",
                transactionId: p.razorpayPaymentId || p.razorpayOrderId,
                invoiceNumber: invoiceNum,
            };
            if (isInternalActor(req)) {
                row.organizationName = names.get(p.organizationId?.toString()) || null;
            }
            return row;
        });
    }
    return (0, ApiResponse_1.ok)(res, { items: rows, total, page: pageNum, limit: limitNum });
});
exports.getPayment = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const payment = await models_1.Payment.findById(req.params.id)
        .populate("organizationId", "name contactEmail contactPhone")
        .populate("createdBy", "name email role");
    // Identical "not found" for a genuinely missing payment and one that
    // belongs to another organization - existence is never confirmed to a
    // tenant actor probing another org's payment ids.
    const paymentOrgId = payment?.organizationId?._id ? payment.organizationId._id.toString() : payment?.organizationId?.toString();
    if (!payment || (!isInternalActor(req) && paymentOrgId !== req.user.organizationId)) {
        throw ApiError_1.ApiError.notFound("Payment not found");
    }
    if (isInternalActor(req) && !(await (0, orgAccess_1.canAccessOrganization)(req, paymentOrgId))) {
        throw ApiError_1.ApiError.notFound("Payment not found");
    }
    // The real ledger entry this payment produced (if any) - the wallet
    // effect is reported from the WalletTransaction record, never inferred
    // from payment.status alone. Only exposed to actors who may view the
    // wallet ledger.
    let walletEffect = null;
    if (req.user.permissions.includes(shared_1.Permission.WALLET_VIEW)) {
        const tx = await models_1.WalletTransaction.findOne({ referenceType: "PAYMENT", referenceId: payment._id.toString(), pending: { $ne: true } });
        walletEffect = tx ? { type: tx.type, amount: tx.amount, balanceAfter: tx.balanceAfter, at: tx.createdAt } : { credited: false };
    }
    const paymentObj = payment.toObject();
    paymentObj.organizationName = payment.organizationId?.name || null;
    paymentObj.createdByName = payment.createdBy?.name || null;
    paymentObj.createdByEmail = payment.createdBy?.email || null;
    paymentObj.createdByRole = payment.createdBy?.role || null;
    paymentObj.plan = payment.plan || "Wallet Top-up & E-Stamping Balance";
    paymentObj.transactionId = payment.razorpayPaymentId || payment.razorpayOrderId;
    const isSuccess = payment.status === shared_1.PaymentStatus.SUCCESS;
    paymentObj.invoiceNumber = payment.invoiceNumber || (isSuccess ? `INV-${new Date(payment.createdAt).getFullYear()}-${payment._id.toString().slice(-6).toUpperCase()}` : null);
    return (0, ApiResponse_1.ok)(res, { ...paymentObj, walletEffect });
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
// POST /payments/:id/credit-balance - the assigned Assistant Master Admin
// (or any Master Admin) confirms a verified Razorpay payment and adds
// exactly its amount to the organization's balance. Idempotent per payment
// (see PaymentService.creditPaymentToBalance); a second call is a 409.
exports.creditBalance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!mongoose_1.Types.ObjectId.isValid(req.params.id))
        throw ApiError_1.ApiError.notFound("Payment not found");
    const existing = await models_1.Payment.findById(req.params.id).select("organizationId");
    if (!existing)
        throw ApiError_1.ApiError.notFound("Payment not found");
    await (0, orgAccess_1.assertCanActOnOrganization)(req, existing.organizationId);
    const { payment, transaction } = await payment_service_1.PaymentService.creditPaymentToBalance(req.params.id, req.user);
    const organizationId = payment.organizationId.toString();
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId,
        action: shared_1.AuditAction.BALANCE_CHANGED,
        entityType: "Payment",
        entityId: payment._id.toString(),
        metadata: { type: "CREDIT", source: "razorpay_payment", amount: payment.amount, walletTransactionId: transaction._id.toString() },
        req,
    });
    // Tell the client: the payer plus the organization's Super Admins.
    const recipients = await models_1.User.find({
        organizationId: payment.organizationId,
        isActive: true,
        $or: [{ _id: payment.createdBy }, { role: shared_1.Role.SUPER_ADMIN }],
    }).select("_id role");
    await Promise.all(recipients.map((u) => (0, notification_service_1.notifyUser)({
        recipientId: u._id.toString(),
        recipientRole: u.role,
        type: shared_1.NotificationType.PAYMENT,
        title: "Balance updated",
        message: `₹${payment.amount} from your payment ${payment.razorpayPaymentId} has been added to your balance.`,
        organizationId,
        entityType: "Payment",
        entityId: payment._id,
        eventKey: `payment:${payment._id.toString()}:credited:${u._id.toString()}`,
    })));
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Payment credited to client balance",
            message: `Assistant Master Admin credited ₹${payment.amount} (payment ${payment.razorpayPaymentId}) to a client balance.`,
            relatedActorId: req.user.id,
            organizationId,
            eventKey: `payment:${payment._id.toString()}:credited-by-assistant`,
        });
    }
    const wallet = await models_1.Wallet.findOne({ organizationId: payment.organizationId });
    return (0, ApiResponse_1.ok)(res, { payment, transaction, balance: wallet?.balance }, "Payment credited to balance");
});
// POST /payments/:id/reconcile - recovers a payment Razorpay actually
// captured but that never reached SUCCESS here, because the browser's
// checkout-verify call never completed (closed tab, dropped network right
// after paying) and the webhook either isn't registered/misconfigured or
// hasn't arrived yet. Queries Razorpay's own Orders API directly - never
// trusts anything the caller supplies about the outcome. Internal roles
// only (Master Admin / assigned Assistant Master Admin), same organization
// access rule as credit-balance.
exports.reconcilePayment = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!mongoose_1.Types.ObjectId.isValid(req.params.id))
        throw ApiError_1.ApiError.notFound("Payment not found");
    const existing = await models_1.Payment.findById(req.params.id).select("organizationId");
    if (!existing)
        throw ApiError_1.ApiError.notFound("Payment not found");
    await (0, orgAccess_1.assertCanActOnOrganization)(req, existing.organizationId);
    const result = await payment_service_1.PaymentService.reconcilePayment(req.params.id);
    if (result.reconciled) {
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            organizationId: result.payment.organizationId.toString(),
            action: shared_1.AuditAction.PAYMENT_VERIFIED,
            entityType: "Payment",
            entityId: result.payment._id.toString(),
            metadata: { source: "manual_reconciliation", result: result.reason },
            req,
        });
    }
    return (0, ApiResponse_1.ok)(res, result, result.reconciled ? "Payment reconciled with Razorpay and marked successful." : "No change - " + result.reason);
});
// GET /payments/credit-summary - "Razorpay received vs credited to
// balances". Totals over SUCCESS payments, plus pending-credit amount per
// organization. Scoped per orgAccess: Master Admin sees all organizations,
// an Assistant only assigned ones. Legacy SUCCESS payments without a
// balanceStatus were auto-credited and count as credited.
exports.getCreditSummary = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const match = { status: shared_1.PaymentStatus.SUCCESS };
    await (0, orgAccess_1.scopeOrganizationFilter)(req, match, req.query.organizationId);
    const [totals] = await models_1.Payment.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                totalReceived: { $sum: "$amount" },
                receivedCount: { $sum: 1 },
                pendingAmount: { $sum: { $cond: [{ $eq: ["$balanceStatus", "PENDING_CREDIT"] }, "$amount", 0] } },
                pendingCount: { $sum: { $cond: [{ $eq: ["$balanceStatus", "PENDING_CREDIT"] }, 1, 0] } },
            },
        },
    ]);
    const perOrg = await models_1.Payment.aggregate([
        { $match: { ...match, balanceStatus: "PENDING_CREDIT" } },
        { $group: { _id: "$organizationId", pendingAmount: { $sum: "$amount" }, pendingCount: { $sum: 1 } } },
        { $sort: { pendingAmount: -1 } },
        { $limit: 100 },
    ]);
    const orgs = perOrg.length ? await models_1.Organization.find({ _id: { $in: perOrg.map((r) => r._id) } }).select("name") : [];
    const names = new Map(orgs.map((o) => [o._id.toString(), o.name]));
    const totalReceived = totals?.totalReceived || 0;
    const pendingAmount = totals?.pendingAmount || 0;
    return (0, ApiResponse_1.ok)(res, {
        totalReceived,
        receivedCount: totals?.receivedCount || 0,
        totalCredited: totalReceived - pendingAmount,
        pendingAmount,
        pendingCount: totals?.pendingCount || 0,
        pendingByOrganization: perOrg.map((r) => ({
            organizationId: r._id,
            organizationName: names.get(r._id.toString()) ?? null,
            pendingAmount: r.pendingAmount,
            pendingCount: r.pendingCount,
        })),
    });
});
