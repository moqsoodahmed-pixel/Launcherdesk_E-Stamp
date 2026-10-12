// Vendor workflow (manual fulfilment): assistant dispatches charged orders
// to a VENDOR, the vendor uploads certificates one by one, the assistant
// approves (same issue step as manual fulfilment) or rejects. Runs over real
// HTTP so authenticate (incl. the VENDOR fence), authorize, multer and
// validation are exercised exactly as wired.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import "./setup";
import mongoose from "mongoose";
import {
  Organization, Wallet, WalletTransaction, User, Article, ArticleVersion, EStampRequest, EStampOrder, EStampDocument, FileAsset, Notification, AuditLog, SystemSetting, EmailLog,
} from "../src/models/index.js";
import { Role, Permission, OrganizationStatus, EStampRequestStatus, AuditAction, VendorStatus, DEFAULT_ROLE_PERMISSIONS, getEffectivePermissions, ROLE_LEVEL } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { createApp } from "../src/app.js";

const uid = () => new mongoose.Types.ObjectId();
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
let server;
let base;
beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());
const setMode = (mode) => SystemSetting.updateOne({ key: "ESTAMP_FULFILMENT" }, { $set: { value: mode }, $inc: { version: 1 } }, { upsert: true });
beforeEach(() => setMode("manual"));

const call = (method, path, token, body) =>
  fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
function vendorUpload(orderId, token, { file = PDF, type = "application/pdf", name = "stamp.pdf", stampReference = "KA-VEND-0001", notes } = {}) {
  const form = new FormData();
  if (file) form.append("file", new Blob([file], { type }), name);
  if (stampReference !== undefined) form.append("stampReference", stampReference);
  if (notes) form.append("notes", notes);
  return fetch(`${base}/vendor/orders/${orderId}/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

async function makeUser(role, overrides = {}) {
  const user = await User.create({ name: `${role} u`, email: `${role.toLowerCase()}-${uid()}@ld.local`, phone: "9999999999", passwordHash: await AuthService.hashPassword("ChangeMe!User1"), role, lastOtpVerifiedAt: new Date(), ...overrides });
  return { user, token: (await AuthService.issueTokens(user)).accessToken };
}
const STAFF_PERMS = [Permission.ORDER_VIEW, Permission.ORDER_MANAGE, Permission.CLIENT_VIEW, Permission.ESTAMP_VIEW];
const makeAssistant = () => makeUser(Role.ASSISTANT_MASTER_ADMIN, { permissions: STAFF_PERMS });
const makeVendor = (overrides) => makeUser(Role.VENDOR, overrides);

async function makeOrg({ balance = 5000, assignedAssistantId = null } = {}) {
  const org = await Organization.create({ name: `Vendor Org ${uid()}`, contactEmail: `v-${uid()}@example.com`, contactPhone: "1", createdBy: uid(), status: OrganizationStatus.ACTIVE, isEstampServiceEnabled: true, assignedAssistantId });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `VEN-${uid()}`, title: "Rental Agreement", createdBy: uid(), currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 500 }, createdBy: uid() });
  const { user: client, token: clientToken } = await makeUser(Role.SUPER_ADMIN, { organizationId: org._id });
  return { org, article, client, clientToken };
}
async function submit(ctx) {
  return EStampRequestService.createRequest({ organizationId: ctx.org._id, createdBy: ctx.client._id, actorRole: Role.SUPER_ADMIN, stateCode: "KA", articleId: ctx.article._id.toString(), firstParty: "Alice", secondParty: "Bob", descriptionOfDocument: "Rent", propertyDescription: "Flat 4B", considerationPrice: 1000, stampDutyPaidBy: "Alice", numberOfEStamps: 1, idempotencyKey: `ven-${uid()}` });
}
async function lockedOrder(ctx) {
  const { request, order } = await submit(ctx);
  await EStampRequest.updateOne({ _id: request._id }, { $set: { modificationDeadline: new Date(Date.now() - 1000) } });
  await EStampRequestService.lockExpiredRequests();
  return { request: await EStampRequest.findById(request._id), order: await EStampOrder.findById(order._id) };
}
// A charged order already dispatched to `vendor`.
async function dispatched(ctx, staffToken, vendor) {
  const { request, order } = await lockedOrder(ctx);
  const r = await call("POST", "/orders/dispatch", staffToken, { orderIds: [order._id.toString()], vendorId: vendor._id.toString() });
  expect(r.status).toBe(200);
  expect(r.body.data.results[0].ok).toBe(true);
  return { request, order: await EStampOrder.findById(order._id) };
}
const MONEY_OR_CONTACT = /amount|balance|wallet|payment|charge|reserved|refund|email|phone|contact|createdBy|organizationId|userId|vendorId|dispatchedBy/i;
function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, keys));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { keys.add(k); collectKeys(v, keys); }
  return keys;
}

describe("VENDOR role definition", () => {
  it("has the lowest authority level and only NOTIFICATION_VIEW", () => {
    expect(Role.VENDOR).toBe("VENDOR");
    expect(ROLE_LEVEL[Role.VENDOR]).toBeGreaterThan(ROLE_LEVEL[Role.USER]);
    expect(DEFAULT_ROLE_PERMISSIONS[Role.VENDOR]).toEqual([Permission.NOTIFICATION_VIEW]);
    // Extra stored permissions never matter: the fence and requireRole guard every vendor route.
    expect(getEffectivePermissions(Role.VENDOR, [])).toEqual([Permission.NOTIFICATION_VIEW]);
  });
});

describe("vendor accounts (Master Admin)", () => {
  it("creates a vendor with a one-time temp password, emails no password, and deactivation blocks it", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const created = await call("POST", "/vendors", master, { name: "Stamp Vendor", email: "Vendor@Example.com", phone: "9876543210" });
    expect(created.status).toBe(201);
    const { user, tempPassword } = created.body.data;
    expect(tempPassword).toBeTruthy();
    expect(user.passwordHash).toBeUndefined();
    const stored = await User.findById(user._id);
    expect(stored.role).toBe(Role.VENDOR);
    expect(stored.organizationId).toBeNull();
    expect(stored.mustChangePassword).toBe(true);
    const mail = await EmailLog.findOne({ to: "vendor@example.com" });
    expect(mail.template).toBe("vendorWelcome");
    expect(JSON.stringify(mail)).not.toContain(tempPassword);
    expect(await AuditLog.countDocuments({ action: AuditAction.USER_CREATED, entityId: user._id.toString() })).toBe(1);

    expect((await call("POST", "/vendors", master, { name: "Dup", email: "vendor@example.com" })).status).toBe(409);
    expect((await call("POST", "/vendors", master, { name: "X", email: "x@example.com", role: "MASTER_ADMIN" })).status).toBe(400);
    const list = await call("GET", "/vendors", master);
    expect(list.body.data.items.map((v) => v.email)).toContain("vendor@example.com");

    const { token: vendorToken } = await (async () => ({ token: (await AuthService.issueTokens(await User.findByIdAndUpdate(user._id, { lastOtpVerifiedAt: new Date() }, { new: true }))).accessToken }))();
    expect((await call("GET", "/vendor/orders", vendorToken)).status).toBe(200);
    const off = await call("PATCH", `/vendors/${user._id}/status`, master, { isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);
    expect((await call("GET", "/vendor/orders", vendorToken)).status).toBe(401);

    // A deactivated vendor cannot receive orders either.
    const { user: a, token: staff } = await makeAssistant();
    const ctx = await makeOrg({ assignedAssistantId: a._id });
    const { order } = await lockedOrder(ctx);
    const r = await call("POST", "/orders/dispatch", staff, { orderIds: [order._id.toString()], vendorId: user._id.toString() });
    expect(r.status).toBe(409);
    expect((await call("PATCH", `/vendors/${user._id}/status`, master, { isActive: true })).body.data.isActive).toBe(true);
  });

  it("only Master Admin manages vendors", async () => {
    const { token: assistant } = await makeAssistant();
    const { token: client } = await makeUser(Role.SUPER_ADMIN, { organizationId: (await makeOrg()).org._id });
    const { token: vendor } = await makeVendor();
    for (const token of [assistant, client, vendor]) {
      expect((await call("GET", "/vendors", token)).status).toBe(403);
      expect((await call("POST", "/vendors", token, { name: "Nope", email: `n-${uid()}@x.com` })).status).toBe(403);
    }
  });
});

describe("vendor fence", () => {
  it("a vendor gets 403 on every non-vendor route and can use its own surface", async () => {
    const { token } = await makeVendor();
    const orderId = uid().toString();
    const denied = [
      ["GET", "/wallet/balance"], ["GET", "/wallet/transactions"], ["GET", "/payments"], ["POST", "/payments/create-order"],
      ["GET", "/organizations"], ["GET", "/users"], ["GET", "/reports/dashboard"], ["GET", "/reports/summary"],
      ["GET", "/orders"], ["GET", `/orders/${orderId}`], ["POST", "/orders/dispatch"], ["GET", `/files/estamp/${orderId}/download`],
      ["POST", "/files/upload"], ["GET", "/estamps"], ["GET", "/audit"], ["GET", "/audit/mine"], ["GET", "/estamp-packages"],
      ["GET", "/settings"], ["GET", "/articles"], ["GET", "/bulk-estamps/template"], ["GET", "/vendors"], ["GET", "/profile/organization"],
    ];
    for (const [method, path] of denied) {
      const r = await call(method, path, token, method === "POST" ? {} : undefined);
      expect([path, r.status]).toEqual([path, 403]);
    }
    for (const path of ["/vendor/orders", "/vendor/orders/summary", "/notifications", "/notifications/unread-count", "/auth/me"]) {
      expect([path, (await call("GET", path, token)).status]).toEqual([path, 200]);
    }
  });

  it("non-vendor roles cannot reach /vendor/*", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const { token: assistant } = await makeAssistant();
    const { clientToken } = await makeOrg();
    for (const token of [master, assistant, clientToken]) expect((await call("GET", "/vendor/orders", token)).status).toBe(403);
  });
});

describe("dispatch", () => {
  it("sends charged locked orders, reports partial failures per order, and notifies the vendor once", async () => {
    const { user: a, token: staff } = await makeAssistant();
    const { user: vendor } = await makeVendor();
    const { user: otherVendor } = await makeVendor();
    const ctx = await makeOrg({ assignedAssistantId: a._id });
    const good1 = await lockedOrder(ctx);
    const good2 = await lockedOrder(ctx);
    const inWindow = await submit(ctx);
    const cancelled = await submit(ctx);
    await EStampRequestService.cancelRequest(cancelled.request._id.toString(), ctx.org._id, ctx.client._id.toString(), Role.SUPER_ADMIN);
    const short = await submit(ctx);
    await Wallet.updateOne({ organizationId: ctx.org._id }, { $set: { balance: 0 } });
    await EStampRequest.updateOne({ _id: short.request._id }, { $set: { modificationDeadline: new Date(Date.now() - 1000) } });
    await EStampRequestService.lockExpiredRequests();
    expect((await EStampRequest.findById(short.request._id)).chargeStatus).toBe("SHORTFALL");
    const missing = uid().toString();

    const ids = [good1.order, good2.order, inWindow.order, cancelled.order, short.order].map((o) => o._id.toString());
    const r = await call("POST", "/orders/dispatch", staff, { orderIds: [...ids, missing], vendorId: vendor._id.toString() });
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.body.data.results.map((x) => [x.orderId, x]));
    expect(byId[ids[0]].ok).toBe(true);
    expect(byId[ids[1]].ok).toBe(true);
    expect(byId[ids[2]]).toMatchObject({ ok: false, reason: "NOT_LOCKED" });
    expect(byId[ids[3]].ok).toBe(false);
    expect(byId[ids[4]]).toMatchObject({ ok: false, reason: "NOT_CHARGED" });
    expect(byId[missing]).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    expect(r.body.data.sent).toBe(2);

    const sent = await EStampOrder.findById(good1.order._id);
    expect(sent.vendorStatus).toBe(VendorStatus.SENT);
    expect(sent.eStampStatus).toBe("PROCESSING");
    expect(sent.vendorId.toString()).toBe(vendor._id.toString());
    expect(sent.dispatchedBy.toString()).toBe(a._id.toString());
    expect((await EStampRequest.findById(good1.request._id)).status).toBe(EStampRequestStatus.PROCESSING);
    expect(await AuditLog.countDocuments({ action: AuditAction.ORDER_DISPATCHED, actorId: a._id })).toBe(2);
    expect((await EStampOrder.findById(inWindow.order._id)).vendorStatus).toBe(VendorStatus.NOT_SENT);

    // Idempotent repeat: same vendor = ok/alreadySent, no second notification.
    const again = await call("POST", "/orders/dispatch", staff, { orderIds: [ids[0], ids[1]], vendorId: vendor._id.toString() });
    expect(again.body.data.results.every((x) => x.ok && x.alreadySent)).toBe(true);
    expect(await Notification.countDocuments({ recipientId: vendor._id })).toBe(1);
    // Already with a vendor: another vendor is refused.
    const other = await call("POST", "/orders/dispatch", staff, { orderIds: [ids[0]], vendorId: otherVendor._id.toString() });
    expect(other.body.data.results[0]).toMatchObject({ ok: false, reason: "ALREADY_WITH_VENDOR" });
    // The fulfilment queue shows the vendor stage to staff.
    const queue = await call("GET", "/orders?queue=fulfil", staff);
    const row = queue.body.data.items.find((o) => o._id === ids[0]);
    expect(row.vendorStatus).toBe(VendorStatus.SENT);
    expect(row.vendorName).toBe(vendor.name);
  });

  it("an unassigned assistant gets 403 and nothing is dispatched; validation caps the batch", async () => {
    const { user: a } = await makeAssistant();
    const { token: otherStaff } = await makeAssistant();
    const { user: vendor } = await makeVendor();
    const ctx = await makeOrg({ assignedAssistantId: a._id });
    const { order } = await lockedOrder(ctx);
    const r = await call("POST", "/orders/dispatch", otherStaff, { orderIds: [order._id.toString()], vendorId: vendor._id.toString() });
    expect(r.status).toBe(403);
    expect((await EStampOrder.findById(order._id)).vendorStatus).toBe(VendorStatus.NOT_SENT);
    const tooMany = Array.from({ length: 201 }, () => uid().toString());
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    expect((await call("POST", "/orders/dispatch", master, { orderIds: tooMany, vendorId: vendor._id.toString() })).status).toBe(400);
    expect((await call("POST", "/orders/dispatch", master, { orderIds: [order._id.toString()], vendorId: uid().toString() })).status).toBe(404);
    // A client, even with ORDER_MANAGE, never dispatches.
    const { token: client } = await makeUser(Role.SUPER_ADMIN, { organizationId: ctx.org._id, permissions: [Permission.ORDER_MANAGE] });
    expect((await call("POST", "/orders/dispatch", client, { orderIds: [order._id.toString()], vendorId: vendor._id.toString() })).status).toBe(403);
  });
});

describe("vendor scope and projection", () => {
  it("a vendor sees only its own dispatched orders, in a restricted projection; others are 404", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: vendorA, token: tokenA } = await makeVendor();
    const { user: vendorB, token: tokenB } = await makeVendor();
    const ctx = await makeOrg();
    const { order: forA } = await dispatched(ctx, master, vendorA);
    const { order: forB } = await dispatched(ctx, master, vendorB);
    const { order: notSent } = await lockedOrder(ctx);
    await FileAsset.create({ organizationId: ctx.org._id, ownerUserId: ctx.client._id, cloudinaryPublicId: "mock/doc", resourceType: "raw", fileType: "REQUEST_SUPPORTING_DOC", originalFileName: "deed.pdf", mimeType: "application/pdf", sizeBytes: 10, requestId: forA.requestId });

    const list = await call("GET", "/vendor/orders", tokenA);
    expect(list.body.data.items.map((o) => o._id)).toEqual([forA._id.toString()]);
    for (const id of [forB._id, notSent._id, uid()]) {
      expect((await call("GET", `/vendor/orders/${id}`, tokenA)).status).toBe(404);
      expect((await call("POST", `/vendor/orders/${id}/accept`, tokenA)).status).toBe(404);
      expect((await vendorUpload(id, tokenA)).status).toBe(404);
    }
    const detail = await call("GET", `/vendor/orders/${forA._id}`, tokenA);
    expect(detail.status).toBe(200);
    const d = detail.body.data;
    expect(d).toMatchObject({ orderNumber: forA.orderNumber, stateCode: "KA", articleTitle: "Rental Agreement", firstParty: "Alice", secondParty: "Bob", descriptionOfDocument: "Rent", propertyDescription: "Flat 4B", considerationPrice: 1000, organizationName: ctx.org.name, vendorStatus: "SENT" });
    expect(d.stampDuty).toBe(500);
    expect(d.documents.map((f) => f.originalFileName)).toEqual(["deed.pdf"]);
    const keys = [...collectKeys(d), ...collectKeys(list.body.data)];
    expect(keys.filter((k) => MONEY_OR_CONTACT.test(k))).toEqual([]);
    expect(JSON.stringify(d)).not.toContain(ctx.org.contactEmail);

    const file = await call("GET", `/vendor/orders/${forA._id}/files/${d.documents[0]._id}`, tokenA);
    expect(file.status).toBe(200);
    expect(file.body.data.url).toBeTruthy();
    expect((await call("GET", `/vendor/orders/${forB._id}/files/${d.documents[0]._id}`, tokenA)).status).toBe(404);
    expect((await call("GET", `/vendor/orders/${forA._id}/files/${d.documents[0]._id}`, tokenB)).status).toBe(404);

    const summary = await call("GET", "/vendor/orders/summary", tokenA);
    expect(summary.body.data).toMatchObject({ total: 1, SENT: 1, ACCEPTED: 0 });
    expect(summary.body.data.oldestWaitingAt).toBeTruthy();
  });
});

describe("upload, review and release", () => {
  it("re-upload supersedes the earlier upload (history kept, one pending); bad files never stored", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: vendor, token } = await makeVendor();
    const ctx = await makeOrg();
    const { order } = await dispatched(ctx, master, vendor);
    const accepted = await call("POST", `/vendor/orders/${order._id}/accept`, token);
    expect(accepted.body.data.vendorStatus).toBe("ACCEPTED");
    expect((await call("POST", `/vendor/orders/${order._id}/accept`, token)).status).toBe(200);

    expect((await vendorUpload(order._id, token, { stampReference: "ab" })).status).toBe(400);
    expect((await vendorUpload(order._id, token, { file: Buffer.from("a,b\n1,2"), type: "text/csv", name: "x.csv" })).status).toBe(400);
    expect((await vendorUpload(order._id, token, { file: Buffer.from("MZ\x90\x00rest"), name: "evil.pdf" })).status).toBe(400);
    expect((await vendorUpload(order._id, token, { file: null })).status).toBe(400);
    expect(await FileAsset.countDocuments({})).toBe(0);

    const first = await vendorUpload(order._id, token, { stampReference: "KA-1111" });
    expect(first.status).toBe(200);
    const second = await vendorUpload(order._id, token, { stampReference: "KA-2222", type: "image/png", name: "s.png", file: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
    expect(second.status).toBe(200);
    const current = await EStampOrder.findById(order._id);
    expect(current.vendorStatus).toBe("UPLOADED");
    expect(current.vendorUploads.map((u) => [u.stampReference, u.status])).toEqual([["KA-1111", "SUPERSEDED"], ["KA-2222", "PENDING"]]);
    expect(await FileAsset.countDocuments({ orderId: order._id, fileType: "ESTAMP_DOCUMENT" })).toBe(2);
    expect(await EStampDocument.countDocuments({})).toBe(0);
    expect(await AuditLog.countDocuments({ action: AuditAction.VENDOR_UPLOADED, actorRole: Role.VENDOR })).toBe(2);
  });

  it("reject -> re-upload -> approve: clients cannot download before approval; afterwards every client role of the org can", async () => {
    const { user: a, token: staff } = await makeAssistant();
    const { user: vendor, token } = await makeVendor();
    const ctx = await makeOrg({ assignedAssistantId: a._id });
    const { order, request } = await dispatched(ctx, staff, vendor);
    const { user: plainUser, token: userToken } = await makeUser(Role.USER, { organizationId: ctx.org._id });
    const { token: adminToken } = await makeUser(Role.ADMIN, { organizationId: ctx.org._id });
    const { token: otherOrgClient } = await makeUser(Role.SUPER_ADMIN, { organizationId: (await makeOrg()).org._id });

    expect((await vendorUpload(order._id, token, { stampReference: "KA-BAD-1" })).status).toBe(200);
    expect(await Notification.countDocuments({ recipientId: a._id, title: "Vendor certificate to review" })).toBe(1);
    const review = await call("GET", "/orders?queue=vendor-review", staff);
    expect(review.body.data.items.map((o) => o._id)).toEqual([order._id.toString()]);
    expect(review.body.data.items[0].pendingVendorUpload.stampReference).toBe("KA-BAD-1");
    const view = await call("GET", `/orders/${order._id}/vendor-upload`, staff);
    expect(view.status).toBe(200);
    expect(view.body.data.url).toBeTruthy();

    // Before approval: nothing for any client, through any route.
    for (const t of [ctx.clientToken, userToken, adminToken]) {
      expect((await call("GET", `/files/estamp/${order._id}/download`, t)).status).toBe(404);
      expect((await call("GET", `/orders/${order._id}/vendor-upload`, t)).status).toBe(403);
      const detail = await call("GET", `/orders/${order._id}`, t);
      expect(detail.body.data.document).toBeNull();
      expect(JSON.stringify(detail.body.data.supportingDocuments)).not.toContain("stamp.pdf");
    }

    expect((await call("POST", `/orders/${order._id}/vendor-reject`, staff, { reason: "no" })).status).toBe(400);
    const rejected = await call("POST", `/orders/${order._id}/vendor-reject`, staff, { reason: "Stamp is blurred, please rescan" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.order.vendorStatus).toBe("REJECTED");
    expect(await Notification.countDocuments({ recipientId: vendor._id, title: "Certificate needs re-upload" })).toBe(1);
    const vendorView = await call("GET", `/vendor/orders/${order._id}`, token);
    expect(vendorView.body.data.uploads[0]).toMatchObject({ status: "REJECTED", reviewNotes: "Stamp is blurred, please rescan" });
    expect((await call("POST", `/orders/${order._id}/vendor-approve`, staff)).status).toBe(409);

    expect((await vendorUpload(order._id, token, { stampReference: "KA-GOOD-2" })).status).toBe(200);
    const approve = await call("POST", `/orders/${order._id}/vendor-approve`, staff);
    expect(approve.status).toBe(200);
    expect(approve.body.data.alreadyApproved).toBe(false);
    const again = await call("POST", `/orders/${order._id}/vendor-approve`, staff);
    expect(again.status).toBe(200);
    expect(again.body.data.alreadyApproved).toBe(true);

    const issued = await EStampOrder.findById(order._id);
    expect(issued).toMatchObject({ eStampStatus: "ISSUED", status: "COMPLETED", downloadStatus: "AVAILABLE", providerReference: "KA-GOOD-2", vendorStatus: "APPROVED" });
    expect(issued.fulfilledBy.toString()).toBe(a._id.toString());
    expect(issued.vendorUploads.map((u) => u.status)).toEqual(["REJECTED", "APPROVED"]);
    expect((await EStampRequest.findById(request._id)).status).toBe(EStampRequestStatus.DOWNLOAD_AVAILABLE);
    const docs = await EStampDocument.find({ orderId: order._id });
    expect(docs).toHaveLength(1);
    expect(docs[0].fileAssetId.toString()).toBe(issued.vendorUploads[1].fileAssetId.toString());
    expect(await Notification.countDocuments({ recipientId: ctx.client._id, title: "E-Stamp issued" })).toBe(1);
    expect(await Notification.countDocuments({ recipientId: ctx.client._id, title: "E-Stamp certificate available" })).toBe(1);
    expect(await AuditLog.countDocuments({ action: AuditAction.VENDOR_UPLOAD_APPROVED, actorId: a._id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: AuditAction.ESTAMP_ISSUED, entityId: order._id.toString() })).toBe(1);
    // The ledger is untouched by approval: only the original charge exists.
    expect(await WalletTransaction.countDocuments({ organizationId: ctx.org._id, type: "CREDIT" })).toBe(0);

    // Org-wide release: SUPER_ADMIN, ADMIN and a USER who did not create it.
    for (const t of [ctx.clientToken, adminToken, userToken]) {
      expect((await call("GET", `/files/estamp/${order._id}/download`, t)).status).toBe(200);
    }
    const userList = await call("GET", "/estamps", userToken);
    expect(userList.body.data.items.map((r) => r._id)).toContain(request._id.toString());
    expect(plainUser._id.toString()).not.toBe(request.createdBy.toString());
    expect((await call("GET", `/files/estamp/${order._id}/download`, otherOrgClient)).status).toBe(404);

    // Vendor sees the result but can no longer upload.
    expect((await call("GET", `/vendor/orders/${order._id}`, token)).body.data.vendorStatus).toBe("APPROVED");
    expect((await vendorUpload(order._id, token)).status).toBe(409);
  });

  it("clients never see vendor identity or vendor statuses", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: vendor } = await makeVendor({ name: "Secret Stamp Co" });
    const ctx = await makeOrg();
    const { order } = await dispatched(ctx, master, vendor);
    const { token: userToken } = await makeUser(Role.USER, { organizationId: ctx.org._id });
    for (const t of [ctx.clientToken, userToken]) {
      for (const path of [`/orders/${order._id}`, "/orders"]) {
        const body = JSON.stringify((await call("GET", path, t)).body);
        expect(body.match(/.{60}vendor.{60}/i)?.[0] ?? null).toBeNull();
        expect(body).not.toContain("Secret Stamp Co");
      }
      expect((await call("GET", "/orders?queue=vendor-review", t)).status).toBe(403);
    }
    // The org audit log (SUPER_ADMIN holds AUDIT_VIEW) hides vendor events too.
    {
      const audit = JSON.stringify((await call("GET", "/audit", ctx.clientToken)).body);
      expect(audit).not.toMatch(/DISPATCHED|VENDOR/);
    }
    const staffView = await call("GET", `/orders/${order._id}`, master);
    expect(staffView.body.data.vendor.name).toBe("Secret Stamp Co");
    expect(staffView.body.data.availableActions.recall).toBe(true);
  });

  it("bulk approve reports per-order results", async () => {
    const { user: a, token: staff } = await makeAssistant();
    const { user: vendor, token } = await makeVendor();
    const ctx = await makeOrg({ assignedAssistantId: a._id });
    const one = await dispatched(ctx, staff, vendor);
    const two = await dispatched(ctx, staff, vendor);
    const notUploaded = await dispatched(ctx, staff, vendor);
    await vendorUpload(one.order._id, token, { stampReference: "KA-ONE" });
    await vendorUpload(two.order._id, token, { stampReference: "KA-TWO" });
    const otherOrg = await makeOrg();
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const foreign = await dispatched(otherOrg, master, vendor);
    const r = await call("POST", "/orders/vendor-approve-many", staff, { orderIds: [one.order._id, two.order._id, notUploaded.order._id, foreign.order._id].map(String) });
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.body.data.results.map((x) => [x.orderId, x]));
    expect(byId[one.order._id.toString()].ok).toBe(true);
    expect(byId[two.order._id.toString()].ok).toBe(true);
    expect(byId[notUploaded.order._id.toString()]).toMatchObject({ ok: false, reason: "INVALID_STATE" });
    expect(byId[foreign.order._id.toString()]).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    expect(await EStampDocument.countDocuments({})).toBe(2);
  });
});

describe("recall, can't process and failure while with a vendor", () => {
  it("recall returns SENT/ACCEPTED orders to NOT_SENT; an uploaded order cannot be recalled", async () => {
    const { user: a, token: staff } = await makeAssistant();
    const { user: vendor, token } = await makeVendor();
    const ctx = await makeOrg({ assignedAssistantId: a._id });
    const { order } = await dispatched(ctx, staff, vendor);
    const r = await call("POST", `/orders/${order._id}/recall`, staff);
    expect(r.status).toBe(200);
    const recalled = await EStampOrder.findById(order._id);
    expect(recalled.vendorStatus).toBe("NOT_SENT");
    expect(recalled.vendorId).toBeUndefined();
    expect((await call("GET", `/vendor/orders/${order._id}`, token)).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: AuditAction.ORDER_RECALLED, actorId: a._id })).toBe(1);
    expect((await call("POST", `/orders/${order._id}/recall`, staff)).status).toBe(409);

    const { order: uploadedOrder } = await dispatched(ctx, staff, vendor);
    await vendorUpload(uploadedOrder._id, token);
    expect((await call("POST", `/orders/${uploadedOrder._id}/recall`, staff)).status).toBe(409);
  });

  it("can't process hands the order back: assistant notified, uploads blocked, re-dispatch clears it", async () => {
    const { user: a, token: staff } = await makeAssistant();
    const { user: vendor, token } = await makeVendor();
    const { user: vendor2, token: token2 } = await makeVendor();
    const ctx = await makeOrg({ assignedAssistantId: a._id });
    const { order } = await dispatched(ctx, staff, vendor);
    expect((await call("POST", `/vendor/orders/${order._id}/cannot-process`, token, { reason: "x" })).status).toBe(400);
    const r = await call("POST", `/vendor/orders/${order._id}/cannot-process`, token, { reason: "Article not available at my SRO" });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ vendorStatus: "REJECTED", declined: true, declineReason: "Article not available at my SRO" });
    expect(await Notification.countDocuments({ recipientId: a._id, title: "Vendor cannot process order" })).toBe(1);
    expect((await vendorUpload(order._id, token)).status).toBe(409);
    const re = await call("POST", "/orders/dispatch", staff, { orderIds: [order._id.toString()], vendorId: vendor2._id.toString() });
    expect(re.body.data.results[0].ok).toBe(true);
    const current = await EStampOrder.findById(order._id);
    expect(current).toMatchObject({ vendorStatus: "SENT", vendorDeclined: false });
    expect((await call("GET", `/vendor/orders/${order._id}`, token)).status).toBe(404);
    expect((await vendorUpload(order._id, token2)).status).toBe(200);
  });

  it("mark failed works while the order is with a vendor and clears the vendor stage (refund optional, once)", async () => {
    const { user: a, token: staff } = await makeAssistant();
    const { user: vendor, token } = await makeVendor();
    const ctx = await makeOrg({ assignedAssistantId: a._id });
    const { order } = await dispatched(ctx, staff, vendor);
    await call("POST", `/vendor/orders/${order._id}/accept`, token);
    const r = await call("POST", `/orders/${order._id}/fail`, staff, { reason: "Stamp paper unavailable", refundBalance: true });
    expect(r.status).toBe(200);
    const failed = await EStampOrder.findById(order._id);
    expect(failed).toMatchObject({ eStampStatus: "FAILED", vendorStatus: "NOT_SENT" });
    expect(failed.vendorId).toBeUndefined();
    expect(await WalletTransaction.countDocuments({ organizationId: ctx.org._id, type: "CREDIT", idempotencyKey: `estamp-refund:${order.requestId}` })).toBe(1);
    expect((await call("GET", `/vendor/orders/${order._id}`, token)).status).toBe(404);
    const audit = await AuditLog.findOne({ action: AuditAction.ESTAMP_PROCESSING_FAILED, entityId: order._id.toString() });
    expect(audit.metadata.vendorId).toBe(vendor._id.toString());
    // Manual fulfil still works as a fallback for an order with a vendor.
    const { order: other } = await dispatched(ctx, staff, vendor);
    const form = new FormData();
    form.append("file", new Blob([PDF], { type: "application/pdf" }), "s.pdf");
    form.append("stampReference", "KA-MANUAL-1");
    const fulfil = await fetch(`${base}/orders/${other._id}/fulfil`, { method: "POST", headers: { Authorization: `Bearer ${staff}` }, body: form });
    expect(fulfil.status).toBe(200);
    expect((await vendorUpload(other._id, token)).status).toBe(409);
  });
});
