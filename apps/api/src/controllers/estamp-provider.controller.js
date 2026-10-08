"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsage = exports.refreshBalance = exports.getBalance = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const estamp_provider_service_1 = require("../services/estamp-provider.service");
const audit_service_1 = require("../services/audit.service");
const shared_1 = require("@launcherdesk/shared");
// Every route here is internal-platform-only (ESTAMP_PROVIDER_VIEW,
// Master-Admin-implicit / Assistant-explicit-only - see routes file). No
// client organization can ever reach these - this is the PROVIDER's own
// account information, not any organization's wallet.
exports.getBalance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const balance = await estamp_provider_service_1.EStampProviderService.getLatestBalance();
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: shared_1.AuditAction.ESTAMP_PROVIDER_BALANCE_VIEWED,
            req,
        });
    }
    return (0, ApiResponse_1.ok)(res, balance);
});
exports.refreshBalance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const balance = await estamp_provider_service_1.EStampProviderService.refreshBalance(req.user.id);
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.ESTAMP_PROVIDER_BALANCE_REFRESHED,
        metadata: { status: balance.status },
        req,
    });
    return (0, ApiResponse_1.ok)(res, balance);
});
exports.getUsage = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { from, to, organizationId, stateCode, articleId, status, groupBy } = req.query;
    const usage = await estamp_provider_service_1.EStampProviderService.getUsage({ from, to, organizationId, stateCode, articleId, status, groupBy });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: shared_1.AuditAction.ESTAMP_PROVIDER_USAGE_VIEWED,
            metadata: { from, to, organizationId, stateCode, articleId, status, groupBy },
            req,
        });
    }
    return (0, ApiResponse_1.ok)(res, usage);
});
