"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.manualCredit = exports.listTransactions = exports.getBalance = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const models_1 = require("../models");
const wallet_service_1 = require("../services/wallet.service");
const audit_service_1 = require("../services/audit.service");
const notification_service_1 = require("../services/notification.service");
const shared_1 = require("@launcherdesk/shared");
const uuid_1 = require("uuid");
const orgAccess_1 = require("../utils/orgAccess");
const ApiError_1 = require("../utils/ApiError");
// Internal actors name the organization in the URL and must be allowed to
// act on it (Master Admin: any; Assistant: assigned only). Tenant actors
// always get their own organization.
async function resolveOrgId(req) {
    const isInternal = req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
    if (isInternal) {
        await (0, orgAccess_1.assertCanActOnOrganization)(req, req.params.organizationId);
        return req.params.organizationId;
    }
    const orgId = req.user.organizationId;
    // An internal actor has no organization of their own - without an
    // explicit, valid target this must be a 400, never an implicit
    // (auto-creating) wallet lookup against `undefined`.
    if (!orgId || !require("mongoose").Types.ObjectId.isValid(orgId)) {
        throw require("../utils/ApiError").ApiError.badRequest("A valid organizationId is required", "INVALID_ORGANIZATION_ID");
    }
    return orgId;
}
exports.getBalance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = await resolveOrgId(req);
    const summary = await (0, wallet_service_1.getWalletSummary)(organizationId);
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            organizationId,
            action: shared_1.AuditAction.BALANCE_VIEWED,
            req,
        });
    }
    // balance = ledger balance; availableBalance = what new requests may
    // reserve (balance minus amounts held for requests in their window).
    return (0, ApiResponse_1.ok)(res, {
        organizationId,
        balance: summary.balance,
        reservedBalance: summary.reservedBalance,
        availableBalance: summary.availableBalance,
    });
});
exports.listTransactions = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = await resolveOrgId(req);
    const { page = "1", limit = "20" } = req.query;
    // Phase 19 - cap client-supplied `limit`, same pattern as the other list
    // endpoints (order/payment/user/notification/audit controllers).
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const items = await models_1.WalletTransaction.find({ organizationId })
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum);
    const total = await models_1.WalletTransaction.countDocuments({ organizationId });
    return (0, ApiResponse_1.ok)(res, { items, total, page: pageNum, limit: limitNum });
});
// Master Admin / Assistant Master Admin manually adding credit to a client's
// balance (e.g. offline payment reconciliation). Distinct from the automated
// Razorpay flow, but goes through the exact same atomic wallet service.
exports.manualCredit = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await (0, orgAccess_1.assertCanActOnOrganization)(req, req.params.organizationId);
    const organizationId = req.params.organizationId;
    const { amount } = req.body;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)
        throw ApiError_1.ApiError.badRequest("amount must be positive", "INVALID_AMOUNT");
    // A manual credit (offline transfer, correction) must say why.
    const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
    if (description.length < 3 || description.length > 500) {
        throw ApiError_1.ApiError.badRequest("A description/reference (3-500 characters) is required for a manual credit", "DESCRIPTION_REQUIRED");
    }
    const transaction = await (0, wallet_service_1.creditWallet)({
        organizationId,
        amount,
        referenceType: "MANUAL_ADJUSTMENT",
        idempotencyKey: `manual:${(0, uuid_1.v4)()}`,
        description,
        createdBy: req.user.id,
    });
    const wallet = await models_1.Wallet.findOne({ organizationId });
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId,
        action: shared_1.AuditAction.BALANCE_CHANGED,
        metadata: { type: "CREDIT", source: "manual", amount, walletTransactionId: transaction?._id?.toString() },
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Client balance changed",
            message: `Assistant Master Admin credited ₹${amount} to organization balance.`,
            relatedActorId: req.user.id,
            organizationId,
        });
    }
    return (0, ApiResponse_1.ok)(res, { transaction, balance: wallet?.balance });
});
