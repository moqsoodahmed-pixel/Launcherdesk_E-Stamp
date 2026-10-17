// GET /profile/organization and PATCH /profile, exercised over real HTTP so
// authenticate and the controllers run exactly as wired in profile.routes.js.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { User, Organization, AuditLog } from "../src/models/index.js";
import { Role, OrganizationStatus, AuditAction } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import { createApp } from "../src/app.js";

let server;
let base;

beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());

async function makeOrg(name) {
  return Organization.create({
    name,
    contactEmail: `${name.toLowerCase().replace(/\s/g, "")}-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    gstin: "29ABCDE1234F1Z5",
    createdBy: new mongoose.Types.ObjectId(),
    status: OrganizationStatus.ACTIVE,
  });
}

async function makeUser(overrides = {}) {
  const user = await User.create({
    name: "Profile User",
    email: `pf-${new mongoose.Types.ObjectId()}@ld.local`,
    passwordHash: await AuthService.hashPassword("ChangeMe!User1"),
    role: Role.SUPER_ADMIN,
    lastOtpVerifiedAt: new Date(),
    ...overrides,
  });
  const session = await AuthService.issueTokens(user);
  return { user, token: session.accessToken };
}

function call(method, path, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));
}

function callMultipart(method, path, token, { fieldName = "file", fileBytes = "fake-png-bytes", fileName = "logo.png", mimeType = "image/png" } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const form = new FormData();
  if (fileBytes !== null) {
    form.append(fieldName, new Blob([fileBytes], { type: mimeType }), fileName);
  }
  return fetch(`${base}${path}`, { method, headers, body: form }).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));
}

describe("GET /profile/organization", () => {
  it("requires authentication", async () => {
    const res = await call("GET", "/profile/organization");
    expect(res.status).toBe(401);
  });

  it("returns only the caller's own organization, ignoring any id in the request", async () => {
    const orgA = await makeOrg("Org A");
    const orgB = await makeOrg("Org B");
    const { token } = await makeUser({ organizationId: orgA._id });
    const res = await call("GET", `/profile/organization?organizationId=${orgB._id}&id=${orgB._id}`, token);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(orgA._id.toString());
    expect(res.body.data.name).toBe("Org A");
    expect(res.body.data.gstin).toBe("29ABCDE1234F1Z5");
    expect(res.body.data).not.toHaveProperty("createdBy");
  });

  it("returns 404 when the user has no organization", async () => {
    const { token } = await makeUser({ role: Role.MASTER_ADMIN, organizationId: undefined });
    const res = await call("GET", "/profile/organization", token);
    expect(res.status).toBe(404);
  });

  it("includes logoUrl, null when no logo has ever been uploaded", async () => {
    const org = await makeOrg("Org Logo Default");
    const { token } = await makeUser({ organizationId: org._id });
    const res = await call("GET", "/profile/organization", token);
    expect(res.status).toBe(200);
    expect(res.body.data.logoUrl).toBeNull();
  });
});

describe("POST/DELETE /profile/organization/logo", () => {
  it("requires authentication", async () => {
    const res = await callMultipart("POST", "/profile/organization/logo", null);
    expect(res.status).toBe(401);
  });

  it("a Super Admin can upload a logo - it is then returned by GET /profile/organization", async () => {
    const org = await makeOrg("Org Logo Upload");
    const { token } = await makeUser({ organizationId: org._id });
    const res = await callMultipart("POST", "/profile/organization/logo", token);
    expect(res.status).toBe(200);
    expect(res.body.data.logoUrl).toBeTruthy();

    const fresh = await Organization.findById(org._id);
    expect(fresh.logoUrl).toBe(res.body.data.logoUrl);

    const read = await call("GET", "/profile/organization", token);
    expect(read.body.data.logoUrl).toBe(res.body.data.logoUrl);
  });

  it("writes an ORG_MODIFIED audit entry on upload", async () => {
    const org = await makeOrg("Org Logo Audit");
    const { user, token } = await makeUser({ organizationId: org._id });
    await callMultipart("POST", "/profile/organization/logo", token);
    const audit = await AuditLog.findOne({ entityId: org._id.toString(), action: AuditAction.ORG_MODIFIED, actorId: user._id });
    expect(audit).toBeTruthy();
  });

  it("an Admin or User (not Super Admin) is rejected with 403, never reaching the upload", async () => {
    const org = await makeOrg("Org Logo Forbidden");
    for (const role of [Role.ADMIN, Role.USER]) {
      const { token } = await makeUser({ role, organizationId: org._id });
      const res = await callMultipart("POST", "/profile/organization/logo", token);
      expect(res.status).toBe(403);
    }
    expect((await Organization.findById(org._id)).logoUrl).toBeNull();
  });

  it("rejects a non-PNG/JPEG file", async () => {
    const org = await makeOrg("Org Logo Bad Type");
    const { token } = await makeUser({ organizationId: org._id });
    const res = await callMultipart("POST", "/profile/organization/logo", token, { mimeType: "application/pdf", fileName: "logo.pdf" });
    expect(res.status).toBe(400);
  });

  it("rejects an upload with no file", async () => {
    const org = await makeOrg("Org Logo No File");
    const { token } = await makeUser({ organizationId: org._id });
    const res = await callMultipart("POST", "/profile/organization/logo", token, { fileBytes: null });
    expect(res.status).toBe(400);
  });

  it("DELETE clears the logo back to null, and only a Super Admin may call it", async () => {
    const org = await makeOrg("Org Logo Remove");
    const { token: superToken } = await makeUser({ organizationId: org._id });
    await callMultipart("POST", "/profile/organization/logo", superToken);
    expect((await Organization.findById(org._id)).logoUrl).toBeTruthy();

    const { token: adminToken } = await makeUser({ role: Role.ADMIN, organizationId: org._id });
    const forbidden = await fetch(`${base}/profile/organization/logo`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
    expect(forbidden.status).toBe(403);

    const res = await fetch(`${base}/profile/organization/logo`, { method: "DELETE", headers: { Authorization: `Bearer ${superToken}` } });
    expect(res.status).toBe(200);
    expect((await Organization.findById(org._id)).logoUrl).toBeNull();
  });
});

describe("PATCH /profile", () => {
  it("requires authentication", async () => {
    const res = await call("PATCH", "/profile", null, { name: "Someone" });
    expect(res.status).toBe(401);
  });

  it("updates name and phone, writes a USER_MODIFIED audit entry and never returns passwordHash", async () => {
    const org = await makeOrg("Org P");
    const { user, token } = await makeUser({ organizationId: org._id });
    const res = await call("PATCH", "/profile", token, { name: "  New Name  ", phone: "9876543210" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("New Name");
    expect(res.body.data.phone).toBe("9876543210");
    expect(res.body.data).not.toHaveProperty("passwordHash");
    const audit = await AuditLog.findOne({ entityId: user._id, action: AuditAction.USER_MODIFIED });
    expect(audit).toBeTruthy();
    expect(audit.actorId.toString()).toBe(user._id.toString());
  });

  it("clears the phone when an empty string is sent", async () => {
    const { user, token } = await makeUser({ phone: "1234567" });
    const res = await call("PATCH", "/profile", token, { phone: "" });
    expect(res.status).toBe(200);
    const fresh = await User.findById(user._id);
    expect(fresh.phone).toBeUndefined();
  });

  it("rejects invalid name, invalid phone and an empty body", async () => {
    const { token } = await makeUser();
    expect((await call("PATCH", "/profile", token, { name: "A" })).status).toBe(400);
    expect((await call("PATCH", "/profile", token, { name: "x".repeat(151) })).status).toBe(400);
    expect((await call("PATCH", "/profile", token, { phone: "123" })).status).toBe(400);
    expect((await call("PATCH", "/profile", token, { phone: "1".repeat(21) })).status).toBe(400);
    expect((await call("PATCH", "/profile", token, {})).status).toBe(400);
  });

  it("never changes email, role or organization", async () => {
    const org = await makeOrg("Org R");
    const other = await makeOrg("Org Other");
    const { user, token } = await makeUser({ role: Role.USER, organizationId: org._id });
    const res = await call("PATCH", "/profile", token, {
      name: "Still Me",
      email: "hacker@example.com",
      role: Role.MASTER_ADMIN,
      organizationId: other._id.toString(),
    });
    expect(res.status).toBe(200);
    const fresh = await User.findById(user._id);
    expect(fresh.name).toBe("Still Me");
    expect(fresh.email).toBe(user.email);
    expect(fresh.role).toBe(Role.USER);
    expect(fresh.organizationId.toString()).toBe(org._id.toString());
  });
});
