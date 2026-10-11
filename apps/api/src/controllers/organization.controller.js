"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAssignedAssistant = exports.provisionSuperAdmin = exports.setEstampServiceEnabled = exports.updateOrganizationStatus = exports.updateOrganization = exports.getOrganization = exports.listOrganizations = exports.createOrganization = void 0;
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
const orgAccess_1 = require("../utils/orgAccess");
// The assignee must be an existing, active Assistant Master Admin.
async function loadAssignableAssistant(assistantId) {
    if (!assistantId || !/^[a-f0-9]{24}$/i.test(String(assistantId))) {
        throw ApiError_1.ApiError.badRequest("assistantId must be a valid user id or null", "INVALID_ASSISTANT");
    }
    const assistant = await models_1.User.findOne({ _id: assistantId, role: shared_2.Role.ASSISTANT_MASTER_ADMIN, isActive: true }).select("_id name email role");
    if (!assistant) {
        throw ApiError_1.ApiError.badRequest("The selected user is not an active Assistant Master Admin", "INVALID_ASSISTANT");
    }
    return assistant;
}
async function notifyAssignment(assistant, org, actorId) {
    await (0, notification_service_1.notifyUser)({
        recipientId: assistant._id.toString(),
        recipientRole: assistant.role,
        type: shared_2.NotificationType.GENERAL,
        title: "Client assigned to you",
        message: `You are now the assigned Assistant Master Admin for "${org.name}". You will credit its payments and manage its balance.`,
        organizationId: org._id.toString(),
        relatedActorId: actorId,
        entityType: "Organization",
        entityId: org._id,
    });
}
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
    // Assignment at creation: a Master Admin may pick any active assistant
    // (or none); an assistant creating a client is assigned to it themselves,
    // otherwise they could not see the organization they just created.
    let assistant = null;
    if (req.user.role === shared_2.Role.MASTER_ADMIN) {
        if (req.body.assignedAssistantId)
            assistant = await loadAssignableAssistant(req.body.assignedAssistantId);
    }
    else if (req.user.role === shared_2.Role.ASSISTANT_MASTER_ADMIN) {
        assistant = { _id: req.user.id, role: req.user.role };
    }
    let org;
    try {
        org = await models_1.Organization.create({
            ...pickWritableFields(req.body),
            createdBy: req.user.id,
            status: shared_1.OrganizationStatus.PENDING_APPROVAL,
            assignedAssistantId: assistant ? assistant._id : null,
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
        metadata: org.assignedAssistantId ? { assignedAssistantId: org.assignedAssistantId.toString() } : undefined,
        req,
    });
    if (assistant && req.user.role === shared_2.Role.MASTER_ADMIN)
        await notifyAssignment(assistant, org, req.user.id);
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
    // Assistant: only organizations assigned to them.
    await (0, orgAccess_1.scopeOrganizationFilter)(req, filter);
    if (filter.organizationId) {
        filter._id = filter.organizationId;
        delete filter.organizationId;
    }
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
    const [wallet, roleCounts, superAdmin, estampRequestCount, orderCount, assignedAssistant] = await Promise.all([
        models_1.Wallet.findOne({ organizationId: org._id }).select("balance reservedBalance currency"),
        models_1.User.aggregate([
            { $match: { organizationId: org._id } },
            { $group: { _id: { role: "$role", isActive: "$isActive" }, count: { $sum: 1 } } },
        ]),
        models_1.User.findOne({ organizationId: org._id, role: shared_2.Role.SUPER_ADMIN }).select("name email isActive createdAt"),
        models_1.EStampRequest.countDocuments({ organizationId: org._id }),
        models_1.EStampOrder.countDocuments({ organizationId: org._id }),
        org.assignedAssistantId ? models_1.User.findById(org.assignedAssistantId).select("name email isActive") : null,
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
        wallet: wallet
            ? { balance: wallet.balance, reservedBalance: wallet.reservedBalance || 0, availableBalance: wallet.balance - (wallet.reservedBalance || 0), currency: wallet.currency }
            : null,
        assignedAssistant: assignedAssistant
            ? { _id: assignedAssistant._id, name: assignedAssistant.name, email: assignedAssistant.email, isActive: assignedAssistant.isActive }
            : null,
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
// PATCH /organizations/:id/assigned-assistant { assistantId | null }
// Master Admin only (route-gated). Sets or clears the one Assistant Master
// Admin responsible for this client.
exports.setAssignedAssistant = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { assistantId } = req.body || {};
    if (assistantId === undefined) {
        throw ApiError_1.ApiError.badRequest("assistantId is required (use null to unassign)", "INVALID_ASSISTANT");
    }
    const assistant = assistantId === null ? null : await loadAssignableAssistant(assistantId);
    const before = await models_1.Organization.findById(req.params.id).select("assignedAssistantId");
    if (!before)
        throw ApiError_1.ApiError.notFound("Organization not found");
    const org = await models_1.Organization.findByIdAndUpdate(req.params.id, { assignedAssistantId: assistant ? assistant._id : null }, { new: true });
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        organizationId: org._id.toString(),
        action: shared_2.AuditAction.ORG_MODIFIED,
        entityType: "Organization",
        entityId: org._id.toString(),
        metadata: {
            change: "assigned_assistant",
            previousAssistantId: before.assignedAssistantId ? before.assignedAssistantId.toString() : null,
            assignedAssistantId: assistant ? assistant._id.toString() : null,
        },
        req,
    });
    if (assistant && before.assignedAssistantId?.toString() !== assistant._id.toString()) {
        await notifyAssignment(assistant, org, req.user.id);
    }
    return (0, ApiResponse_1.ok)(res, {
        organization: org,
        assignedAssistant: assistant ? { _id: assistant._id, name: assistant.name, email: assistant.email } : null,
    });
});
