"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.revealTemporaryPassword = exports.updateAssistantAdminPermissions = exports.createAssistantAdmin = exports.updateUserRole = exports.updateUser = exports.getUser = exports.updateUserStatus = exports.listUsers = exports.createUser = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const ApiError_1 = require("../utils/ApiError");
const auth_service_1 = require("../services/auth.service");
const audit_service_1 = require("../services/audit.service");
const notification_service_1 = require("../services/notification.service");
const crypto_1 = __importDefault(require("crypto"));
const orgAccess_1 = require("../utils/orgAccess");
const credentialVault_1 = require("../utils/credentialVault");
function isInternalActor(req) {
    return req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
// Same escape used by order.controller.js/payment.controller.js's search -
// without it, a search term containing a regex metacharacter (e.g. an
// unmatched paren) throws a 500 instead of matching it literally.
function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Organization-scoped user/employee management (Super Admin, Admin) plus
// platform-wide user visibility for Master/Assistant Master Admin.
function resolveOrgFilter(req) {
    const isInternal = isInternalActor(req);
    const filter = {};
    if (isInternal) {
        if (req.query.organizationId)
            filter.organizationId = req.query.organizationId;
    }
    else {
        filter.organizationId = req.user.organizationId;
    }
    // Role filter is safe for every actor: for internal roles it narrows a
    // platform-wide query (e.g. "just the Assistant Master Admins"); for
    // tenant actors, the organizationId scoping above already confines the
    // result to their own org, so filtering by role within it leaks nothing.
    if (req.query.role && Object.values(shared_1.Role).includes(req.query.role)) {
        filter.role = req.query.role;
    }
    if (req.query.status === "active")
        filter.isActive = true;
    else if (req.query.status === "inactive")
        filter.isActive = false;
    if (req.query.search) {
        filter.$or = [
            { name: { $regex: escapeRegex(req.query.search), $options: "i" } },
            { email: { $regex: escapeRegex(req.query.search), $options: "i" } },
        ];
    }
    return filter;
}
// Fetches the target user and enforces tenant isolation: a non-internal
// actor can only ever reach a user inside their OWN organization, regardless
// of what organizationId, URL params, or anything else the request contains.
// Returns the same "not found" shape for "doesn't exist" and "exists in
// another organization" so cross-tenant probing can't distinguish the two.
async function findScopedUser(req, id) {
    const target = await models_1.User.findById(id);
    if (!target)
        throw ApiError_1.ApiError.notFound("User not found");
    if (!isInternalActor(req) && target.organizationId?.toString() !== req.user.organizationId) {
        throw ApiError_1.ApiError.notFound("User not found");
    }
    // An Assistant Master Admin only reaches users of organizations assigned
    // to them (internal users have no organization, so never).
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN && !(await (0, orgAccess_1.canAccessOrganization)(req, target.organizationId))) {
        throw ApiError_1.ApiError.notFound("User not found");
    }
    return target;
}
// A creator/editor may only ever act on strictly-lower-authority roles
// (higher ROLE_LEVEL number). Equal level also covers the "acting on myself"
// case, since self and actor always share the same role - this is what
// prevents self-deactivation/self-role-change/self-anything through these
// endpoints without a separate special case.
function assertCanActOn(actorRole, targetRole) {
    if (shared_1.ROLE_LEVEL[targetRole] <= shared_1.ROLE_LEVEL[actorRole]) {
        throw ApiError_1.ApiError.forbidden("You cannot modify a user of this role");
    }
}
exports.createUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { name, email, phone, role } = req.body;
    // A creator can only create roles strictly below their own authority level,
    // and only within their own organization. organizationId is NEVER read
    // from the request body - it is always the authenticated actor's own org
    // (enforced by requireOrganizationAccess upstream for tenant actors).
    if (shared_1.ROLE_LEVEL[role] <= shared_1.ROLE_LEVEL[req.user.role]) {
        throw ApiError_1.ApiError.forbidden("You cannot create a user of this role");
    }
    const existing = await models_1.User.findOne({ email: email.toLowerCase() });
    if (existing)
        throw ApiError_1.ApiError.conflict("A user with this email already exists");
    // Temporary password: user must change on first login. Never logged.
    const tempPassword = crypto_1.default.randomBytes(9).toString("base64url");
    const passwordHash = await auth_service_1.AuthService.hashPassword(tempPassword);
    const user = await models_1.User.create({
        name,
        email: email.toLowerCase(),
        phone,
        role,
        organizationId: req.user.organizationId,
        passwordHash,
        mustChangePassword: true,
        createdBy: req.user.id,
    });
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: req.user.organizationId,
        action: shared_1.AuditAction.USER_CREATED,
        entityType: "User",
        entityId: user._id.toString(),
        metadata: { role },
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Client employee created",
            message: `Assistant Master Admin created a ${role} account for a client organization.`,
            relatedActorId: req.user.id,
            organizationId: req.user.organizationId,
        });
    }
    // Phase 1: temp password returned once so an admin can share it out-of-band;
    // production should instead email an invite/reset link via EmailService.
    await (0, credentialVault_1.storeTemporaryPassword)(user._id, tempPassword);
    return (0, ApiResponse_1.created)(res, { user: { ...user.toObject(), passwordHash: undefined }, tempPassword });
});
exports.listUsers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const filter = resolveOrgFilter(req);
    // Assistant: narrow to assigned organizations (a foreign organizationId
    // filter returns nothing). Master Admin keeps the platform-wide view.
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN)
        await (0, orgAccess_1.scopeOrganizationFilter)(req, filter, req.query.organizationId);
    const { page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const isMaster = req.user.role === shared_1.Role.MASTER_ADMIN;
    const [users, total] = await Promise.all([
        models_1.User.find(filter)
            .select(isMaster ? "-passwordHash +tempPasswordExpiresAt" : "-passwordHash")
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        models_1.User.countDocuments(filter),
    ]);
    // Master Admin only: passwordState (TEMPORARY / SET_BY_USER) and nothing
    // else credential-related; the expiry field itself is never returned.
    const items = isMaster ? users.map((u) => {
        const plain = u.toObject();
        delete plain.tempPasswordExpiresAt;
        return { ...plain, passwordState: (0, credentialVault_1.passwordStateOf)(u) };
    }) : users;
    return (0, ApiResponse_1.ok)(res, { items, total, page: pageNum, limit: limitNum });
});
exports.getUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const target = await findScopedUser(req, req.params.id);
    return (0, ApiResponse_1.ok)(res, { ...target.toObject(), passwordHash: undefined });
});
exports.updateUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const target = await findScopedUser(req, req.params.id);
    assertCanActOn(req.user.role, target.role);
    const { name, email, phone } = req.body;
    if (email && email.toLowerCase() !== target.email) {
        const existing = await models_1.User.findOne({ email: email.toLowerCase() });
        if (existing)
            throw ApiError_1.ApiError.conflict("A user with this email already exists");
        target.email = email.toLowerCase();
    }
    if (name !== undefined)
        target.name = name;
    if (phone !== undefined)
        target.phone = phone;
    await target.save();
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: target.organizationId?.toString() ?? null,
        action: shared_1.AuditAction.USER_MODIFIED,
        entityType: "User",
        entityId: target._id.toString(),
        metadata: { updatedFields: Object.keys(req.body) },
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Client employee updated",
            message: `Assistant Master Admin updated a client employee's profile.`,
            relatedActorId: req.user.id,
            organizationId: target.organizationId?.toString() ?? null,
        });
    }
    return (0, ApiResponse_1.ok)(res, { ...target.toObject(), passwordHash: undefined });
});
exports.updateUserStatus = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { isActive } = req.body;
    const target = await findScopedUser(req, req.params.id);
    assertCanActOn(req.user.role, target.role);
    target.isActive = !!isActive;
    await target.save();
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: target.organizationId?.toString() ?? null,
        action: shared_1.AuditAction.USER_MODIFIED,
        entityType: "User",
        entityId: target._id.toString(),
        metadata: { isActive },
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: isActive ? "Client employee activated" : "Client employee deactivated",
            message: `Assistant Master Admin ${isActive ? "activated" : "deactivated"} a client employee account.`,
            relatedActorId: req.user.id,
            organizationId: target.organizationId?.toString() ?? null,
        });
    }
    return (0, ApiResponse_1.ok)(res, target);
});
// Role changes are intentionally narrow: ADMIN <-> USER only, within the
// actor's own organization (or any organization for internal actors). The
// validation schema already rejects anything else at the request-shape
// level; this is the server-side business-rule enforcement on top of it.
exports.updateUserRole = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { role: newRole } = req.body;
    const target = await findScopedUser(req, req.params.id);
    assertCanActOn(req.user.role, target.role);
    if (![shared_1.Role.ADMIN, shared_1.Role.USER].includes(target.role)) {
        throw ApiError_1.ApiError.forbidden("This user's role cannot be changed through this endpoint");
    }
    const previousRole = target.role;
    target.role = newRole;
    await target.save();
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: target.organizationId?.toString() ?? null,
        action: shared_1.AuditAction.USER_MODIFIED,
        entityType: "User",
        entityId: target._id.toString(),
        metadata: { roleChangedFrom: previousRole, roleChangedTo: newRole },
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Client employee role changed",
            message: `Assistant Master Admin changed a client employee's role from ${previousRole} to ${newRole}.`,
            relatedActorId: req.user.id,
            organizationId: target.organizationId?.toString() ?? null,
        });
    }
    return (0, ApiResponse_1.ok)(res, { ...target.toObject(), passwordHash: undefined });
});
// Master-Admin-only: create an Assistant Master Admin (INTERNAL_ROLE,
// organizationId always null) with an explicit, Master-Admin-chosen
// permission set. Distinct from createUser (which only ever creates
// client/tenant roles) so there is no path by which role escalation to
// MASTER_ADMIN or ASSISTANT_MASTER_ADMIN can slip through generic user
// creation - this is the ONLY endpoint that can mint an Assistant Master
// Admin, and it is gated to MASTER_ADMIN at the route level.
exports.createAssistantAdmin = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { name, email, phone, permissions } = req.body;
    const existing = await models_1.User.findOne({ email: email.toLowerCase() });
    if (existing)
        throw ApiError_1.ApiError.conflict("A user with this email already exists");
    const tempPassword = crypto_1.default.randomBytes(9).toString("base64url");
    const passwordHash = await auth_service_1.AuthService.hashPassword(tempPassword);
    const grantedPermissions = permissions ?? shared_1.DEFAULT_ROLE_PERMISSIONS[shared_1.Role.ASSISTANT_MASTER_ADMIN];
    const user = await models_1.User.create({
        name,
        email: email.toLowerCase(),
        phone,
        role: shared_1.Role.ASSISTANT_MASTER_ADMIN,
        organizationId: null,
        permissions: grantedPermissions,
        passwordHash,
        mustChangePassword: true,
        createdBy: req.user.id,
    });
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.USER_CREATED,
        entityType: "User",
        entityId: user._id.toString(),
        metadata: { role: shared_1.Role.ASSISTANT_MASTER_ADMIN, permissions: grantedPermissions },
        req,
    });
    await (0, credentialVault_1.storeTemporaryPassword)(user._id, tempPassword);
    return (0, ApiResponse_1.created)(res, { user: { ...user.toObject(), passwordHash: undefined }, tempPassword });
});
// Master-Admin-only: full overwrite of an Assistant Master Admin's
// permission set - the ONLY way permissions change for that role, since
// getEffectivePermissions() no longer auto-grants role defaults to them.
// This lets Master Admin both grant AND revoke individual permissions.
exports.updateAssistantAdminPermissions = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { permissions } = req.body;
    const target = await models_1.User.findById(req.params.id);
    if (!target)
        throw ApiError_1.ApiError.notFound("User not found");
    if (target.role !== shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        throw ApiError_1.ApiError.badRequest("Permissions can only be managed for Assistant Master Admin accounts");
    }
    // Defense in depth: even though this route is Master-Admin-only, never
    // allow a caller (of any role) to change their own permission set here.
    if (target._id.toString() === req.user.id) {
        throw ApiError_1.ApiError.forbidden("You cannot modify your own permissions");
    }
    const previousPermissions = target.permissions;
    target.permissions = permissions;
    await target.save();
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: null,
        action: shared_1.AuditAction.PERMISSION_CHANGED,
        entityType: "User",
        entityId: target._id.toString(),
        metadata: { previousPermissions, permissions },
        req,
    });
    return (0, ApiResponse_1.ok)(res, { ...target.toObject(), passwordHash: undefined });
});// GET /users/:id/temporary-password - MASTER_ADMIN only (route-gated).
// Reveals a SYSTEM-GENERATED temporary password until the user sets their
// own (any change/reset purges it) or 7 days pass. Never for a Master Admin
// target. Every reveal is audited without the password; responses are never
// cached.
const REVEALABLE_ROLES = [shared_1.Role.VENDOR, shared_1.Role.ASSISTANT_MASTER_ADMIN, shared_1.Role.SUPER_ADMIN, shared_1.Role.ADMIN, shared_1.Role.USER];
exports.revealTemporaryPassword = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    const target = /^[a-f0-9]{24}$/i.test(String(req.params.id)) ? await models_1.User.findOne({ _id: req.params.id, deletedAt: null }).select("+initialPasswordEnc +tempPasswordExpiresAt role") : null;
    if (!target)
        throw ApiError_1.ApiError.notFound("User not found");
    if (!REVEALABLE_ROLES.includes(target.role))
        throw ApiError_1.ApiError.forbidden("Passwords of this role can never be revealed");
    if (!(0, credentialVault_1.isEnabled)()) {
        throw ApiError_1.ApiError.notFound("Temporary password reveal is not available (CREDENTIAL_ENCRYPTION_KEY is not configured)", "CREDENTIAL_REVEAL_UNAVAILABLE");
    }
    const enc = target.initialPasswordEnc;
    const expiresAt = target.tempPasswordExpiresAt;
    if (!enc || !enc.ciphertext || !expiresAt) {
        throw ApiError_1.ApiError.notFound("No temporary password: the user has set their own, or it expired", "NO_TEMPORARY_PASSWORD");
    }
    if (expiresAt.getTime() <= Date.now()) {
        await (0, credentialVault_1.purgeTemporaryPassword)(target._id);
        throw ApiError_1.ApiError.notFound("No temporary password: the user has set their own, or it expired", "NO_TEMPORARY_PASSWORD");
    }
    let tempPassword;
    try {
        tempPassword = (0, credentialVault_1.decrypt)(target._id.toString(), enc);
    }
    catch {
        // Wrong/rotated key or tampered value: unusable, so drop it.
        await (0, credentialVault_1.purgeTemporaryPassword)(target._id);
        throw ApiError_1.ApiError.notFound("No temporary password: the stored value can no longer be read", "NO_TEMPORARY_PASSWORD");
    }
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: target.organizationId ? target.organizationId.toString() : undefined,
        action: shared_1.AuditAction.CREDENTIAL_REVEALED,
        entityType: "User",
        entityId: target._id.toString(),
        metadata: { targetRole: target.role },
        req,
    });
    return (0, ApiResponse_1.ok)(res, { tempPassword, expiresAt });
});
