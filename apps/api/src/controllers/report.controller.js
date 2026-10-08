"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProvider = exports.getRecentActivity = exports.getBulk = exports.getOrganizations = exports.getFinancial = exports.getOrders = exports.getRequests = exports.getSummary = exports.getDashboard = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const ApiError_1 = require("../utils/ApiError");
const report_service_1 = require("../services/report.service");
const audit_service_1 = require("../services/audit.service");
const shared_1 = require("@launcherdesk/shared");
// Thin handlers only - every aggregation lives in report.service.js. Tenant
// scoping mirrors order.controller.js's isInternalActor/resolveOrgId
// pattern exactly, with one addition: an internal actor (Assistant Master
// Admin in practice - Master Admin always holds every permission) who does
// NOT hold REPORT_GLOBAL_VIEW may never silently fall back to a platform-
// wide view merely by omitting organizationId - they must supply one
// explicitly and are scoped to exactly that org, same as a tenant actor.
function isInternalActor(req) {
    return req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
function hasGlobalView(req) {
    return req.user.permissions.includes(shared_1.Permission.REPORT_GLOBAL_VIEW);
}
// Resolves { organizationId, isGlobal } for any of the NEW granular report
// endpoints. organizationId is NEVER read from a tenant actor's request -
// only an internal actor holding REPORT_GLOBAL_VIEW may omit it for a
// genuinely platform-wide report.
function resolveScope(req) {
    if (!isInternalActor(req)) {
        return { organizationId: req.user.organizationId, isGlobal: false };
    }
    const requested = req.query.organizationId;
    if (requested) {
        return { organizationId: requested, isGlobal: false };
    }
    if (hasGlobalView(req)) {
        return { organizationId: undefined, isGlobal: true };
    }
    throw ApiError_1.ApiError.badRequest("organizationId is required (you do not hold report.global_view)", "ORGANIZATION_ID_REQUIRED");
}
function dateRangeQuery(req) {
    const { from, to, preset } = req.query;
    return { from, to, preset };
}
exports.getDashboard = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { organizationId, isGlobal } = resolveScope(req);
    const summary = await report_service_1.ReportService.getDashboardSummary({ organizationId, isGlobal });
    if (!req.user.permissions.includes(shared_1.Permission.REPORT_FINANCIAL_VIEW)) {
        summary.financial = null;
    }
    return (0, ApiResponse_1.ok)(res, summary);
});
// Phase 1 (pre-Phase-13) endpoint, kept byte-for-byte response-compatible
// so DashboardPage.jsx (which calls this with no query params, for every
// role) keeps working unchanged. Deliberately uses the ORIGINAL, simpler
// scope rule (any internal actor may pass or omit organizationId) rather
// than the newer REPORT_GLOBAL_VIEW gate below - tightening this specific
// endpoint would break the dashboard for every Assistant Master Admin who
// does not separately hold REPORT_GLOBAL_VIEW (the common case, since it is
// deliberately not in that role's default template). The new, stricter
// scope rule applies to every OTHER endpoint in this file instead.
exports.getSummary = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = isInternalActor(req) ? req.query.organizationId : req.user.organizationId;
    const summary = await report_service_1.ReportService.getLegacySummary({ organizationId });
    return (0, ApiResponse_1.ok)(res, summary);
});
exports.getRequests = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { organizationId } = resolveScope(req);
    const report = await report_service_1.ReportService.getRequestReport({ organizationId, ...dateRangeQuery(req) });
    return (0, ApiResponse_1.ok)(res, report);
});
exports.getOrders = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { organizationId } = resolveScope(req);
    const { groupBy, stateCode, articleId, status } = req.query;
    const report = await report_service_1.ReportService.getOrderReport({ organizationId, groupBy, stateCode, articleId, status, ...dateRangeQuery(req) });
    return (0, ApiResponse_1.ok)(res, report);
});
// Additionally gated by REPORT_FINANCIAL_VIEW on top of the router-level
// REPORT_VIEW - same layered inline-permission-check pattern as
// file.controller.js's ORDER_MANAGE check for certificate attachment.
exports.getFinancial = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user.permissions.includes(shared_1.Permission.REPORT_FINANCIAL_VIEW)) {
        throw ApiError_1.ApiError.forbidden("You do not have permission to view financial reports");
    }
    const { organizationId } = resolveScope(req);
    const report = await report_service_1.ReportService.getFinancialReport({ organizationId, ...dateRangeQuery(req) });
    return (0, ApiResponse_1.ok)(res, report);
});
// Additionally gated by REPORT_GLOBAL_VIEW - Master-Admin-in-practice. This
// report has no per-organization scope to fall back to (it IS the list of
// organizations), so it is refused outright rather than silently narrowed.
exports.getOrganizations = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!hasGlobalView(req)) {
        throw ApiError_1.ApiError.forbidden("You do not have permission to view the organizations report");
    }
    const { page, limit, sortBy, sortDir, status } = req.query;
    const report = await report_service_1.ReportService.getOrganizationReport({ page, limit, sortBy, sortDir, status });
    return (0, ApiResponse_1.ok)(res, report);
});
exports.getBulk = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { organizationId } = resolveScope(req);
    const report = await report_service_1.ReportService.getBulkReport({ organizationId, ...dateRangeQuery(req) });
    return (0, ApiResponse_1.ok)(res, report);
});
// Internal-platform information (the PROVIDER's own account, never a
// client's LauncherDesk wallet) - REPORT_VIEW alone must never be enough to
// see this, since ESTAMP_PROVIDER_VIEW is deliberately withheld from every
// client role's defaults elsewhere in this codebase (see
// estamp-provider.routes.js). Layering that same permission in here closes
// what would otherwise be a new, unintended path to the same data. Audited
// exactly like estamp-provider.controller.js's getBalance - only when the
// viewer is an Assistant Master Admin, using the SAME existing AuditAction.
// Phase 21 - dashboard "recent activity" widgets. Same resolveScope() rule
// as every other report here - a tenant actor is always forced to its own
// organization, an Assistant Master Admin without REPORT_GLOBAL_VIEW must
// supply one explicit organizationId, never a silent global fallback.
exports.getRecentActivity = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { organizationId, isGlobal } = resolveScope(req);
    const { limit } = req.query;
    const result = await report_service_1.ReportService.getRecentActivity({ organizationId, isGlobal, limit });
    return (0, ApiResponse_1.ok)(res, result);
});
exports.getProvider = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user.permissions.includes(shared_1.Permission.ESTAMP_PROVIDER_VIEW)) {
        throw ApiError_1.ApiError.forbidden("You do not have permission to view provider reports");
    }
    const { from, to } = req.query;
    const report = await report_service_1.ReportService.getProviderReport({ from, to });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: shared_1.AuditAction.ESTAMP_PROVIDER_BALANCE_VIEWED,
            req,
        });
    }
    return (0, ApiResponse_1.ok)(res, report);
});
