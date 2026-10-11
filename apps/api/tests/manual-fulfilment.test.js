// Manual fulfilment (ESTAMP_FULFILMENT=manual): the assigned Assistant
// Master Admin stamps outside the app and uploads the certificate. Runs over
// real HTTP (authenticate/authorize/multer/validation as wired). The suite
// default is "provider" (vitest.config.js); these tests switch to manual via
// the ESTAMP_FULFILMENT setting override, exactly as an admin would.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { createRequire } from "node:module";
import {
  Organization, Wallet, WalletTransaction, User, Article, ArticleVersion, EStampRequest, EStampOrder, EStampDocument, FileAsset, Notification, AuditLog, SystemSetting,
} from "../src/models/index.js";
import { Role, Permission, OrganizationStatus, EStampRequestStatus, AuditAction } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { creditWallet } from "../src/services/wallet.service.js";
import { createApp } from "../src/app.js";

const require = createRequire(import.meta.url);
const providers = require("../src/services/estamp-providers/index.js");
const { env } = require("../src/config/env.js");

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
function fulfil(orderId, token, { file = PDF, type = "application/pdf", name = "stamp.pdf", stampReference = "KA-STAMP-0001", notes } = {}) {
  const form = new FormData();
  if (file) form.append("file", new Blob([file], { type }), name);
  if (stampReference !== undefined) form.append("stampReference", stampReference);
  if (notes) form.append("notes", notes);
  return fetch(`${base}/orders/${orderId}/fulfil`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

async function makeUser(role, overrides = {}) {
  const user = await User.create({ name: `${role} u`, email: `${role.toLowerCase()}-${uid()}@ld.local`, passwordHash: await AuthService.hashPassword("ChangeMe!User1"), role, lastOtpVerifiedAt: new Date(), ...overrides });
  return { user, token: (await AuthService.issueTokens(user)).accessToken };
}
const STAFF_PERMS = [Permission.ORDER_VIEW, Permission.ORDER_MANAGE, Permission.CLIENT_VIEW, Permission.ESTAMP_VIEW];
const makeAssistant = (extra = {}) => makeUser(Role.ASSISTANT_MASTER_ADMIN, { permissions: STAFF_PERMS, ...extra });

async function makeOrg({ balance = 5000, assignedAssistantId = null } = {}) {
  const org = await Organization.create({ name: `Manual ${uid()}`, contactEmail: `m-${uid()}@example.com`, contactPhone: "1", createdBy: uid(), status: OrganizationStatus.ACTIVE, isEstampServiceEnabled: true, assignedAssistantId });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `MAN-${uid()}`, title: "Rental Agreement", createdBy: uid(), currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 500 }, createdBy: uid() });
  const { user: client, token: clientToken } = await makeUser(Role.SUPER_ADMIN, { organizationId: org._id });
  return { org, article, client, clientToken };
}
async function submit(ctx) {
  return EStampRequestService.createRequest({ organizationId: ctx.org._id, createdBy: ctx.client._id, actorRole: Role.SUPER_ADMIN, stateCode: "KA", articleId: ctx.article._id.toString(), firstParty: "Alice", secondParty: "Bob", descriptionOfDocument: "Rent", considerationPrice: 0, stampDutyPaidBy: "Alice", numberOfEStamps: 1, idempotencyKey: `man-${uid()}` });
}
async function lockedOrder(ctx) {
  const { request, order } = await submit(ctx);
  await EStampRequest.updateOne({ _id: request._id }, { $set: { modificationDeadline: new Date(Date.now() - 1000) } });
  await EStampRequestService.lockExpiredRequests();
  return { request: await EStampRequest.findById(request._id), order: await EStampOrder.findById(order._id) };
}

describe("mode switch and provider isolation", () => {
  it("manual mode never instantiates a provider, even with NODE_ENV=production and ESTAMP_PROVIDER unset", async () => {
    const spy = vi.spyOn(providers, "getEStampProvider");
    const saved = { NODE_ENV: env.NODE_ENV, ESTAMP_PROVIDER: env.ESTAMP_PROVIDER };
    env.NODE_ENV = "production";
    env.ESTAMP_PROVIDER = "";
    try {
      const { user: a, token } = await makeAssistant();
      const ctx = await makeOrg({ assignedAssistantId: a._id });
      const { order } = await lockedOrder(ctx);
      expect((await call("GET", "/orders?queue=fulfil", token)).body.data.items).toHaveLength(1);
      expect((await call("POST", `/orders/${order._id}/start`, token)).status).toBe(200);
      const { token: master } = await makeUser(Role.MASTER_ADMIN);
      for (const action of ["process", "sync", "retry"]) {
        const r = await call("POST", `/orders/${order._id}/${action}`, master);
        expect(r.status).toBe(409);
        expect(r.body.code || r.body.error?.code || JSON.stringify(r.body)).toMatch(/MANUAL_FULFILMENT_ENABLED/);
      }
      const hook = await fetch(`${base}/orders/webhook/mock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(hook.status).toBe(410);
      expect((await call("GET", "/estamp-provider/balance", master)).status).toBe(409);
      expect((await call("GET", "/reports/provider", master)).status).toBe(409);
      expect((await call("POST", `/orders/${order._id}/fail`, token, { reason: "Stamp paper unavailable", refundBalance: false })).status).toBe(200);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      env.NODE_ENV = saved.NODE_ENV;
      env.ESTAMP_PROVIDER = saved.ESTAMP_PROVIDER;
      spy.mockRestore();
    }
  });

  it("provider mode keeps the provider routes and refuses the manual ones", async () => {
    await setMode("provider");
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const ctx = await makeOrg();
    const { order } = await lockedOrder(ctx);
    expect((await call("POST", `/orders/${order._id}/start`, master)).status).toBe(409);
    expect((await fulfil(order._id, master)).status).toBe(409);
    // Control for the spy used above: in provider mode the provider IS reached.
    const spy = vi.spyOn(providers, "getEStampProvider");
    expect((await call("POST", `/orders/${order._id}/process`, master)).status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(await FileAsset.countDocuments({})).toBe(0);
  });

  it("GET /auth/me and the login payload expose the mode", async () => {
    const { token, user } = await makeUser(Role.SUPER_ADMIN);
    expect((await call("GET", "/auth/me", token)).body.data.fulfilmentMode).toBe("manual");
    expect((await AuthService.issueTokens(user)).user.fulfilmentMode).toBe("manual");
  });
});

describe("happy path", () => {
  it("lock notifies the assistant once; start is idempotent; fulfil issues with one certificate, one set of notifications", async () => {
    const { user: a, token } = await makeAssistant();
    const ctx = await makeOrg({ assignedAssistantId: a._id });
    const { request, order } = await lockedOrder(ctx);
    await EStampRequestService.lockExpiredRequests(); // another tick
    expect(await Notification.countDocuments({ recipientId: a._id, title: "New order to fulfil" })).toBe(1);

    const s1 = await call("POST", `/orders/${order._id}/start`, token);
    const s2 = await call("POST", `/orders/${order._id}/start`, token);
    expect(s1.body.data.order.eStampStatus).toBe("PROCESSING");
    expect(s2.status).toBe(200);
    expect((await EStampRequest.findById(request._id)).status).toBe(EStampRequestStatus.PROCESSING);
    expect((await EStampOrder.findById(order._id)).fulfilledBy.toString()).toBe(a._id.toString());

    const done = await fulfil(order._id, token, { notes: "Stamped at Bengaluru SRO" });
    expect(done.status).toBe(200);
    const issued = await EStampOrder.findById(order._id);
    expect(issued).toMatchObject({ eStampStatus: "ISSUED", status: "COMPLETED", downloadStatus: "AVAILABLE", providerReference: "KA-STAMP-0001" });
    expect(issued.issuedAt).toBeTruthy();
    expect((await EStampRequest.findById(request._id)).status).toBe(EStampRequestStatus.DOWNLOAD_AVAILABLE);
    expect(await EStampDocument.countDocuments({ orderId: order._id })).toBe(1);

    const again = await fulfil(order._id, token, { stampReference: "KA-STAMP-0002" });
    expect(again.status).toBe(409);
    expect(await EStampDocument.countDocuments({ orderId: order._id })).toBe(1);
    expect(await FileAsset.countDocuments({ orderId: order._id })).toBe(1);
    expect(await Notification.countDocuments({ recipientId: ctx.client._id, title: "E-Stamp issued" })).toBe(1);
    expect(await Notification.countDocuments({ recipientId: ctx.client._id, title: "E-Stamp certificate available" })).toBe(1);
    expect(await AuditLog.findOne({ action: AuditAction.ESTAMP_ISSUED, entityId: order._id.toString() })).not.toBeNull();

    const dl = await call("GET", `/files/estamp/${order._id}/download`, ctx.clientToken);
    expect(dl.status).toBe(200);
    const detail = await call("GET", `/orders/${order._id}`, ctx.clientToken);
    expect(detail.body.data.timeline.map((t) => t.label)).toEqual(["Submitted", "Window ends", "Queued", "In progress", "Issued"]);
    expect(detail.body.data.availableActions).toMatchObject({ start: false, fulfil: false, fail: false });
  });
});

describe("all-or-nothing fulfil", () => {
  it("a failure after the upload leaves no asset, no certificate and no ISSUED order", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const ctx = await makeOrg();
    const { request, order } = await lockedOrder(ctx);
    const spy = vi.spyOn(EStampRequest, "findOneAndUpdate").mockRejectedValueOnce(new Error("simulated database failure"));
    const r = await fulfil(order._id, master);
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(await FileAsset.countDocuments({})).toBe(0);
    expect(await EStampDocument.countDocuments({})).toBe(0);
    const unchanged = await EStampOrder.findById(order._id);
    expect(unchanged.eStampStatus).toBe("CREATED");
    expect(unchanged.issuedAt).toBeUndefined();
    expect(unchanged.providerReference).toBeUndefined();
    expect((await EStampRequest.findById(request._id)).status).toBe(EStampRequestStatus.LOCKED);
    expect(await Notification.countDocuments({ title: "E-Stamp issued" })).toBe(0);
    // ...and a clean retry then works.
    expect((await fulfil(order._id, master)).status).toBe(200);
  });

  it("validation failures (reference, MIME, executable) never store a file", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const ctx = await makeOrg();
    const { order } = await lockedOrder(ctx);
    expect((await fulfil(order._id, master, { stampReference: "ab" })).status).toBe(400);
    expect((await fulfil(order._id, master, { file: null })).status).toBe(400);
    expect((await fulfil(order._id, master, { type: "application/zip", name: "x.zip", file: Buffer.from("PK\x03\x04zip") })).status).toBe(400);
    expect((await fulfil(order._id, master, { type: "application/pdf", name: "x.pdf", file: Buffer.from("MZ\x90\x00 fake exe") })).status).toBe(400);
    expect(await FileAsset.countDocuments({})).toBe(0);
    expect((await EStampOrder.findById(order._id)).eStampStatus).toBe("CREATED");
  });
});

describe("guards", () => {
  it("cannot fulfil inside the window, after cancel, or when SHORTFALL / uncharged; none appear in the queue", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const ctx = await makeOrg({ balance: 5000 });
    const inWindow = await submit(ctx);
    const r1 = await fulfil(inWindow.order._id, master);
    expect(r1.status).toBe(409);
    expect((await call("POST", `/orders/${inWindow.order._id}/start`, master)).status).toBe(409);

    const cancelled = await submit(ctx);
    await EStampRequestService.cancelRequest(cancelled.request._id.toString(), ctx.org._id, ctx.client._id.toString(), Role.SUPER_ADMIN);
    expect((await fulfil(cancelled.order._id, master)).status).toBe(409);

    const short = await submit(ctx);
    await Wallet.updateOne({ organizationId: ctx.org._id }, { $set: { balance: 100 } });
    await EStampRequest.updateOne({ _id: short.request._id }, { $set: { modificationDeadline: new Date(Date.now() - 1000) } });
    await EStampRequestService.lockExpiredRequests();
    expect((await EStampRequest.findById(short.request._id)).chargeStatus).toBe("SHORTFALL");
    const r3 = await fulfil(short.order._id, master);
    expect(r3.status).toBe(409);
    expect((await call("POST", `/orders/${short.order._id}/start`, master)).status).toBe(409);

    const queue = await call("GET", "/orders?queue=fulfil", master);
    expect(queue.body.data.items).toHaveLength(0);
    expect(await FileAsset.countDocuments({})).toBe(0);
  });

  it("only the assigned assistant or a Master Admin: 403 for an unassigned assistant, 403 for a client", async () => {
    const { user: assigned, token: assignedToken } = await makeAssistant();
    const { token: otherToken } = await makeAssistant();
    const ctx = await makeOrg({ assignedAssistantId: assigned._id });
    const { order } = await lockedOrder(ctx);
    const { token: client } = await makeUser(Role.SUPER_ADMIN, { organizationId: ctx.org._id, permissions: [Permission.ORDER_MANAGE] });
    for (const token of [otherToken, client]) {
      expect((await call("POST", `/orders/${order._id}/start`, token)).status).toBe(403);
      expect((await fulfil(order._id, token)).status).toBe(403);
      expect((await call("POST", `/orders/${order._id}/fail`, token, { reason: "No stamp paper", refundBalance: true })).status).toBe(403);
    }
    expect((await call("GET", "/orders?queue=fulfil", otherToken)).body.data.items).toHaveLength(0);
    expect((await call("GET", "/orders?queue=fulfil", client)).status).toBe(403);
    expect(await FileAsset.countDocuments({})).toBe(0);
    expect((await fulfil(order._id, assignedToken)).status).toBe(200);
  });
});

describe("mark failed", () => {
  it("without refund: FAILED, client notified, no credit", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const ctx = await makeOrg({ balance: 1000 });
    const { request, order } = await lockedOrder(ctx);
    expect((await call("POST", `/orders/${order._id}/fail`, master, { reason: "bad", refundBalance: false })).status).toBe(400);
    expect((await call("POST", `/orders/${order._id}/fail`, master, { reason: "Stamp paper unavailable" })).status).toBe(400); // refundBalance required
    const r = await call("POST", `/orders/${order._id}/fail`, master, { reason: "Stamp paper unavailable", refundBalance: false });
    expect(r.status).toBe(200);
    expect(r.body.data.refund).toBeNull();
    expect((await EStampOrder.findById(order._id)).eStampStatus).toBe("FAILED");
    expect((await EStampRequest.findById(request._id)).status).toBe(EStampRequestStatus.FAILED);
    expect((await Wallet.findOne({ organizationId: ctx.org._id })).balance).toBe(500);
    expect(await WalletTransaction.countDocuments({ organizationId: ctx.org._id, type: "CREDIT" })).toBe(0);
    expect(await Notification.findOne({ recipientId: ctx.client._id, title: "E-Stamp processing failed" })).not.toBeNull();
    expect((await call("POST", `/orders/${order._id}/fail`, master, { reason: "Again please", refundBalance: true })).status).toBe(409);
  });

  it("with refund: exactly one CREDIT reversing the charge, idempotent, audited", async () => {
    const { user: a, token } = await makeAssistant();
    const ctx = await makeOrg({ balance: 1000, assignedAssistantId: a._id });
    const { request, order } = await lockedOrder(ctx);
    expect((await Wallet.findOne({ organizationId: ctx.org._id })).balance).toBe(500);
    const r = await call("POST", `/orders/${order._id}/fail`, token, { reason: "Registrar office closed for the week", refundBalance: true });
    expect(r.status).toBe(200);
    expect((await Wallet.findOne({ organizationId: ctx.org._id })).balance).toBe(1000);
    const credits = await WalletTransaction.find({ organizationId: ctx.org._id, type: "CREDIT" });
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ amount: 500, referenceType: "ESTAMP_REQUEST_REVERSAL", idempotencyKey: `estamp-refund:${request._id}` });
    expect(credits[0].description).toMatch(/Registrar office closed/);
    // Any replay of the same reversal is a no-op.
    expect((await call("POST", `/orders/${order._id}/fail`, token, { reason: "Registrar office closed", refundBalance: true })).status).toBe(409);
    await creditWallet({ organizationId: ctx.org._id, amount: 500, referenceType: "ESTAMP_REQUEST_REVERSAL", idempotencyKey: `estamp-refund:${request._id}` });
    expect((await Wallet.findOne({ organizationId: ctx.org._id })).balance).toBe(1000);
    expect(await AuditLog.findOne({ action: AuditAction.BALANCE_CHANGED, entityId: request._id.toString() })).not.toBeNull();
    expect((await EStampRequest.findById(request._id)).refundedAt).toBeTruthy();
  });
});

describe("queue and summary scoping", () => {
  it("an assistant sees only assigned organizations, oldest first; Master Admin sees all plus fulfilled today", async () => {
    const { user: a, token } = await makeAssistant();
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const mine = await makeOrg({ assignedAssistantId: a._id });
    const theirs = await makeOrg();
    const first = await lockedOrder(mine);
    await EStampRequest.updateOne({ _id: first.request._id }, { $set: { lockedAt: new Date(Date.now() - 3 * 3600000) } });
    const second = await lockedOrder(mine);
    await lockedOrder(theirs);

    const q = await call("GET", "/orders?queue=fulfil&sortBy=createdAt&sortDir=asc", token);
    expect(q.body.data.items.map((o) => o._id)).toEqual([first.order._id.toString(), second.order._id.toString()]);
    expect(q.body.data.items[0]).toMatchObject({ articleTitle: "Rental Agreement" });
    expect(q.body.data.items[0].lockedAt).toBeTruthy();
    expect((await call("GET", "/orders?queue=fulfil", master)).body.data.items).toHaveLength(3);

    await fulfil(second.order._id, token);
    const mineSummary = (await call("GET", "/orders/fulfilment-summary", token)).body.data;
    expect(mineSummary).toMatchObject({ toFulfil: 1, fulfilledToday: 1 });
    expect(mineSummary.oldestAgeMinutes).toBeGreaterThanOrEqual(179);
    const all = (await call("GET", "/orders/fulfilment-summary", master)).body.data;
    expect(all).toMatchObject({ toFulfil: 2, fulfilledToday: 1 });
    expect((await call("GET", "/orders/fulfilment-summary", mine.clientToken)).status).toBe(403);
  });
});
