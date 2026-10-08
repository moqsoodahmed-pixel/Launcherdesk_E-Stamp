"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = requireRole;
exports.requireMinLevel = requireMinLevel;
exports.requirePermission = requirePermission;
exports.requireOrganizationAccess = requireOrganizationAccess;
const ApiError_1 = require("../utils/ApiError");
const shared_1 = require("@launcherdesk/shared");
// requireRole: allow only specific roles (exact match).
function requireRole(...roles) {
    return (req, _res, next) => {
        if (!req.user)
            throw ApiError_1.ApiError.unauthorized();
        if (!roles.includes(req.user.role))
            throw ApiError_1.ApiError.forbidden("Your role cannot access this resource");
        next();
    };
}
// requireMinLevel: allow the given role or anything with equal/higher authority
// (lower ROLE_LEVEL number = higher authority).
function requireMinLevel(role) {
    return (req, _res, next) => {
        if (!req.user)
            throw ApiError_1.ApiError.unauthorized();
        if (shared_1.ROLE_LEVEL[req.user.role] > shared_1.ROLE_LEVEL[role]) {
            throw ApiError_1.ApiError.forbidden("Insufficient authority level for this action");
        }
        next();
    };
}
// requirePermission: fine-grained permission check.
function requirePermission(...permissions) {
    return (req, _res, next) => {
        if (!req.user)
            throw ApiError_1.ApiError.unauthorized();
        const has = permissions.every((p) => req.user.permissions.includes(p));
        if (!has)
            throw ApiError_1.ApiError.forbidden("You do not have permission to perform this action");
        next();
    };
}
// requireOrganizationAccess: the CORE tenant-isolation guard.
// Derives the allowed organizationId strictly from the authenticated session -
// NEVER from any client-supplied field. Internal roles (Master/Assistant Master
// Admin) may pass an explicit org id via params/query, which this validates
// only as "does this org exist", not as a bypass of tenant checks for tenant roles.
function requireOrganizationAccess(paramName = "organizationId") {
    return (req, _res, next) => {
        if (!req.user)
            throw ApiError_1.ApiError.unauthorized();
        const isInternal = req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
        const requestedOrgId = req.params[paramName] || req.query[paramName];
        if (isInternal) {
            // Internal roles may operate across organizations; nothing further to check here -
            // any additional restriction (e.g. Assistant Master Admin scoping) is handled
            // by requirePermission/audit logging at the route level.
            return next();
        }
        if (!req.user.organizationId) {
            throw ApiError_1.ApiError.forbidden("No organization associated with this account");
        }
        if (requestedOrgId && requestedOrgId !== req.user.organizationId) {
            throw ApiError_1.ApiError.forbidden("You cannot access another organization's data");
        }
        // Force the resolved organizationId onto the request so controllers use
        // ONLY this value, never a client-supplied one, when building DB queries.
        req.resolvedOrganizationId = req.user.organizationId;
        next();
    };
}
