"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provisionSuperAdmin = exports.setEstampServiceEnabled = exports.updateOrganizationStatus = exports.updateOrganization = exports.getOrganization = exports.listOrganizations = exports.createOrganization = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const ApiError_1 = require("../utils/ApiError");
const audit_service_1 = require("../services/audit.service");
const notification_service_1 = require("../services/notification.service");
const auth_service_1 = require("../services/auth.service");
const crypto_1 = require("crypto");
const shared_2 = require("@launcherdesk/shared");
// Only these fields may ever be written by createOrganization/updateOrganization.
// Status and isEstampServiceEnabled are deliberately excluded - they have their
// own, more tightly-gated endpoints - and system fields (_id, createdBy,
// timestamps) can never be reached through this whitelist at all.
const ORGANIZATION_WRITABLE_FIELDS = ["name", "contactEmail", "contactPhone", "gstin", "address"];
// Same escape used by order.controller.js/payment.controller.js's search -
// without it, a search term containing a regex metacharacter (e.g. an
// unmatched paren) throws a 500 instead of matching it literally.
function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function pickWritableFields(body) {
    const picked = {};
    for (const key of ORGANIZATION_WRITABLE_FIELDS) {
        if (body[key] !== undefined)
            picked[key] = body[key];
    }
    return picked;
}
// MASTER ADMIN / ASSISTANT MASTER ADMIN scope - platform-wide client management.
exports.createOrganization = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    let org;
    try {
        org = await models_1.Organization.create({
            ...pickWritableFields(req.body),
            createdBy: req.user.id,
            status: shared_1.OrganizationStatus.PENDING_APPROVAL,
        });
    }
    catch (err) {
        // Concurrent creation with the same contactEmail races past an
        // application-level "does it exist" check - the unique index is the
        // real guarantee, and a 11000 here is just that guarantee firing.
        if (err?.code === 11000) {
            throw ApiError_1.ApiError.conflict("An organization with this contact email already exists");
        }
        throw err;
    }
    await models_1.Wallet.create({ organizationId: org._id, balance: 0 });
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_2.AuditAction.ORG_CREATED,
        entityType: "Organization",
        entityId: org._id.toString(),
        req,
    });
    if (req.user.role === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Client organization created",
            message: `Assistant Master Admin created client organization "${org.name}".`,
            relatedActorId: req.user.id,
            organizationId: org._id.toString(),
        });
    }
    return (0, ApiResponse_1.created)(res, org);
});
exports.listOrganizations = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { page = "1", limit = "20", status, search } = req.query;
    const filter = {};
    if (status)
        filter.status = status;
    if (search)
        filter.name = { $regex: escapeRegex(search), $options: "i" };
    // Phase 19 - cap client-supplied `limit`, same pattern as the other list
    // endpoints (order/payment/user/notification/audit controllers).
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const orgs = await models_1.Organization.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum);
    const total = await models_1.Organization.countDocuments(filter);
    return (0, ApiResponse_1.ok)(res, { items: orgs, total, page: pageNum, limit: limitNum });
});
// Organization detail view: org profile + wallet balance + user counts by
// role + initial Super Admin identity + E-Stamp/order activity summary.
// Every underlying number comes from an existing model via a count/aggregate
// query - nothing is loaded into Node just to be counted.
exports.getOrganization = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const org = await models_1.Organization.findById(req.params.id);
    if (!org)
        throw ApiError_1.ApiError.notFound("Organization not found");
    if (req.user.role === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: shared_2.AuditAction.ORG_VIEWED,
            entityType: "Organization",
            entityId: org._id.toString(),
            req,
        });
    }
    const [wallet, roleCounts, superAdmin, estampRequestCount, orderCount] = await Promise.all([
        models_1.Wallet.findOne({ organizationId: org._id }).select("balance currency"),
        models_1.User.aggregate([
            { $match: { organizationId: org._id } },
            { $group: { _id: { role: "$role", isActive: "$isActive" }, count: { $sum: 1 } } },
        ]),
        models_1.User.findOne({ organizationId: org._id, role: shared_2.Role.SUPER_ADMIN }).select("name email isActive createdAt"),
        models_1.EStampRequest.countDocuments({ organizationId: org._id }),
        models_1.EStampOrder.countDocuments({ organizationId: org._id }),
    ]);
    const userCounts = { SUPER_ADMIN: 0, ADMIN: 0, USER: 0, totalActive: 0, totalUsers: 0 };
    for (const row of roleCounts) {
        const { role, isActive } = row._id;
        if (userCounts[role] !== undefined)
            userCounts[role] += row.count;
        userCounts.totalUsers += row.count;
        if (isActive)
            userCounts.totalActive += row.count;
    }
    return (0, ApiResponse_1.ok)(res, {
        organization: org,
        wallet: wallet ? { balance: wallet.balance, currency: wallet.currency } : null,
        superAdmin: superAdmin ? { name: superAdmin.name, email: superAdmin.email, isActive: superAdmin.isActive, createdAt: superAdmin.createdAt } : null,
        userCounts,
        activity: { estampRequestCount, orderCount },
    });
});
// Edit organization profile fields. Whitelisted at the validation layer AND
// again here (pickWritableFields) so a spread-based mass-assignment bug
// cannot creep back in later - status/isEstampServiceEnabled/ownership/system
// fields can never reach Organization.findByIdAndUpdate through this path.
exports.updateOrganization = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const updates = pickWritableFields(req.body);
    let org;
    try {
        org = await models_1.Organization.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    }
    catch (err) {
        if (err?.code === 11000) {
            throw ApiError_1.ApiError.conflict("An organization with this contact email already exists");
        }
        throw err;
    }
    if (!org)
        throw ApiError_1.ApiError.notFound("Organization not found");
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_2.AuditAction.ORG_MODIFIED,
        entityType: "Organization",
        entityId: org._id.toString(),
        metadata: { updatedFields: Object.keys(updates) },
        req,
    });
    if (req.user.role === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Client organization updated",
            message: `Assistant Master Admin updated client organization "${org.name}".`,
            relatedActorId: req.user.id,
            organizationId: org._id.toString(),
        });
    }
    return (0, ApiResponse_1.ok)(res, org);
});
exports.updateOrganizationStatus = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { status } = req.body;
    if (!Object.values(shared_1.OrganizationStatus).includes(status))
        throw ApiError_1.ApiError.badRequest("Invalid status");
    const org = await models_1.Organization.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!org)
        throw ApiError_1.ApiError.notFound("Organization not found");
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_2.AuditAction.ORG_STATUS_CHANGED,
        entityType: "Organization",
        entityId: org._id.toString(),
        metadata: { status },
        req,
    });
    if (req.user.role === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Client status changed",
            message: `Assistant Master Admin changed "${org.name}" status to ${status}.`,
            relatedActorId: req.user.id,
            organizationId: org._id.toString(),
        });
    }
    return (0, ApiResponse_1.ok)(res, org);
});
exports.setEstampServiceEnabled = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { enabled } = req.body;
    const org = await models_1.Organization.findByIdAndUpdate(req.params.id, { isEstampServiceEnabled: !!enabled }, { new: true });
    if (!org)
        throw ApiError_1.ApiError.notFound("Organization not found");
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_2.AuditAction.ORG_MODIFIED,
        entityType: "Organization",
        entityId: org._id.toString(),
        metadata: { isEstampServiceEnabled: enabled },
        req,
    });
    return (0, ApiResponse_1.ok)(res, org);
});
// Provisions the initial SUPER_ADMIN for a client organization. Deliberately
// separate from the generic createUser (which only ever operates within the
// caller's OWN organization) - this is the one path by which an internal
// actor (Master/Assistant Master Admin) creates a tenant-scoped user for an
// organization that is not their own, and it is scoped to exactly one role
// and one organizationId (taken from the URL, never from the request body).
exports.provisionSuperAdmin = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const org = await models_1.Organization.findById(req.params.id);
    if (!org)
        throw ApiError_1.ApiError.notFound("Organization not found");
    const existingSuperAdmin = await models_1.User.findOne({ organizationId: org._id, role: shared_2.Role.SUPER_ADMIN });
    if (existingSuperAdmin) {
        throw ApiError_1.ApiError.conflict("This organization already has a Super Admin");
    }
    const { name, email, phone } = req.body;
    const existingEmail = await models_1.User.findOne({ email: email.toLowerCase() });
    if (existingEmail)
        throw ApiError_1.ApiError.conflict("A user with this email already exists");
    // Temporary password: Super Admin must change it on first login (same
    // provisioning pattern as createUser/createAssistantAdmin). Never logged,
    // never emailed in plaintext by this endpoint - returned once so an
    // internal admin can hand it over out-of-band, exactly like the existing
    // user-provisioning flows.
    const tempPassword = crypto_1.randomBytes(9).toString("base64url");
    const passwordHash = await auth_service_1.AuthService.hashPassword(tempPassword);
    const superAdmin = await models_1.User.create({
        name,
        email: email.toLowerCase(),
        phone,
        role: shared_2.Role.SUPER_ADMIN,
        organizationId: org._id,
        passwordHash,
        mustChangePassword: true,
        createdBy: req.user.id,
    });
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: org._id.toString(),
        action: shared_2.AuditAction.USER_CREATED,
        entityType: "User",
        entityId: superAdmin._id.toString(),
        metadata: { role: shared_2.Role.SUPER_ADMIN, organizationId: org._id.toString() },
        req,
    });
    if (req.user.role === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_2.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title: "Super Admin provisioned",
            message: `Assistant Master Admin provisioned the initial Super Admin for "${org.name}".`,
            relatedActorId: req.user.id,
            organizationId: org._id.toString(),
        });
    }
    return (0, ApiResponse_1.created)(res, { user: { ...superAdmin.toObject(), passwordHash: undefined }, tempPassword });
});