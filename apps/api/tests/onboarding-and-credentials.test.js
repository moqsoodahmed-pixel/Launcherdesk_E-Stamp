// One-step organization onboarding (Super Admin created with the org) and
// Master Admin reveal of SYSTEM-GENERATED temporary passwords. Real HTTP.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { Organization, Wallet, User, AuditLog, EmailLog, RefreshToken, Notification } from "../src/models/index.js";
import { Role, Permission, OrganizationStatus, AuditAction } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import { createApp } from "../src/app.js";

const require = createRequire(import.meta.url);
const { env } = require("../src/config/env.js");
const vault = require("../src/utils/credentialVault.js");
const emailProviders = require("../src/services/email-providers/index.js");

const uid = () => new mongoose.Types.ObjectId();
const KEY = randomBytes(32).toString("base64");
let server;
let base;
beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());
beforeEach(() => {
  env.CREDENTIAL_ENCRYPTION_KEY = KEY;
});
afterEach(() => {
  env.CREDENTIAL_ENCRYPTION_KEY = "";
  vi.restoreAllMocks();
});

const call = (method, path, token, body) =>
  fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json() }));
async function makeUser(role, overrides = {}) {
  const user = await User.create({ name: `${role} u`, email: `${role.toLowerCase()}-${uid()}@ld.local`, passwordHash: await AuthService.hashPassword("ChangeMe!User1"), role, lastOtpVerifiedAt: new Date(), ...overrides });
  const tokens = await AuthService.issueTokens(user);
  return { user, token: tokens.accessToken, refreshToken: tokens.refreshToken };
}
const makeAssistant = () => makeUser(Role.ASSISTANT_MASTER_ADMIN, { permissions: [Permission.CLIENT_VIEW, Permission.CLIENT_MANAGE, Permission.USER_VIEW] });
const orgBody = (overrides = {}) => ({ name: `Client ${uid()}`, contactEmail: `owner-${uid()}@client.test`, contactPhone: "9876543210", superAdminName: "Client Owner", ...overrides });
const reveal = (id, token) => call("GET", `/users/${id}/temporary-password`, token);

describe("one-step organization onboarding", () => {
  it("creates the organization, a zero wallet and the Super Admin (login = contact email), with the flags and audit", async () => {
    const { user: master, token } = await makeUser(Role.MASTER_ADMIN);
    const { user: assistant } = await makeAssistant();
    const body = orgBody({ assignedAssistantId: assistant._id.toString() });
    const r = await call("POST", "/organizations", token, body);
    expect(r.status).toBe(201);
    const { organization, superAdmin, tempPassword, emailSent } = r.body.data;
    expect(organization).toMatchObject({ status: OrganizationStatus.ACTIVE, isEstampServiceEnabled: true, assignedAssistantId: assistant._id.toString() });
    expect(emailSent).toBe(true);
    expect(tempPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const wallet = await Wallet.findOne({ organizationId: organization._id });
    expect(wallet).toMatchObject({ balance: 0, reservedBalance: 0 });
    const user = await User.findById(superAdmin._id);
    expect(user).toMatchObject({ role: Role.SUPER_ADMIN, email: body.contactEmail, phone: body.contactPhone, name: "Client Owner", mustChangePassword: true });
    expect(user.organizationId.toString()).toBe(organization._id);
    expect(user.createdBy.toString()).toBe(master._id.toString());
    expect(await AuthService.loginStep1(body.contactEmail, tempPassword).then(() => true)).toBe(true);
    expect(await AuditLog.countDocuments({ action: AuditAction.ORG_CREATED, entityId: organization._id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: AuditAction.USER_CREATED, entityId: superAdmin._id })).toBe(1);
    expect(await Notification.countDocuments({ recipientId: assistant._id, title: "Client assigned to you" })).toBe(1);

    // Welcome email: login URL, no password, no code.
    const mail = await EmailLog.findOne({ to: body.contactEmail, template: "clientWelcome" });
    expect(mail.status).not.toBe("FAILED");
    expect(JSON.stringify(mail)).not.toContain(tempPassword);
    const { renderTemplate } = require("../src/services/email-templates/index.js");
    const html = renderTemplate("clientWelcome", { name: "Client Owner", organizationName: organization.name, loginUrl: "https://app.test/login" }).html;
    expect(html).toContain("https://app.test/login");
    expect(html).toContain("Forgot password");
    expect(html).not.toMatch(/\b\d{6}\b/);

    // The list's Login column.
    const list = await call("GET", "/organizations", token);
    expect(list.body.data.items.find((o) => o._id === organization._id).hasSuperAdmin).toBe(true);
  });

  it("honours activateNow / enableEstampService false, and assigns an assistant who creates it", async () => {
    const { token } = await makeAssistant();
    const r = await call("POST", "/organizations", token, orgBody({ activateNow: false, enableEstampService: false }));
    expect(r.status).toBe(201);
    expect(r.body.data.organization).toMatchObject({ status: OrganizationStatus.PENDING_APPROVAL, isEstampServiceEnabled: false });
    const assistantId = (await User.findOne({ role: Role.ASSISTANT_MASTER_ADMIN }))._id.toString();
    expect(r.body.data.organization.assignedAssistantId).toBe(assistantId);
    expect((await call("POST", "/organizations", token, { ...orgBody(), superAdminName: undefined })).status).toBe(400);
  });

  it("a duplicate login email is 409 and creates nothing", async () => {
    const { token } = await makeUser(Role.MASTER_ADMIN);
    const { user: existing } = await makeUser(Role.VENDOR);
    const before = { orgs: await Organization.countDocuments(), wallets: await Wallet.countDocuments(), users: await User.countDocuments() };
    const r = await call("POST", "/organizations", token, orgBody({ contactEmail: existing.email.toUpperCase() }));
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/already exists/);
    expect({ orgs: await Organization.countDocuments(), wallets: await Wallet.countDocuments(), users: await User.countDocuments() }).toEqual(before);
  });

  it("rolls everything back when a step fails", async () => {
    const { token } = await makeUser(Role.MASTER_ADMIN);
    const before = { orgs: await Organization.countDocuments(), wallets: await Wallet.countDocuments(), users: await User.countDocuments() };
    vi.spyOn(User, "create").mockRejectedValueOnce(new Error("forced failure"));
    const r = await call("POST", "/organizations", token, orgBody());
    expect(r.status).toBe(500);
    expect({ orgs: await Organization.countDocuments(), wallets: await Wallet.countDocuments(), users: await User.countDocuments() }).toEqual(before);
  });

  it("an email failure still creates everything and reports emailSent:false", async () => {
    const { token } = await makeUser(Role.MASTER_ADMIN);
    vi.spyOn(emailProviders, "getEmailProvider").mockReturnValue({ send: () => Promise.reject(new Error("smtp down")) });
    const body = orgBody();
    const r = await call("POST", "/organizations", token, body);
    expect(r.status).toBe(201);
    expect(r.body.data.emailSent).toBe(false);
    expect(await User.exists({ email: body.contactEmail, role: Role.SUPER_ADMIN })).toBeTruthy();
    expect(await Organization.exists({ _id: r.body.data.organization._id })).toBeTruthy();
  });

  it("the old two-step provisioning still works for an organization without a Super Admin", async () => {
    const { token } = await makeUser(Role.MASTER_ADMIN);
    const org = await Organization.create({ name: `Legacy ${uid()}`, contactEmail: `legacy-${uid()}@client.test`, contactPhone: "1", createdBy: uid(), status: OrganizationStatus.ACTIVE });
    await Wallet.create({ organizationId: org._id, balance: 0 });
    expect((await call("GET", "/organizations", token)).body.data.items.find((o) => o._id === org._id.toString()).hasSuperAdmin).toBe(false);
    const r = await call("POST", `/organizations/${org._id}/super-admin`, token, { name: "Late Owner", email: `late-${uid()}@client.test` });
    expect(r.status).toBe(201);
    expect((await reveal(r.body.data.user._id, token)).body.data.tempPassword).toBe(r.body.data.tempPassword);
    expect((await call("POST", `/organizations/${org._id}/super-admin`, token, { name: "Twice", email: `t-${uid()}@client.test` })).status).toBe(409);
  });

  it("reset-password clears mustChangePassword, bumps tokenVersion and revokes refresh tokens", async () => {
    const { user, refreshToken } = await makeUser(Role.SUPER_ADMIN, { mustChangePassword: true });
    const before = await User.findById(user._id);
    const { OtpService } = require("../src/services/otp.service.js");
    const directToken = OtpService.issueDirectToken ? await OtpService.issueDirectToken(user._id.toString(), "PASSWORD_RESET") : null;
    if (directToken) {
      const r = await fetch(`${base}/auth/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetToken: directToken, newPassword: "MyOwn!Passw0rd9" }) });
      expect(r.status).toBe(200);
    } else {
      // Same steps the controller runs after the code is verified.
      const authController = require("../src/controllers/auth.controller.js");
      vi.spyOn(OtpService, "verify").mockResolvedValue({ userId: user._id.toString() });
      const r = await fetch(`${base}/auth/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetToken: "t".repeat(32), code: "123456", newPassword: "MyOwn!Passw0rd9" }) });
      expect([r.status, authController.resetPassword && "ok"]).toEqual([200, "ok"]);
    }
    const after = await User.findById(user._id);
    expect(after.mustChangePassword).toBe(false);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(await RefreshToken.countDocuments({ userId: user._id, revokedAt: null })).toBe(0);
    await expect(AuthService.refresh(refreshToken)).rejects.toBeTruthy();
  });
});

describe("credential vault", () => {
  it("round-trips, and fails on tampering, a wrong user id (AAD) or a wrong key", () => {
    const id = uid().toString();
    const enc = vault.encrypt(id, "Tmp-Secret-1");
    expect(enc.ciphertext).not.toContain("Tmp-Secret-1");
    expect(vault.decrypt(id, enc)).toBe("Tmp-Secret-1");
    const flipped = Buffer.from(enc.ciphertext, "base64");
    flipped[0] ^= 0xff;
    expect(() => vault.decrypt(id, { ...enc, ciphertext: flipped.toString("base64") })).toThrow();
    expect(() => vault.decrypt(id, { ...enc, tag: Buffer.alloc(16).toString("base64") })).toThrow();
    expect(() => vault.decrypt(uid().toString(), enc)).toThrow();
    expect(() => vault.decrypt(id, enc, randomBytes(32))).toThrow();
    // Two encryptions of the same value use different IVs.
    expect(vault.encrypt(id, "Tmp-Secret-1").iv).not.toBe(enc.iv);
  });

  it("is disabled without a valid key", () => {
    env.CREDENTIAL_ENCRYPTION_KEY = "";
    expect(vault.isEnabled()).toBe(false);
    env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(vault.isEnabled()).toBe(false);
    env.CREDENTIAL_ENCRYPTION_KEY = KEY;
    expect(vault.isEnabled()).toBe(true);
  });
});

describe("temporary password reveal", () => {
  async function createVendor(token) {
    const r = await call("POST", "/vendors", token, { name: "Vault Vendor", email: `vv-${uid()}@vendor.test` });
    return { id: r.body.data.user._id, tempPassword: r.body.data.tempPassword, email: r.body.data.user.email };
  }

  it("Master Admin reveals system-generated passwords for every allowed role; no-store; audited without the password", async () => {
    const { user: master, token } = await makeUser(Role.MASTER_ADMIN);
    const vendor = await createVendor(token);
    const r = await reveal(vendor.id, token);
    expect(r.status).toBe(200);
    expect(r.body.data.tempPassword).toBe(vendor.tempPassword);
    expect(new Date(r.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const audit = await AuditLog.findOne({ action: AuditAction.CREDENTIAL_REVEALED, entityId: vendor.id });
    expect(audit.actorId.toString()).toBe(master._id.toString());
    expect(JSON.stringify(audit)).not.toContain(vendor.tempPassword);

    const assistant = await call("POST", "/users/assistant-admins", token, { name: "Vault Assistant", email: `va-${uid()}@ld.test` });
    expect((await reveal(assistant.body.data.user._id, token)).body.data.tempPassword).toBe(assistant.body.data.tempPassword);
    const onboarding = await call("POST", "/organizations", token, orgBody());
    expect((await reveal(onboarding.body.data.superAdmin._id, token)).body.data.tempPassword).toBe(onboarding.body.data.tempPassword);
    // createUser (by the org's own Super Admin).
    const sa = await User.findById(onboarding.body.data.superAdmin._id);
    await User.updateOne({ _id: sa._id }, { $set: { lastOtpVerifiedAt: new Date(), mustChangePassword: false } });
    const saToken = (await AuthService.issueTokens(await User.findById(sa._id))).accessToken;
    const employee = await call("POST", "/users", saToken, { name: "Employee", email: `emp-${uid()}@client.test`, role: "USER" });
    expect(employee.status).toBe(201);
    expect((await reveal(employee.body.data.user._id, token)).body.data.tempPassword).toBe(employee.body.data.tempPassword);
    // The Master Admin vendor reset replaces it.
    const reset = await call("POST", `/vendors/${vendor.id}/reset-password`, token);
    expect((await reveal(vendor.id, token)).body.data.tempPassword).toBe(reset.body.data.tempPassword);
  });

  it("403 for every non-master role; never for a Master Admin target", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const vendor = await createVendor(master);
    const { token: assistant } = await makeAssistant();
    const { token: vendorToken } = await makeUser(Role.VENDOR);
    const org = await Organization.create({ name: `O ${uid()}`, contactEmail: `o-${uid()}@x.test`, contactPhone: "1", createdBy: uid(), status: OrganizationStatus.ACTIVE });
    const tenantTokens = [];
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.USER]) tenantTokens.push((await makeUser(role, { organizationId: org._id })).token);
    for (const t of [assistant, vendorToken, ...tenantTokens]) expect((await reveal(vendor.id, t)).status).toBe(403);

    const { user: otherMaster } = await makeUser(Role.MASTER_ADMIN);
    await vault.storeTemporaryPassword(otherMaster._id, "Never-Shown-1");
    const r = await reveal(otherMaster._id, master);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain("Never-Shown-1");
    expect((await reveal(uid(), master)).status).toBe(404);
  });

  it("never appears in list responses; lists carry passwordState only", async () => {
    const { token } = await makeUser(Role.MASTER_ADMIN);
    const vendor = await createVendor(token);
    const onboarding = await call("POST", "/organizations", token, orgBody());
    const lists = [await call("GET", "/vendors", token), await call("GET", "/users", token), await call("GET", "/users?role=ASSISTANT_MASTER_ADMIN", token), await call("GET", "/organizations", token), await call("GET", `/organizations/${onboarding.body.data.organization._id}`, token)];
    for (const l of lists) {
      const text = JSON.stringify(l.body);
      expect(text).not.toContain(vendor.tempPassword);
      expect(text).not.toContain(onboarding.body.data.tempPassword);
      expect(text).not.toMatch(/initialPasswordEnc|tempPasswordExpiresAt|ciphertext/);
    }
    expect(lists[0].body.data.items.find((v) => v._id === vendor.id).passwordState).toBe("TEMPORARY");
    expect(lists[4].body.data.superAdmin.passwordState).toBe("TEMPORARY");
    // A non-master list never carries passwordState.
    const { token: assistant } = await makeAssistant();
    expect(JSON.stringify((await call("GET", "/users", assistant)).body)).not.toContain("passwordState");
  });

  it("purged on change-password, reset, delete and after 7 days; reveal is 404 afterwards", async () => {
    const { token } = await makeUser(Role.MASTER_ADMIN);
    // change-password (also the forced first-login change)
    const a = await createVendor(token);
    await User.updateOne({ _id: a.id }, { $set: { lastOtpVerifiedAt: new Date() } });
    const aToken = (await AuthService.issueTokens(await User.findById(a.id))).accessToken;
    const changed = await call("POST", "/auth/change-password", aToken, { currentPassword: a.tempPassword, newPassword: "MyOwn!Passw0rd9", confirmPassword: "MyOwn!Passw0rd9" });
    expect(changed.status).toBe(200);
    const gone = await reveal(a.id, token);
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe("NO_TEMPORARY_PASSWORD");
    expect((await call("GET", "/vendors", token)).body.data.items.find((v) => v._id === a.id).passwordState).toBe("SET_BY_USER");
    // reset-password (forgot password flow)
    const b = await createVendor(token);
    const { OtpService } = require("../src/services/otp.service.js");
    vi.spyOn(OtpService, "verify").mockResolvedValue({ userId: b.id });
    const resetRes = await fetch(`${base}/auth/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetToken: "t".repeat(32), code: "123456", newPassword: "MyOwn!Passw0rd9" }) });
    expect(resetRes.status).toBe(200);
    expect((await reveal(b.id, token)).status).toBe(404);
    // delete (soft: give it history first)
    const c = await createVendor(token);
    await AuditLog.create({ actorId: c.id, actorRole: Role.VENDOR, action: AuditAction.LOGIN });
    expect((await call("DELETE", `/vendors/${c.id}`, token)).body.data.deleted).toBe("soft");
    expect(await User.findById(c.id).select("+initialPasswordEnc +tempPasswordExpiresAt").then((u) => [u.initialPasswordEnc, u.tempPasswordExpiresAt])).toEqual([undefined, undefined]);
    expect((await reveal(c.id, token)).status).toBe(404);
    // 7 days: lazily on read...
    const d = await createVendor(token);
    await User.updateOne({ _id: d.id }, { $set: { tempPasswordExpiresAt: new Date(Date.now() - 1000) } });
    expect((await reveal(d.id, token)).status).toBe(404);
    expect(await User.findById(d.id).select("+initialPasswordEnc").then((u) => u.initialPasswordEnc)).toBeUndefined();
    // ...and by the hourly job.
    const e = await createVendor(token);
    await User.updateOne({ _id: e.id }, { $set: { tempPasswordExpiresAt: new Date(Date.now() - 1000) } });
    expect(await vault.purgeExpiredTemporaryPasswords()).toBeGreaterThanOrEqual(1);
    expect(await User.findById(e.id).select("+initialPasswordEnc").then((u) => u.initialPasswordEnc)).toBeUndefined();
    // Deactivation alone does not purge.
    const f = await createVendor(token);
    await call("PATCH", `/vendors/${f.id}/status`, token, { isActive: false });
    expect((await reveal(f.id, token)).body.data.tempPassword).toBe(f.tempPassword);
  });

  it("without the key: creation still works and shows the password once, reveal says not available", async () => {
    env.CREDENTIAL_ENCRYPTION_KEY = "";
    const { token } = await makeUser(Role.MASTER_ADMIN);
    const vendor = await createVendor(token);
    expect(vendor.tempPassword).toBeTruthy();
    expect(await User.findById(vendor.id).select("+initialPasswordEnc").then((u) => u.initialPasswordEnc)).toBeUndefined();
    const r = await reveal(vendor.id, token);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("CREDENTIAL_REVEAL_UNAVAILABLE");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await call("GET", "/vendors", token)).body.data.items[0].passwordState).toBe("SET_BY_USER");
  });
});
