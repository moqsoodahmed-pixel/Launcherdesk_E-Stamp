"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateMyProfile = exports.getMyOrganization = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const audit_service_1 = require("../services/audit.service");
const shared_1 = require("@launcherdesk/shared");

// GET /profile/organization: the logged-in user's OWN organization (read-only).
// The organization id comes only from the session, never from the request.
exports.getMyOrganization = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user.organizationId) {
        throw ApiError_1.ApiError.notFound("Your account is not linked to an organization");
    }
    const org = await models_1.Organization.findById(req.user.organizationId).select("name contactEmail contactPhone gstin address status isEstampServiceEnabled createdAt");
    if (!org) {
        throw ApiError_1.ApiError.notFound("Organization not found");
    }
    return (0, ApiResponse_1.ok)(res, org);
});

// PATCH /profile { name?, phone? }: edit ONLY your own name and phone.
exports.updateMyProfile = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const body = req.body || {};
    const update = {};
    if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (name.length < 2 || name.length > 150) {
            throw ApiError_1.ApiError.badRequest("Name must be 2 to 150 characters", "VALIDATION_ERROR");
        }
        update.name = name;
    }
    if (body.phone !== undefined) {
        const phone = String(body.phone).trim();
        if (phone !== "" && (phone.length < 6 || phone.length > 20)) {
            throw ApiError_1.ApiError.badRequest("Phone must be 6 to 20 characters", "VALIDATION_ERROR");
        }
        update.phone = phone === "" ? undefined : phone;
    }
    if (Object.keys(update).length === 0) {
        throw ApiError_1.ApiError.badRequest("Nothing to update", "VALIDATION_ERROR");
    }
    const user = await models_1.User.findById(req.user.id);
    if (!user) {
        throw ApiError_1.ApiError.unauthorized();
    }
    if (update.name !== undefined) user.name = update.name;
    if (body.phone !== undefined) user.phone = update.phone;
    await user.save();
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: req.user.organizationId,
        action: shared_1.AuditAction.USER_MODIFIED,
        entityType: "User",
        entityId: req.user.id,
        req,
    });
    const plain = user.toObject();
    delete plain.passwordHash;
    return (0, ApiResponse_1.ok)(res, plain, "Profile updated");
});