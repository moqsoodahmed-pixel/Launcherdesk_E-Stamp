// Master Admin vendor account actions: reset password and delete. Real HTTP
// (authenticate, requireRole, rate limiter) as wired.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import "./setup";
import mongoose from "mongoose";
import {
  Organization, Wallet, User, Article, ArticleVersion, EStampRequest, EStampOrder, RefreshToken, AuditLog, SystemSetting, EmailLog,
} from "../src/models/index.js";
import { Role, Permission, OrganizationStatus, AuditAction } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { createApp } from "../src/app.js";

const uid = () => new mongoose.Types.ObjectId();
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const OLD_PASSWORD = "ChangeMe!User1";
let server;
let base;
beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());
beforeEach(() => SystemSetting.updateOne({ key: "ESTAMP_FULFILMENT" }, { $set: { value: "manual" }, $inc: { version: 1 } }, { upsert: true }));

const call = (method, path, token, body) =>
  fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
async function makeUser(role, overrides = {}) {
  const user = await User.create({ name: `${role} u`, email: `${role.toLowerCase()}-${uid()}@ld.local`, passwordHash: await AuthService.hashPassword(OLD_PASSWORD), role, lastOtpVerifiedAt: new Date(), ...overrides });
  const tokens = await AuthService.issueTokens(user);
  return { user, token: tokens.accessToken, refreshToken: tokens.refreshToken };
}
const makeVendor = (overrides) => makeUser(Role.VENDOR, overrides);
const makeAssistant = () => makeUser(Role.ASSISTANT_MASTER_ADMIN, { permissions: [Permission.ORDER_VIEW, Permission.ORDER_MANAGE, Permission.CLIENT_VIEW] });
async function lockedOrder() {
  const org = await Organization.create({ name: `Org ${uid()}`, contactEmail: `o-${uid()}@example.com`, contactPhone: "1", createdBy: uid(), status: OrganizationStatus.ACTIVE, isEstampServiceEnabled: true });
  await Wallet.create({ organizationId: org._id, balance: 5000 });
  const article = await Article.create({ stateCode: "KA", articleCode: `A-${uid()}`, title: "Rental Agreement", createdBy: uid(), currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 500 }, createdBy: uid() });
  const { user: client } = await makeUser(Role.SUPER_ADMIN, { organizationId: org._id });
  const { request, order } = await EStampRequestService.createRequest({ organizationId: org._id, createdBy: client._id, actorRole: Role.SUPER_ADMIN, stateCode: "KA", articleId: article._id.toString(), firstParty: "A", secondParty: "B", descriptionOfDocument: "Rent", considerationPrice: 0, stampDutyPaidBy: "A", numberOfEStamps: 1, idempotencyKey: `adm-${uid()}` });
  await EStampRequest.updateOne({ _id: request._id }, { $set: { modificationDeadline: new Date(Date.now() - 1000) } });
  await EStampRequestService.lockExpiredRequests();
  return EStampOrder.findById(order._id);
}
const dispatch = (master, order, vendor) => call("POST", "/orders/dispatch", master, { orderIds: [order._id.toString()], vendorId: vendor._id.toString() });
const passwordWorks = (email, password) => AuthService.loginStep1(email, password).then(() => true, () => false);

describe("access", () => {
  it("only Master Admin can reset or delete; a non-vendor id is 404 and untouched", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const { token: assistant } = await makeAssistant();
    const { user: vendor, token: vendorToken } = await makeVendor();
    for (const token of [assistant, vendorToken]) {
      expect((await call("POST", `/vendors/${vendor._id}/reset-password`, token)).status).toBe(403);
      expect((await call("DELETE", `/vendors/${vendor._id}`, token)).status).toBe(403);
    }
    const { user: someoneElse } = await makeAssistant();
    const { user: otherMaster } = await makeUser(Role.MASTER_ADMIN);
    for (const id of [someoneElse._id, otherMaster._id, uid(), "not-an-id"]) {
      expect((await call("POST", `/vendors/${id}/reset-password`, master)).status).toBe(404);
      expect((await call("DELETE", `/vendors/${id}`, master)).status).toBe(404);
    }
    expect(await User.countDocuments({ _id: { $in: [someoneElse._id, otherMaster._id] }, isActive: true })).toBe(2);
    expect(await passwordWorks(someoneElse.email, OLD_PASSWORD)).toBe(true);
  });
});

describe("reset password", () => {
  it("replaces the hash, forces a change, ends every session; old password fails, new one works; audited without the password", async () => {
    const { user: master, token } = await makeUser(Role.MASTER_ADMIN);
    const { user: vendor, token: vendorToken, refreshToken } = await makeVendor();
    const before = await User.findById(vendor._id).select("+passwordHash");
    expect((await call("GET", "/vendor/orders", vendorToken)).status).toBe(200);

    const r = await call("POST", `/vendors/${vendor._id}/reset-password`, token);
    expect(r.status).toBe(200);
    const { tempPassword } = r.body.data;
    expect(tempPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(Object.keys(r.body.data)).toEqual(["tempPassword"]);

    const after = await User.findById(vendor._id).select("+passwordHash");
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordHash).not.toContain(tempPassword);
    expect(after.mustChangePassword).toBe(true);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(await RefreshToken.countDocuments({ userId: vendor._id, revokedAt: null })).toBe(0);
    expect((await call("GET", "/vendor/orders", vendorToken)).status).toBe(401);
    await expect(AuthService.refresh(refreshToken)).rejects.toBeTruthy();

    expect(await passwordWorks(vendor.email, OLD_PASSWORD)).toBe(false);
    expect(await passwordWorks(vendor.email, tempPassword)).toBe(true);

    const audit = await AuditLog.findOne({ action: AuditAction.PASSWORD_RESET_COMPLETED, entityId: vendor._id.toString() });
    expect(audit.actorId.toString()).toBe(master._id.toString());
    expect(JSON.stringify(audit)).not.toContain(tempPassword);
    expect(await EmailLog.countDocuments({ to: vendor.email })).toBe(0);
    // Two resets give two different passwords.
    const again = await call("POST", `/vendors/${vendor._id}/reset-password`, token);
    expect(again.body.data.tempPassword).not.toBe(tempPassword);
  });
});

describe("delete", () => {
  it("is blocked while orders are with the vendor, with the count", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: vendor } = await makeVendor();
    const one = await lockedOrder();
    const two = await lockedOrder();
    expect((await dispatch(master, one, vendor)).body.data.sent).toBe(1);
    expect((await dispatch(master, two, vendor)).body.data.sent).toBe(1);
    const r = await call("DELETE", `/vendors/${vendor._id}`, master);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("VENDOR_HAS_OPEN_ORDERS");
    expect(r.body.message).toBe("2 orders are still with this vendor. Recall or reassign them first.");
    expect(await User.exists({ _id: vendor._id, isActive: true, deletedAt: null })).toBeTruthy();
  });

  it("hard-deletes a never-used vendor and audits it; the email can be reused", async () => {
    const { user: master, token } = await makeUser(Role.MASTER_ADMIN);
    const created = await call("POST", "/vendors", token, { name: "Unused Co", email: "unused@vendor.test" });
    const id = created.body.data.user._id;
    const r = await call("DELETE", `/vendors/${id}`, token);
    expect(r.status).toBe(200);
    expect(r.body.data.deleted).toBe("hard");
    expect(await User.exists({ _id: id })).toBeNull();
    const audit = await AuditLog.findOne({ action: AuditAction.USER_DELETED, entityId: id });
    expect(audit.actorId.toString()).toBe(master._id.toString());
    expect(audit.metadata.deleted).toBe("hard");
    expect((await call("POST", "/vendors", token, { name: "Unused Again", email: "unused@vendor.test" })).status).toBe(201);
  });

  it("soft-deletes a vendor with history: hidden, cannot log in, old orders still show it, email reusable", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: vendor, token: vendorToken } = await makeVendor({ email: "used@vendor.test", name: "Used Co" });
    const order = await lockedOrder();
    expect((await dispatch(master, order, vendor)).body.data.sent).toBe(1);
    // Recall: nothing is with the vendor any more, but history remains.
    expect((await call("POST", `/orders/${order._id}/recall`, master)).status).toBe(200);
    const historic = await lockedOrder();
    await dispatch(master, historic, vendor);
    const form = new FormData();
    form.append("file", new Blob([PDF], { type: "application/pdf" }), "s.pdf");
    form.append("stampReference", "KA-HIST-1");
    expect((await fetch(`${base}/vendor/orders/${historic._id}/upload`, { method: "POST", headers: { Authorization: `Bearer ${vendorToken}` }, body: form })).status).toBe(200);
    expect((await call("POST", `/orders/${historic._id}/vendor-approve`, master)).status).toBe(200);

    const r = await call("DELETE", `/vendors/${vendor._id}`, master);
    expect(r.status).toBe(200);
    expect(r.body.data.deleted).toBe("soft");
    const stored = await User.findById(vendor._id);
    expect(stored).toMatchObject({ isActive: false, email: `deleted+${vendor._id}@deleted.invalid` });
    expect(stored.deletedAt).toBeInstanceOf(Date);
    expect((await call("GET", "/vendor/orders", vendorToken)).status).toBe(401);
    expect(await passwordWorks("used@vendor.test", OLD_PASSWORD)).toBe(false);
    expect(await passwordWorks(stored.email, OLD_PASSWORD)).toBe(false);

    expect((await call("GET", "/vendors", master)).body.data.items.map((v) => v._id)).not.toContain(vendor._id.toString());
    expect((await call("GET", "/orders/vendors", master)).body.data.items.map((v) => v._id)).not.toContain(vendor._id.toString());
    expect((await call("POST", `/vendors/${vendor._id}/reset-password`, master)).status).toBe(404);
    expect((await call("DELETE", `/vendors/${vendor._id}`, master)).status).toBe(404);
    expect((await call("PATCH", `/vendors/${vendor._id}/status`, master, { isActive: true })).status).toBe(404);

    // Old orders still resolve the vendor.
    const detail = await call("GET", `/orders/${historic._id}`, master);
    expect(detail.body.data.vendor).toMatchObject({ _id: vendor._id.toString(), name: "Used Co", isActive: false });
    expect((await EStampOrder.findById(historic._id)).vendorUploads[0].uploadedBy.toString()).toBe(vendor._id.toString());
    expect(await AuditLog.countDocuments({ action: AuditAction.USER_DELETED, entityId: vendor._id.toString() })).toBe(1);

    const reused = await call("POST", "/vendors", master, { name: "New Used Co", email: "used@vendor.test" });
    expect(reused.status).toBe(201);
    expect(reused.body.data.user._id).not.toBe(vendor._id.toString());
  });

  it("a vendor whose only history is a recalled dispatch is soft-deleted, not hard-deleted", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const vendor = await User.create({ name: "Quiet", email: `q-${uid()}@vendor.test`, passwordHash: await AuthService.hashPassword(OLD_PASSWORD), role: Role.VENDOR });
    const order = await lockedOrder();
    await dispatch(master, order, vendor);
    await call("POST", `/orders/${order._id}/recall`, master);
    expect((await call("DELETE", `/vendors/${vendor._id}`, master)).body.data.deleted).toBe("soft");
  });
});
