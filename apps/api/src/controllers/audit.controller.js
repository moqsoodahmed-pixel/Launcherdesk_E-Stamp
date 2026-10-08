"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMyAuditActivity = exports.listAuditLogs = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const ApiError_1 = require("../utils/ApiError");
const mongoose_1 = require("mongoose");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
// Phase 15 - hardening the EXISTING audit system (not a rebuild). Access
// control mirrors report.controller.js's isInternalActor/resolveScope
// pattern exactly: Master Admin is genuinely global; any OTHER actor holding
// audit.view (a tenant SUPER_ADMIN/ADMIN via their own default permissions,
// or an Assistant Master Admin via an explicit per-user grant - never
// auto-granted) is ALWAYS scoped to a single organization. Unlike reports,
// there is no audit.global_view permission in this phase - only Master
// Admin ever sees a cross-tenant view, deliberately keeping this phase's
// surface small.
function isInternalActor(req) {
    return req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
// Resolves the organizationId filter for listAuditLogs. Never trusts a
// tenant actor's query.organizationId - a forged/foreign id is silently
// ignored/overridden, never honored and never surfaced as an error (matches
// the codebase-wide existence-hiding convention: a tenant actor must never
// learn, even indirectly, whether another org's data exists).
function resolveScope(req) {
    if (req.user.role === shared_1.Role.MASTER_ADMIN) {
        const requested = req.query.organizationId;
        if (requested) {
            if (!mongoose_1.Types.ObjectId.isValid(requested)) {
                throw ApiError_1.ApiError.badRequest("Invalid organizationId", "INVALID_ORGANIZATION_ID");
            }
            return { organizationId: requested, isGlobal: false };
        }
        return { organizationId: undefined, isGlobal: true };
    }
    if (isInternalActor(req)) {
        // Assistant Master Admin holding an explicit audit.view grant - never
        // a silent global fallback; must name exactly one organization.
        const requested = req.query.organizationId;
        if (!requested) {
            throw ApiError_1.ApiError.badRequest("organizationId is required", "ORGANIZATION_ID_REQUIRED");
        }
        if (!mongoose_1.Types.ObjectId.isValid(requested)) {
            throw ApiError_1.ApiError.badRequest("Invalid organizationId", "INVALID_ORGANIZATION_ID");
        }
        return { organizationId: requested, isGlobal: false };
    }
    // Tenant actor (SUPER_ADMIN/ADMIN holding audit.view via their own role
    // defaults) - always their own organization, full stop. query.organizationId
    // is never read for this branch, so a forged value has no effect at all.
    return { organizationId: req.user.organizationId, isGlobal: false };
}
const SORT_FIELDS = ["createdAt", "action", "actorRole", "actorType", "entityType"];
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
// Same max-range constant already used by report.service.js/estamp-provider.service.js -
// reused here for consistency rather than inventing a different number.
const MAX_AUDIT_RANGE_DAYS = 366;
function parsePagination(query) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
    return { page, limit };
}
function parseDateRange(query) {
    const { dateFrom, dateTo } = query;
    if (!dateFrom && !dateTo)
        return undefined;
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
        throw ApiError_1.ApiError.badRequest("Invalid date range", "INVALID_DATE_RANGE");
    }
    if (from && to && from.getTime() > to.getTime()) {
        throw ApiError_1.ApiError.badRequest("`dateFrom` must not be after `dateTo`", "INVALID_DATE_RANGE");
    }
    if (from && to && to.getTime() - from.getTime() > MAX_AUDIT_RANGE_DAYS * 24 * 60 * 60 * 1000) {
        throw ApiError_1.ApiError.badRequest(`Date range cannot exceed ${MAX_AUDIT_RANGE_DAYS} days`, "RANGE_TOO_LARGE");
    }
    const range = {};
    if (from)
        range.$gte = from;
    if (to)
        range.$lte = to;
    return range;
}
function parseSort(query) {
    const sortBy = SORT_FIELDS.includes(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortDir === "asc" ? 1 : -1;
    return { [sortBy]: sortDir };
}
// Master Admin: global audit visibility (or scoped, if explicitly filtered
// by organizationId). Any other actor holding audit.view: always scoped to
// exactly one organization (see resolveScope). Assistant Master Admin
// visibility into their OWN activity, regardless of audit.view, is exposed
// separately via /audit/mine.
exports.listAuditLogs = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { organizationId } = resolveScope(req);
    const { action, actorId, actorRole, actorType, entityType, entityId } = req.query;
    const filter = {};
    if (organizationId)
        filter.organizationId = organizationId;
    if (action) {
        if (!Object.values(shared_1.AuditAction).includes(action)) {
            throw ApiError_1.ApiError.badRequest("Invalid action filter", "INVALID_ACTION");
        }
        filter.action = action;
    }
    if (actorId) {
        if (!mongoose_1.Types.ObjectId.isValid(actorId)) {
            throw ApiError_1.ApiError.badRequest("Invalid actorId", "INVALID_ACTOR_ID");
        }
        filter.actorId = actorId;
    }
    if (actorRole)
        filter.actorRole = actorRole;
    if (actorType) {
        if (!["USER", "SYSTEM"].includes(actorType)) {
            throw ApiError_1.ApiError.badRequest("Invalid actorType filter", "INVALID_ACTOR_TYPE");
        }
        filter.actorType = actorType;
    }
    if (entityType)
        filter.entityType = entityType;
    if (entityId)
        filter.entityId = entityId;
    const dateRange = parseDateRange(req.query);
    if (dateRange)
        filter.createdAt = dateRange;
    const { page, limit } = parsePagination(req.query);
    const sort = parseSort(req.query);
    const [items, total] = await Promise.all([
        models_1.AuditLog.find(filter)
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit),
        models_1.AuditLog.countDocuments(filter),
    ]);
    return (0, ApiResponse_1.ok)(res, { items, total, page, limit });
});
// Hard-scoped to the caller's own actorId - inherently tenant-safe (no
// organizationId filter needed, nothing to forge), so this is intentionally
// available to ANY authenticated user, with no permission gate.
exports.listMyAuditActivity = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { page, limit } = parsePagination(req.query);
    const filter = { actorId: req.user.id };
    const [items, total] = await Promise.all([
        models_1.AuditLog.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        models_1.AuditLog.countDocuments(filter),
    ]);
    return (0, ApiResponse_1.ok)(res, { items, total, page, limit });
});
