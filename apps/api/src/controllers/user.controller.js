"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.revealTemporaryPassword = exports.deleteUser = exports.resetUserPassword = exports.updateAssistantAdminPermissions = exports.createAssistantAdmin = exports.updateUserRole = exports.updateUser = exports.getUser = exports.updateUserStatus = exports.listUsers = exports.createUser = void 0;
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
    const filter = { deletedAt: null };
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
    if (!target || target.deletedAt)
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
    const { name, email, phone, role, password } = req.body;
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
    // The creator (Super Admin/Admin) sets the password themselves - required
    // by the schema, never auto-generated. Still stored in the same
    // revealable vault below, so it's never lost. Never logged.
    const tempPassword = password;
    const passwordHash = await auth_service_1.AuthService.hashPassword(tempPassword);
    const user = await models_1.User.create({
        name,
        email: email.toLowerCase(),
        phone,
        role,
        organizationId: req.user.organizationId,
        passwordHash,
        // Deliberately not forced to change on first login (explicit,
        // temporary product decision) - they can keep using the password
        // the creator gave them, and ask a Super Admin/Admin to reset it
        // later if they ever want a different one.
        mustChangePassword: false,
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
    // Same three roles the /:id/temporary-password route now allows to
    // reveal a password (Master Admin platform-wide; Super Admin/Admin only
    // within their own org, already enforced by resolveOrgFilter above) -
    // everyone else gets no passwordState at all, matching what they're
    // actually permitted to act on.
    const canSeePasswordState = [shared_1.Role.MASTER_ADMIN, shared_1.Role.SUPER_ADMIN, shared_1.Role.ADMIN].includes(req.user.role);
    const [users, total] = await Promise.all([
        models_1.User.find(filter)
            .select(canSeePasswordState ? "-passwordHash +tempPasswordExpiresAt" : "-passwordHash")
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        models_1.User.countDocuments(filter),
    ]);
    // passwordState (TEMPORARY / SET_BY_USER) only - nothing else
    // credential-related; the expiry field itself is never returned.
    const items = canSeePasswordState ? users.map((u) => {
        const plain = u.toObject();
        delete plain.tempPasswordExpiresAt;
        return { ...plain, passwordState: (0, credentialVault_1.passwordStateOf)(u) };
    }) : users;
    return (0, ApiResponse_1.ok)(res, { items, total, page: pageNum, limit: limitNum });
});
exports.getUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const target = await findScopedUser(req, req.params.id);
    const plain = { ...target.toObject(), passwordHash: undefined };
    // Same three roles allowed to reveal a password (listUsers does the
    // identical thing for the list view) - lets the per-user detail page
    // show whether a revealable temporary password currently exists.
    // tempPasswordExpiresAt is select:false on the model, so it has to be
    // fetched explicitly - never included in the default findScopedUser
    // query every other action here reuses.
    if ([shared_1.Role.MASTER_ADMIN, shared_1.Role.SUPER_ADMIN, shared_1.Role.ADMIN].includes(req.user.role)) {
        const withTemp = await models_1.User.findById(target._id).select("+tempPasswordExpiresAt");
        plain.passwordState = (0, credentialVault_1.passwordStateOf)(withTemp);
    }
    return (0, ApiResponse_1.ok)(res, plain);
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
    // assertCanActOn above only checks the target's CURRENT role - an actor
    // who may act on a USER (because USER is strictly below them) could
    // otherwise promote that same USER straight to a role equal to or above
    // their own (e.g. an ADMIN granting ADMIN) by naming it in the request
    // body. The role being GRANTED needs the exact same authority check as
    // the role being acted on.
    assertCanActOn(req.user.role, newRole);
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
// Only the same client roles createUser can mint - never an internal role,
// never through this endpoint.
const RESETTABLE_ROLES = [shared_1.Role.SUPER_ADMIN, shared_1.Role.ADMIN, shared_1.Role.USER];
// POST /users/:id/reset-password - a Super Admin/Admin sets a NEW, explicit
// password for an existing Admin's/User's account (never auto-generated,
// matching the same explicit-password decision createUser makes), within
// the same authority rule as every other action here: only strictly-lower-
// authority roles, only within the actor's own organization (or an
// Assistant Master Admin's assigned organizations). Every existing session
// for the target is invalidated immediately (the old password + any token
// issued under it must stop working the moment it's replaced), and the new
// password is stored in the same revealable vault as createUser's so it can
// be looked up again later via GET /:id/temporary-password - the account
// never ends up in a state nobody but the target can see the password for.
exports.resetUserPassword = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { password } = req.body;
    const target = await findScopedUser(req, req.params.id);
    assertCanActOn(req.user.role, target.role);
    if (!RESETTABLE_ROLES.includes(target.role)) {
        throw ApiError_1.ApiError.forbidden("Passwords of this role cannot be reset through this endpoint");
    }
    target.passwordHash = await auth_service_1.AuthService.hashPassword(password);
    // Deliberately not forced to change on first login - same product
    // decision createUser makes: the admin-chosen password is usable
    // immediately, see createUser's comment above.
    target.mustChangePassword = false;
    target.failedLoginAttempts = 0;
    target.lockedUntil = null;
    await target.save();
    await auth_service_1.AuthService.invalidateAllSessions(target._id.toString());
    await (0, credentialVault_1.storeTemporaryPassword)(target._id, password);
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: target.organizationId?.toString() ?? null,
        action: shared_1.AuditAction.PASSWORD_RESET_COMPLETED,
        entityType: "User",
        entityId: target._id.toString(),
        metadata: { targetRole: target.role },
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Client employee password reset",
            message: `Assistant Master Admin reset a client employee's password.`,
            relatedActorId: req.user.id,
            organizationId: target.organizationId?.toString() ?? null,
        });
    }
    return (0, ApiResponse_1.ok)(res, { tempPassword: password }, "Password reset");
});
// DELETE /users/:id - a Super Admin/Admin (or Master/Assistant Master Admin,
// via the same tenant-isolation + role-hierarchy rules as every other action
// in this file) removes an Admin's/User's account. Same hard-vs-soft-delete
// pattern as vendor.controller.js's deleteVendor: a never-used account (no
// requests, orders, payments, files or audit history of its own) is hard
// deleted outright; anything with real history is soft deleted (deactivated,
// email released for reuse, every session invalidated) so existing
// requests/orders/payments/audit entries still resolve to a real user
// record. Never deletable: a Master Admin (not reachable via this
// client/tenant-only endpoint), an Assistant Master Admin (same reason),
// or the caller's own account.
exports.deleteUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const target = await findScopedUser(req, req.params.id);
    assertCanActOn(req.user.role, target.role);
    if (target._id.toString() === req.user.id) {
        throw ApiError_1.ApiError.forbidden("You cannot delete your own account");
    }
    const id = target._id;
    const [requests, orders, payments, files, audits] = await Promise.all([
        models_1.EStampRequest.exists({ createdBy: id }),
        models_1.EStampOrder.exists({ createdBy: id }),
        models_1.Payment.exists({ createdBy: id }),
        models_1.FileAsset.exists({ ownerUserId: id }),
        models_1.AuditLog.exists({ actorId: id }),
    ]);
    const hard = !requests && !orders && !payments && !files && !audits;
    if (hard) {
        await models_1.RefreshToken.deleteMany({ userId: id });
        await models_1.User.deleteOne({ _id: id });
    }
    else {
        await models_1.User.updateOne({ _id: id }, { $set: { isActive: false, deletedAt: new Date(), email: `deleted+${id.toString()}@deleted.invalid` }, $unset: { initialPasswordEnc: "", tempPasswordExpiresAt: "" } });
        await auth_service_1.AuthService.invalidateAllSessions(id.toString());
    }
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: target.organizationId?.toString() ?? null,
        action: shared_1.AuditAction.USER_DELETED,
        entityType: "User",
        entityId: id.toString(),
        metadata: { role: target.role, deleted: hard ? "hard" : "soft" },
        req,
    });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Client employee deleted",
            message: `Assistant Master Admin deleted a client employee account.`,
            relatedActorId: req.user.id,
            organizationId: target.organizationId?.toString() ?? null,
        });
    }
    return (0, ApiResponse_1.ok)(res, { id: id.toString(), deleted: hard ? "hard" : "soft" }, "User deleted");
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
});// GET /users/:id/temporary-password - Master Admin (platform-wide), and now
// also Super Admin/Admin for someone they themselves had the authority to
// create: a Super Admin may reveal an Admin's or User's password within
// their OWN organization; an Admin may reveal only a User's, also within
// their own organization. Reveals a SYSTEM-GENERATED temporary password
// until the user sets their own (any change/reset purges it) or 7 days
// pass. Never for a Master Admin target. Every reveal is audited without
// the password; responses are never cached.
const REVEALABLE_ROLES = [shared_1.Role.VENDOR, shared_1.Role.ASSISTANT_MASTER_ADMIN, shared_1.Role.SUPER_ADMIN, shared_1.Role.ADMIN, shared_1.Role.USER];
exports.revealTemporaryPassword = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    const target = /^[a-f0-9]{24}$/i.test(String(req.params.id)) ? await models_1.User.findOne({ _id: req.params.id, deletedAt: null }).select("+initialPasswordEnc +tempPasswordExpiresAt role organizationId") : null;
    if (!target)
        throw ApiError_1.ApiError.notFound("User not found");
    // Tenant isolation: a non-internal actor (Super Admin, Admin) may only
    // ever reveal a password for a user inside their OWN organization - the
    // same "not found" shape for "doesn't exist" and "exists in another
    // org" as findScopedUser() uses elsewhere, so cross-tenant probing can't
    // tell the two apart.
    if (!isInternalActor(req) && target.organizationId?.toString() !== req.user.organizationId) {
        throw ApiError_1.ApiError.notFound("User not found");
    }
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN && !(await (0, orgAccess_1.canAccessOrganization)(req, target.organizationId))) {
        throw ApiError_1.ApiError.notFound("User not found");
    }
    // Authority check: the same "only strictly-lower-authority roles" rule
    // as createUser/updateUserRole - a Super Admin can reveal an Admin's or
    // User's password, an Admin only a User's, and Master Admin (level 1)
    // outranks everyone revealable. Never a peer's or superior's.
    if (shared_1.ROLE_LEVEL[target.role] <= shared_1.ROLE_LEVEL[req.user.role]) {
        throw ApiError_1.ApiError.forbidden("You cannot reveal the password of a user of this role");
    }
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
