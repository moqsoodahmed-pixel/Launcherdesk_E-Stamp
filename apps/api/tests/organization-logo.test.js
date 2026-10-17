import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Organization, Wallet, AuditLog } from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus } from "@launcherdesk/shared";
import * as orgController from "../src/controllers/organization.controller.js";
import { requireOrganizationParamAccess } from "../src/utils/orgAccess.js";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

const orgScope = requireOrganizationParamAccess("id");

function masterAdminReq(overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: [] }, ...overrides });
}

function assistantReq(permissions = [], overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions }, ...overrides });
}

async function makeActiveOrg(overrides = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: "Logo Test Org",
    contactEmail: `org-logo-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    ...overrides,
  });
  await Wallet.create({ organizationId: org._id, balance: 500 });
  return org;
}

function fakeFile(mimetype = "image/png") {
  return { buffer: Buffer.from("fake-png-bytes"), mimetype, originalname: "logo.png" };
}

// requirePermission reads req.user.permissions directly (never recomputed
// from role here) - Master Admin's all-permissions rule is applied upstream
// by the real auth middleware, outside what these controller-level tests
// exercise, so only the Assistant-specific tests below grant CLIENT_MANAGE
// on the mock request explicitly. orgScope runs for every caller - a no-op
// pass-through for internal roles, and the real tenant-isolation check for
// an Assistant Master Admin.
async function uploadAs(req) {
  const { threw: scopeThrew } = await runMiddleware(orgScope, req, makeRes());
  if (scopeThrew) return { error: scopeThrew };
  return runController(orgController.uploadOrganizationLogo, req, makeRes());
}

describe("POST /organizations/:id/logo (Master Admin / assigned Assistant Master Admin)", () => {
  it("Master Admin can upload a logo for any organization", async () => {
    const org = await makeActiveOrg();
    const req = masterAdminReq({ params: { id: org._id.toString() }, file: fakeFile() });
    const { res, error } = await uploadAs(req, org);
    expect(error).toBeNull();
    expect(res.body.data.logoUrl).toBeTruthy();
    expect((await Organization.findById(org._id)).logoUrl).toBe(res.body.data.logoUrl);
  });

  it("writes an ORG_MODIFIED audit entry", async () => {
    const org = await makeActiveOrg();
    const masterId = new mongoose.Types.ObjectId().toString();
    const req = masterAdminReq({ user: { id: masterId, role: Role.MASTER_ADMIN, organizationId: null, permissions: [] }, params: { id: org._id.toString() }, file: fakeFile() });
    await uploadAs(req, org);
    const audit = await AuditLog.findOne({ entityId: org._id.toString(), action: AuditAction.ORG_MODIFIED, actorId: masterId });
    expect(audit).toBeTruthy();
  });

  it("an Assistant Master Admin assigned to the organization can upload its logo", async () => {
    const assistantId = new mongoose.Types.ObjectId();
    const org = await makeActiveOrg({ assignedAssistantId: assistantId });
    const req = assistantReq([Permission.CLIENT_MANAGE], { user: { id: assistantId.toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [Permission.CLIENT_MANAGE] }, params: { id: org._id.toString() }, file: fakeFile() });
    const { res, error } = await uploadAs(req, org);
    expect(error).toBeNull();
    expect(res.body.data.logoUrl).toBeTruthy();
  });

  it("an Assistant Master Admin NOT assigned to the organization is rejected (403), never reaching the upload", async () => {
    const org = await makeActiveOrg({ assignedAssistantId: new mongoose.Types.ObjectId() });
    const req = assistantReq([Permission.CLIENT_MANAGE], { params: { id: org._id.toString() }, file: fakeFile() });
    const { error } = await uploadAs(req, org);
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
    expect((await Organization.findById(org._id)).logoUrl).toBeNull();
  });

  it("rejects a non-PNG/JPEG file", async () => {
    const org = await makeActiveOrg();
    const req = masterAdminReq({ params: { id: org._id.toString() }, file: fakeFile("application/pdf") });
    const { error } = await uploadAs(req, org);
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
  });

  it("rejects a request with no file", async () => {
    const org = await makeActiveOrg();
    const req = masterAdminReq({ params: { id: org._id.toString() } });
    const { error } = await uploadAs(req, org);
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
  });

  it("404s for a nonexistent organization id", async () => {
    const req = masterAdminReq({ params: { id: new mongoose.Types.ObjectId().toString() }, file: fakeFile() });
    const { res, error } = await runController(orgController.uploadOrganizationLogo, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });
});

describe("DELETE /organizations/:id/logo", () => {
  it("clears the logo for a Master Admin", async () => {
    const org = await makeActiveOrg({ logoUrl: "https://cdn.example/old-logo.png" });
    const req = masterAdminReq({ params: { id: org._id.toString() } });
    const { res, error } = await runController(orgController.removeOrganizationLogo, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.logoUrl).toBeNull();
    expect((await Organization.findById(org._id)).logoUrl).toBeNull();
  });
});
