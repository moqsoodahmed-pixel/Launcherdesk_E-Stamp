import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Organization, Wallet, User, AuditLog, Notification } from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus } from "@launcherdesk/shared";
import * as orgController from "../src/controllers/organization.controller.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { AuthService } from "../src/services/auth.service.js";
import { createOrganizationSchema, updateOrganizationSchema, provisionSuperAdminSchema } from "@launcherdesk/validation";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

function masterAdminReq(overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: [] }, ...overrides });
}

function assistantReq(permissions = [], overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions }, ...overrides });
}

async function makeActiveOrg(overrides = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: "Test Org",
    contactEmail: `org-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    ...overrides,
  });
  await Wallet.create({ organizationId: org._id, balance: 500 });
  return org;
}

describe("Organization creation", () => {
  it("Master Admin can create an organization", async () => {
    const body = createOrganizationSchema.parse({
      name: "Acme Pvt Ltd",
      contactEmail: "acme-create@example.com",
      contactPhone: "9876543210",
    });
    const req = masterAdminReq({ body });
    const { res, error } = await runController(orgController.createOrganization, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.name).toBe("Acme Pvt Ltd");
    expect(res.body.data.status).toBe(OrganizationStatus.PENDING_APPROVAL);

    const wallet = await Wallet.findOne({ organizationId: res.body.data._id });
    expect(wallet).not.toBeNull();
    expect(wallet.balance).toBe(0);

    const auditEntry = await AuditLog.findOne({ action: AuditAction.ORG_CREATED, entityId: res.body.data._id.toString() });
    expect(auditEntry).not.toBeNull();
  });

  it("rejects a duplicate contactEmail", async () => {
    const email = `dup-${new mongoose.Types.ObjectId()}@example.com`;
    await makeActiveOrg({ contactEmail: email });
    const body = createOrganizationSchema.parse({ name: "Another Co", contactEmail: email, contactPhone: "1234567890" });
    const req = masterAdminReq({ body });
    const { error } = await runController(orgController.createOrganization, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(409);
  });

  it("rejects invalid data at the schema layer (bad email, missing phone)", () => {
    const result = createOrganizationSchema.safeParse({ name: "X", contactEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("does not mass-assign unexpected fields (e.g. status, isEstampServiceEnabled) from the request body", async () => {
    const req = masterAdminReq({
      body: {
        name: "Sneaky Co",
        contactEmail: `sneaky-${new mongoose.Types.ObjectId()}@example.com`,
        contactPhone: "9999999999",
        status: OrganizationStatus.ACTIVE, // attempted spoof
        isEstampServiceEnabled: true, // attempted spoof
      },
    });
    const { res, error } = await runController(orgController.createOrganization, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.status).toBe(OrganizationStatus.PENDING_APPROVAL);
    expect(res.body.data.isEstampServiceEnabled).toBe(false);
  });
});

describe("Organization viewing", () => {
  it("Master Admin can list organizations with pagination and status filtering", async () => {
    await makeActiveOrg({ status: OrganizationStatus.ACTIVE });
    await makeActiveOrg({ status: OrganizationStatus.SUSPENDED });
    await makeActiveOrg({ status: OrganizationStatus.SUSPENDED });

    const req = masterAdminReq({ query: { status: OrganizationStatus.SUSPENDED, page: "1", limit: "1" } });
    const { res, error } = await runController(orgController.listOrganizations, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items[0].status).toBe(OrganizationStatus.SUSPENDED);
  });

  it("Master Admin can view organization details including wallet balance, user counts, and Super Admin identity", async () => {
    const org = await makeActiveOrg();
    const superAdminPasswordHash = await AuthService.hashPassword("ChangeMe!SuperAdmin1");
    await User.create({ name: "Org Super Admin", email: `sa-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: superAdminPasswordHash, role: Role.SUPER_ADMIN, organizationId: org._id });
    await User.create({ name: "Org User", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.USER, organizationId: org._id, isActive: false });

    const req = masterAdminReq({ params: { id: org._id.toString() } });
    const { res, error } = await runController(orgController.getOrganization, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.wallet.balance).toBe(500);
    expect(res.body.data.superAdmin.name).toBe("Org Super Admin");
    expect(res.body.data.userCounts.SUPER_ADMIN).toBe(1);
    expect(res.body.data.userCounts.USER).toBe(1);
    expect(res.body.data.userCounts.totalActive).toBe(1); // the User was created inactive
  });

  it("search matches the organization name and a regex-metacharacter query never 500s (treated literally, not as a pattern)", async () => {
    await makeActiveOrg({ name: "Acme (Pvt) Ltd" });
    await makeActiveOrg({ name: "Other Co" });

    const req = masterAdminReq({ query: { search: "Acme (Pvt)" } });
    const { res, error } = await runController(orgController.listOrganizations, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].name).toBe("Acme (Pvt) Ltd");
  });
});

describe("Organization editing", () => {
  it("Master Admin can update allowed fields", async () => {
    const org = await makeActiveOrg();
    const body = updateOrganizationSchema.parse({ name: "Renamed Co", address: "123 New Street" });
    const req = masterAdminReq({ params: { id: org._id.toString() }, body });
    const { res, error } = await runController(orgController.updateOrganization, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.name).toBe("Renamed Co");
    expect(res.body.data.address).toBe("123 New Street");

    const auditEntry = await AuditLog.findOne({ action: AuditAction.ORG_MODIFIED, entityId: org._id.toString() });
    expect(auditEntry).not.toBeNull();
  });

  it("protected fields (status, isEstampServiceEnabled) cannot be modified via the edit endpoint even if present in the body", async () => {
    const org = await makeActiveOrg({ status: OrganizationStatus.ACTIVE });
    const req = masterAdminReq({
      params: { id: org._id.toString() },
      body: { name: "Still Renamed", status: OrganizationStatus.SUSPENDED, isEstampServiceEnabled: true },
    });
    const { res, error } = await runController(orgController.updateOrganization, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.status).toBe(OrganizationStatus.ACTIVE); // unchanged
    expect(res.body.data.isEstampServiceEnabled).toBe(false); // unchanged
  });

  it("the schema itself rejects unknown fields outright", () => {
    const result = updateOrganizationSchema.safeParse({ name: "X", status: OrganizationStatus.SUSPENDED });
    expect(result.success).toBe(false);
  });
});

describe("Organization status lifecycle", () => {
  it("Master Admin can deactivate and reactivate an organization", async () => {
    const org = await makeActiveOrg();
    const deactivateReq = masterAdminReq({ params: { id: org._id.toString() }, body: { status: OrganizationStatus.DEACTIVATED } });
    const { res: deactivateRes, error: e1 } = await runController(orgController.updateOrganizationStatus, deactivateReq, makeRes());
    expect(e1).toBeNull();
    expect(deactivateRes.body.data.status).toBe(OrganizationStatus.DEACTIVATED);

    const reactivateReq = masterAdminReq({ params: { id: org._id.toString() }, body: { status: OrganizationStatus.ACTIVE } });
    const { res: reactivateRes, error: e2 } = await runController(orgController.updateOrganizationStatus, reactivateReq, makeRes());
    expect(e2).toBeNull();
    expect(reactivateRes.body.data.status).toBe(OrganizationStatus.ACTIVE);
  });

  it("a deactivated organization's users cannot authenticate", async () => {
    const org = await makeActiveOrg();
    const password = "ChangeMe!SuperAdmin1";
    const passwordHash = await AuthService.hashPassword(password);
    const superAdmin = await User.create({
      name: "Locked Out Admin",
      email: `locked-${new mongoose.Types.ObjectId()}@ld.local`,
      passwordHash,
      role: Role.SUPER_ADMIN,
      organizationId: org._id,
      lastOtpVerifiedAt: new Date(),
    });
    org.status = OrganizationStatus.SUSPENDED;
    await org.save();

    await expect(AuthService.loginStep1(superAdmin.email, password, makeReq())).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("Super Admin provisioning", () => {
  it("creates the initial Super Admin with the correct role and organizationId", async () => {
    const org = await makeActiveOrg();
    const body = provisionSuperAdminSchema.parse({ name: "New Super Admin", email: `newsa-${new mongoose.Types.ObjectId()}@ld.local`, phone: "9999999999" });
    const req = masterAdminReq({ params: { id: org._id.toString() }, body });
    const { res, error } = await runController(orgController.provisionSuperAdmin, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.user.role).toBe(Role.SUPER_ADMIN);
    expect(res.body.data.user.organizationId.toString()).toBe(org._id.toString());
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.tempPassword).toBeDefined();
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });

  it("rejects provisioning a second Super Admin for the same organization", async () => {
    const org = await makeActiveOrg();
    const firstBody = provisionSuperAdminSchema.parse({ name: "First SA", email: `first-${new mongoose.Types.ObjectId()}@ld.local` });
    await runController(orgController.provisionSuperAdmin, masterAdminReq({ params: { id: org._id.toString() }, body: firstBody }), makeRes());

    const secondBody = provisionSuperAdminSchema.parse({ name: "Second SA", email: `second-${new mongoose.Types.ObjectId()}@ld.local` });
    const { error } = await runController(orgController.provisionSuperAdmin, masterAdminReq({ params: { id: org._id.toString() }, body: secondBody }), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(409);
  });

  it("rejects a duplicate email already used by another account", async () => {
    const org = await makeActiveOrg();
    const email = `taken-${new mongoose.Types.ObjectId()}@ld.local`;
    await User.create({ name: "Existing", email, passwordHash: "x", role: Role.USER, organizationId: org._id });

    const body = provisionSuperAdminSchema.parse({ name: "New SA", email });
    const { error } = await runController(orgController.provisionSuperAdmin, masterAdminReq({ params: { id: org._id.toString() }, body }), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(409);
  });
});

describe("Assistant Master Admin: organization permissions are explicit, not role-wide", () => {
  it("an Assistant with no CLIENT_VIEW/CLIENT_MANAGE permission is denied by requirePermission", async () => {
    const req = assistantReq([]);
    const { threw: viewThrew } = await runMiddleware(requirePermission(Permission.CLIENT_VIEW), req, makeRes());
    expect(viewThrew).not.toBeNull();
    expect(viewThrew.statusCode).toBe(403);

    const { threw: manageThrew } = await runMiddleware(requirePermission(Permission.CLIENT_MANAGE), req, makeRes());
    expect(manageThrew).not.toBeNull();
    expect(manageThrew.statusCode).toBe(403);
  });

  it("an Assistant explicitly granted CLIENT_MANAGE can create an organization, which is audited and notifies Master Admin", async () => {
    const master = await User.create({ name: "Master", email: `m-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    const req = assistantReq([Permission.CLIENT_MANAGE]);
    const { threw } = await runMiddleware(requirePermission(Permission.CLIENT_MANAGE), req, makeRes());
    expect(threw).toBeNull();

    const body = createOrganizationSchema.parse({ name: "Assistant Created Co", contactEmail: `assistant-created-${new mongoose.Types.ObjectId()}@example.com`, contactPhone: "9999999999" });
    const createReq = assistantReq([Permission.CLIENT_MANAGE], { body });
    const { res, error } = await runController(orgController.createOrganization, createReq, makeRes());
    expect(error).toBeNull();

    const auditEntry = await AuditLog.findOne({ action: AuditAction.ORG_CREATED, entityId: res.body.data._id.toString() });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.actorRole).toBe(Role.ASSISTANT_MASTER_ADMIN);

    const notification = await Notification.findOne({ recipientId: master._id, organizationId: res.body.data._id.toString() });
    expect(notification).not.toBeNull();
    expect(notification.type).toBe("ASSISTANT_ADMIN_ACTIVITY");
  });
});

describe("Tenant isolation: organization sub-resources cannot be reached by client roles", () => {
  it("requirePermission alone does not admit tenant roles that lack the permission (they have no CLIENT_* permission by default)", async () => {
    const req = makeReq({ user: { id: "x", role: Role.SUPER_ADMIN, organizationId: new mongoose.Types.ObjectId().toString(), permissions: [] } });
    const { threw } = await runMiddleware(requirePermission(Permission.CLIENT_VIEW), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });
});
