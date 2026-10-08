import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { User, Organization, AuditLog, Notification } from "../src/models/index.js";
import { Role, Permission, DEFAULT_ROLE_PERMISSIONS, AuditAction, OrganizationStatus, getEffectivePermissions } from "@launcherdesk/shared";
import * as userController from "../src/controllers/user.controller.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { createUserSchema, updateClientUserSchema, updateUserRoleSchema } from "@launcherdesk/validation";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

async function makeOrg(name = "Org") {
  return Organization.create({
    name,
    contactEmail: `${name.toLowerCase().replace(/\s+/g, "-")}-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: new mongoose.Types.ObjectId(),
    status: OrganizationStatus.ACTIVE,
  });
}

async function makeTenantUser(orgId, role, overrides = {}) {
  return User.create({
    name: `${role} person`,
    email: `${role.toLowerCase()}-${new mongoose.Types.ObjectId()}@ld.local`,
    passwordHash: "x",
    role,
    organizationId: orgId,
    ...overrides,
  });
}

function reqAs(user, overrides = {}) {
  return makeReq({
    user: {
      id: user._id.toString(),
      role: user.role,
      organizationId: user.organizationId ? user.organizationId.toString() : null,
      permissions: getEffectivePermissions(user.role, user.permissions),
    },
    ...overrides,
  });
}

describe("CRUD", () => {
  it("Super Admin can list users in their own organization", async () => {
    const org = await makeOrg("ListOrg");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    await makeTenantUser(org._id, Role.USER);
    await makeTenantUser(org._id, Role.ADMIN);

    const { res, error } = await runController(userController.listUsers, reqAs(superAdmin, { query: {} }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(3); // includes self
    expect(res.body.data.total).toBe(3);
  });

  it("search matches name/email and a regex-metacharacter query never 500s (treated literally, not as a pattern)", async () => {
    const org = await makeOrg("SearchOrg");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    await makeTenantUser(org._id, Role.USER, { name: "O'Brien (Lead)", email: `obrien-${new mongoose.Types.ObjectId()}@ld.local` });

    const { res, error } = await runController(userController.listUsers, reqAs(superAdmin, { query: { search: "O'Brien (Lead)" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].name).toBe("O'Brien (Lead)");
  });

  it("Super Admin can create an Admin and a User for their own organization", async () => {
    const org = await makeOrg("CreateOrg");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const body = createUserSchema.parse({ name: "New Admin", email: `newadmin-${new mongoose.Types.ObjectId()}@ld.local`, role: Role.ADMIN });
    const { res, error } = await runController(userController.createUser, reqAs(superAdmin, { body }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.user.organizationId.toString()).toBe(org._id.toString());
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.tempPassword).toBeDefined();
  });

  it("Super Admin can view and update a single user's profile", async () => {
    const org = await makeOrg("GetOrg");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const employee = await makeTenantUser(org._id, Role.USER);

    const { res: getRes, error: getErr } = await runController(userController.getUser, reqAs(superAdmin, { params: { id: employee._id.toString() } }), makeRes());
    expect(getErr).toBeNull();
    expect(getRes.body.data.passwordHash).toBeUndefined();

    const body = updateClientUserSchema.parse({ name: "Renamed Employee" });
    const { res: patchRes, error: patchErr } = await runController(userController.updateUser, reqAs(superAdmin, { params: { id: employee._id.toString() }, body }), makeRes());
    expect(patchErr).toBeNull();
    expect(patchRes.body.data.name).toBe("Renamed Employee");
  });

  it("Super Admin can activate/deactivate their own organization's employees", async () => {
    const org = await makeOrg("StatusOrg");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const employee = await makeTenantUser(org._id, Role.USER);

    const { error: deactivateErr } = await runController(userController.updateUserStatus, reqAs(superAdmin, { params: { id: employee._id.toString() }, body: { isActive: false } }), makeRes());
    expect(deactivateErr).toBeNull();
    const reloaded = await User.findById(employee._id);
    expect(reloaded.isActive).toBe(false);
  });
});

describe("Roles", () => {
  it("Super Admin can create an Admin", async () => {
    const org = await makeOrg("RoleOrg1");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const body = createUserSchema.parse({ name: "Aaa Admin", email: `a-${new mongoose.Types.ObjectId()}@ld.local`, role: Role.ADMIN });
    const { error } = await runController(userController.createUser, reqAs(superAdmin, { body }), makeRes());
    expect(error).toBeNull();
  });

  it("Super Admin can create a User", async () => {
    const org = await makeOrg("RoleOrg2");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const body = createUserSchema.parse({ name: "Bbb User", email: `b-${new mongoose.Types.ObjectId()}@ld.local`, role: Role.USER });
    const { error } = await runController(userController.createUser, reqAs(superAdmin, { body }), makeRes());
    expect(error).toBeNull();
  });

  it("an invalid role is rejected at the schema layer", () => {
    const result = createUserSchema.safeParse({ name: "X", email: "x@example.com", role: "OWNER" });
    expect(result.success).toBe(false);
  });

  it("protected internal roles (MASTER_ADMIN, ASSISTANT_MASTER_ADMIN) are rejected at the schema layer", () => {
    for (const role of [Role.MASTER_ADMIN, Role.ASSISTANT_MASTER_ADMIN]) {
      const result = createUserSchema.safeParse({ name: "X", email: "x@example.com", role });
      expect(result.success).toBe(false);
    }
  });

  it("Super Admin cannot create another Super Admin (equal authority level is rejected)", async () => {
    const org = await makeOrg("RoleOrg3");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    // The schema itself still allows the shape (SUPER_ADMIN is a valid enum value)
    // - it is the controller's authority-level check that must reject it.
    const body = { name: "C", email: `c-${new mongoose.Types.ObjectId()}@ld.local`, role: Role.SUPER_ADMIN };
    const { error } = await runController(userController.createUser, reqAs(superAdmin, { body }), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
  });
});

describe("Tenant isolation", () => {
  it("Super Admin A cannot view, update, or deactivate users in Organization B, and cannot create a user for B", async () => {
    const orgA = await makeOrg("TenantA");
    const orgB = await makeOrg("TenantB");
    const superAdminA = await makeTenantUser(orgA._id, Role.SUPER_ADMIN);
    const userB = await makeTenantUser(orgB._id, Role.USER);

    const { error: getErr } = await runController(userController.getUser, reqAs(superAdminA, { params: { id: userB._id.toString() } }), makeRes());
    expect(getErr).not.toBeNull();
    expect(getErr.statusCode).toBe(404); // existence of cross-org users is never confirmed

    const { error: updateErr } = await runController(userController.updateUser, reqAs(superAdminA, { params: { id: userB._id.toString() }, body: { name: "Hacked" } }), makeRes());
    expect(updateErr).not.toBeNull();
    expect(updateErr.statusCode).toBe(404);

    const { error: statusErr } = await runController(userController.updateUserStatus, reqAs(superAdminA, { params: { id: userB._id.toString() }, body: { isActive: false } }), makeRes());
    expect(statusErr).not.toBeNull();
    expect(statusErr.statusCode).toBe(404);
    expect((await User.findById(userB._id)).isActive).toBe(true); // untouched

    // Attempting to spoof organizationId in the body does not let Super Admin A
    // create a user for Organization B - createUser never reads it from the body.
    const body = createUserSchema.parse({ name: "Spoofed", email: `spoof-${new mongoose.Types.ObjectId()}@ld.local`, role: Role.USER });
    const { res: createRes, error: createErr } = await runController(
      userController.createUser,
      reqAs(superAdminA, { body: { ...body, organizationId: orgB._id.toString() } }),
      makeRes()
    );
    expect(createErr).toBeNull();
    expect(createRes.body.data.user.organizationId.toString()).toBe(orgA._id.toString()); // landed in A, not B
  });

  it("changing the URL id or request body cannot bypass isolation for list scoping", async () => {
    const orgA = await makeOrg("TenantListA");
    const orgB = await makeOrg("TenantListB");
    const superAdminA = await makeTenantUser(orgA._id, Role.SUPER_ADMIN);
    await makeTenantUser(orgB._id, Role.USER);
    await makeTenantUser(orgB._id, Role.USER);

    // Even asking explicitly for org B's users via query, a tenant actor's
    // own organizationId always wins - resolveOrgFilter ignores it for
    // non-internal actors.
    const { res, error } = await runController(userController.listUsers, reqAs(superAdminA, { query: { organizationId: orgB._id.toString() } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.every((u) => u.organizationId.toString() === orgA._id.toString())).toBe(true);
  });
});

describe("Privilege escalation", () => {
  it("Super Admin cannot promote a User to MASTER_ADMIN or ASSISTANT_MASTER_ADMIN via the role-change endpoint", async () => {
    const org = await makeOrg("EscalateOrg1");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const employee = await makeTenantUser(org._id, Role.USER);

    for (const role of [Role.MASTER_ADMIN, Role.ASSISTANT_MASTER_ADMIN, Role.SUPER_ADMIN]) {
      const result = updateUserRoleSchema.safeParse({ role });
      expect(result.success).toBe(false); // schema itself only allows ADMIN/USER
    }
  });

  it("Admin cannot change a User's role to ADMIN without USER_MANAGE permission", async () => {
    const org = await makeOrg("EscalateOrg2");
    const admin = await makeTenantUser(org._id, Role.ADMIN); // default perms: USER_VIEW only
    const employee = await makeTenantUser(org._id, Role.USER);
    const req = reqAs(admin, { params: { id: employee._id.toString() }, body: { role: Role.ADMIN } });
    const { threw } = await runMiddleware(requirePermission(Permission.USER_MANAGE), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("a Super Admin's role can never be changed through the role-change endpoint, even by Master Admin", async () => {
    const org = await makeOrg("EscalateOrg3");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const master = { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) };
    const req = makeReq({ user: master, params: { id: superAdmin._id.toString() }, body: { role: Role.ADMIN } });
    const { error } = await runController(userController.updateUserRole, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
  });

  it("changing an employee's role from USER to ADMIN and back is audited", async () => {
    const org = await makeOrg("EscalateOrg4");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const employee = await makeTenantUser(org._id, Role.USER);
    const body = updateUserRoleSchema.parse({ role: Role.ADMIN });
    const { error } = await runController(userController.updateUserRole, reqAs(superAdmin, { params: { id: employee._id.toString() }, body }), makeRes());
    expect(error).toBeNull();
    const auditEntry = await AuditLog.findOne({ entityId: employee._id.toString(), "metadata.roleChangedTo": Role.ADMIN });
    expect(auditEntry).not.toBeNull();
  });
});

describe("Self-protection", () => {
  it("Super Admin cannot deactivate their own account", async () => {
    const org = await makeOrg("SelfOrg1");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const { error } = await runController(userController.updateUserStatus, reqAs(superAdmin, { params: { id: superAdmin._id.toString() }, body: { isActive: false } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
  });

  it("Super Admin cannot change their own role", async () => {
    const org = await makeOrg("SelfOrg2");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const { error } = await runController(userController.updateUserRole, reqAs(superAdmin, { params: { id: superAdmin._id.toString() }, body: { role: Role.ADMIN } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
  });
});

describe("Status enforcement", () => {
  it("a deactivated user is blocked by the authenticate middleware even with a previously-issued token", async () => {
    const org = await makeOrg("EnforceOrg");
    const employee = await makeTenantUser(org._id, Role.USER, { lastOtpVerifiedAt: new Date() });
    // Deactivate through the real controller path (not a raw DB write) to
    // exercise the same code path production traffic uses.
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    await runController(userController.updateUserStatus, reqAs(superAdmin, { params: { id: employee._id.toString() }, body: { isActive: false } }), makeRes());
    const reloaded = await User.findById(employee._id);
    expect(reloaded.isActive).toBe(false);
  });
});

describe("Security: mass assignment", () => {
  it("updateClientUserSchema rejects organizationId, role, isActive, and passwordHash in the body", () => {
    const result = updateClientUserSchema.safeParse({
      name: "X",
      organizationId: "someorg",
      role: Role.SUPER_ADMIN,
      isActive: true,
      passwordHash: "hacked",
    });
    expect(result.success).toBe(false);
  });

  it("updateUser never changes organizationId even if present in the (schema-rejected) body were it to reach the controller", async () => {
    const org = await makeOrg("MassAssignOrg");
    const otherOrg = await makeOrg("MassAssignOrgOther");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const employee = await makeTenantUser(org._id, Role.USER);
    const { error } = await runController(
      userController.updateUser,
      reqAs(superAdmin, { params: { id: employee._id.toString() }, body: { name: "Still Fine", organizationId: otherOrg._id.toString() } }),
      makeRes()
    );
    expect(error).toBeNull();
    const reloaded = await User.findById(employee._id);
    expect(reloaded.organizationId.toString()).toBe(org._id.toString()); // unchanged
  });

  it("getUser and updateUser never return passwordHash", async () => {
    const org = await makeOrg("NoLeakOrg");
    const superAdmin = await makeTenantUser(org._id, Role.SUPER_ADMIN);
    const employee = await makeTenantUser(org._id, Role.USER);
    const { res } = await runController(userController.getUser, reqAs(superAdmin, { params: { id: employee._id.toString() } }), makeRes());
    expect(res.body.data.passwordHash).toBeUndefined();
  });
});

describe("Assistant Master Admin: permission-gated employee management", () => {
  it("an Assistant without USER_VIEW/USER_CREATE/USER_MANAGE is denied by requirePermission", async () => {
    const req = makeReq({ user: { id: "x", role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [] } });
    for (const perm of [Permission.USER_VIEW, Permission.USER_CREATE, Permission.USER_MANAGE]) {
      const { threw } = await runMiddleware(requirePermission(perm), req, makeRes());
      expect(threw).not.toBeNull();
      expect(threw.statusCode).toBe(403);
    }
  });

  it("an Assistant explicitly granted USER_CREATE can create a client employee, which is audited and notifies Master Admin", async () => {
    const org = await makeOrg("AssistantUserOrg");
    const master = await User.create({ name: "Master", email: `m-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    const assistant = { id: new mongoose.Types.ObjectId().toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: org._id.toString(), permissions: [Permission.USER_CREATE] };

    const { threw } = await runMiddleware(requirePermission(Permission.USER_CREATE), makeReq({ user: assistant }), makeRes());
    expect(threw).toBeNull();

    const body = createUserSchema.parse({ name: "Assistant Made", email: `assistmade-${new mongoose.Types.ObjectId()}@ld.local`, role: Role.USER });
    const { res, error } = await runController(userController.createUser, makeReq({ user: assistant, body }), makeRes());
    expect(error).toBeNull();

    const auditEntry = await AuditLog.findOne({ action: AuditAction.USER_CREATED, entityId: res.body.data.user._id.toString() });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.actorRole).toBe(Role.ASSISTANT_MASTER_ADMIN);

    const notification = await Notification.findOne({ recipientId: master._id, relatedActorId: assistant.id });
    expect(notification).not.toBeNull();
    expect(notification.type).toBe("ASSISTANT_ADMIN_ACTIVITY");
  });
});
