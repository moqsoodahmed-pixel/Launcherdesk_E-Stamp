"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInternalRole = isInternalRole;
exports.getAccessibleOrganizationIds = getAccessibleOrganizationIds;
exports.canAccessOrganization = canAccessOrganization;
exports.assertCanActOnOrganization = assertCanActOnOrganization;
exports.scopeOrganizationFilter = scopeOrganizationFilter;
const mongoose_1 = require("mongoose");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const ApiError_1 = require("./ApiError");
// The ONE place that decides which client organizations an internal actor
// may see or act on:
//   MASTER_ADMIN           -> every organization
//   ASSISTANT_MASTER_ADMIN -> only organizations whose assignedAssistantId is
//                             that assistant (none assigned = none visible)
// Tenant roles are scoped to their own organization elsewhere (they never
// reach these helpers with a foreign id).
function isInternalRole(role) {
    return role === shared_1.Role.MASTER_ADMIN || role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
// null = unrestricted (Master Admin). Otherwise an array of ObjectIds.
async function getAccessibleOrganizationIds(req) {
    if (req.user.role === shared_1.Role.MASTER_ADMIN)
        return null;
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        if (req._accessibleOrgIds)
            return req._accessibleOrgIds;
        const orgs = await models_1.Organization.find({ assignedAssistantId: req.user.id }).select("_id");
        req._accessibleOrgIds = orgs.map((o) => o._id);
        return req._accessibleOrgIds;
    }
    return req.user.organizationId ? [new mongoose_1.Types.ObjectId(req.user.organizationId)] : [];
}
async function canAccessOrganization(req, organizationId) {
    if (!organizationId)
        return false;
    const ids = await getAccessibleOrganizationIds(req);
    if (ids === null)
        return true;
    const target = organizationId.toString();
    return ids.some((id) => id.toString() === target);
}
// Throws 400 for a malformed id, 404 if the organization does not exist,
// 403 if it exists but this actor may not act on it. Returns the org.
async function assertCanActOnOrganization(req, organizationId) {
    if (!organizationId || !mongoose_1.Types.ObjectId.isValid(organizationId.toString())) {
        throw ApiError_1.ApiError.badRequest("A valid organizationId is required", "INVALID_ORGANIZATION_ID");
    }
    const org = await models_1.Organization.findById(organizationId);
    if (!org)
        throw ApiError_1.ApiError.notFound("Organization not found");
    if (!(await canAccessOrganization(req, org._id))) {
        throw ApiError_1.ApiError.forbidden("This organization is not assigned to you");
    }
    return org;
}
// Narrows a list filter's organizationId for an internal actor. `requested`
// is an optional organizationId from the query string. Master Admin: the
// requested org or everything. Assistant: the requested org only if assigned
// (otherwise an empty result), else all assigned orgs.
async function scopeOrganizationFilter(req, filter, requested) {
    if (requested !== undefined && requested !== null && requested !== "") {
        if (!mongoose_1.Types.ObjectId.isValid(String(requested)))
            throw ApiError_1.ApiError.badRequest("Invalid organizationId", "INVALID_ORGANIZATION_ID");
    }
    const ids = await getAccessibleOrganizationIds(req);
    if (ids === null) {
        if (requested)
            filter.organizationId = new mongoose_1.Types.ObjectId(String(requested));
        return filter;
    }
    if (requested) {
        const allowed = ids.some((id) => id.toString() === String(requested));
        filter.organizationId = allowed ? new mongoose_1.Types.ObjectId(String(requested)) : { $in: [] };
    }
    else {
        filter.organizationId = { $in: ids };
    }
    return filter;
}
// Route middleware form: guards routes whose `:param` is an organization id.
function requireOrganizationParamAccess(param = "id") {
    return (req, _res, next) => {
        assertCanActOnOrganization(req, req.params[param]).then(() => next(), next);
    };
}
exports.requireOrganizationParamAccess = requireOrganizationParamAccess;
