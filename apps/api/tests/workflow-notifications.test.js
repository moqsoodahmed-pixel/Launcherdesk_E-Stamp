// End-to-end proof of the intended order workflow, driven over real HTTP:
//
//   Super Admin buys (single or bulk) -> Master Admin + assigned Assistant are
//   told -> 20-minute edit/cancel window, then view-only -> Assistant checks
//   the order and dispatches it to a Vendor -> Vendor sees it, uploads the
//   certificate to the portal -> Assistant reviews/approves -> Super Admin is
//   emailed the outcome (success or failure).
//
// The one hard rule asserted throughout: emails only ever link INTO the
// portal. The certificate is never attached or linked from an email - it is
// viewed and downloaded after signing in.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import "./setup";
import mongoose from "mongoose";
import crypto from "crypto";
import { createRequire } from "node:module";
import { Organization, Wallet, User, Article, ArticleVersion, EStampRequest, EStampOrder, Notification, SystemSetting } from "../src/models/index.js";
import { Role, Permission, OrganizationStatus } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { createApp } from "../src/app.js";

// Plain CommonJS modules, loaded with require() so the SAME module instances
// the app itself uses are the ones patched/called here (a Vitest ESM import
// of the same file would be a second instance and the patch would not apply).
const require = createRequire(import.meta.url);
const { MockEmailProvider } = require("../src/services/email-providers/MockEmailProvider.js");
const { renderTemplate } = require("../src/services/email-templates/index.js");
const { PRIMARY_FRONTEND_URL } = require("../src/config/env.js");
const { notifyOrderStaff, notifyOrderProcessing } = require("../src/services/estamp-notifications.js");
const { notifyAssignedAssistant } = require("../src/services/notification.service.js");
const { BulkEStampService } = require("../src/services/bulk-estamp.service.js");

const uid = () => new mongoose.Types.ObjectId();
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

let server;
let base;
beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());

// Every email handed to the provider is captured exactly as it would be sent.
let sent;
let originalSend;
beforeEach(async () => {
  await SystemSetting.updateOne({ key: "ESTAMP_FULFILMENT" }, { $set: { value: "manual" }, $inc: { version: 1 } }, { upsert: true });
  sent = [];
  originalSend = MockEmailProvider.prototype.send;
  MockEmailProvider.prototype.send = async function capture(params) {
    sent.push(params);
    return { status: "SENT", providerMessageId: null, source: "mock" };
  };
});
afterEach(() => {
  MockEmailProvider.prototype.send = originalSend;
});
const emailsTo = (address) => sent.filter((mail) => mail.to === address);
const subjectsTo = (address) => emailsTo(address).map((mail) => mail.subject);

const call = (method, path, token, body) =>
  fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
function vendorUpload(orderId, token) {
  const form = new FormData();
  form.append("file", new Blob([PDF], { type: "application/pdf" }), "stamp.pdf");
  form.append("stampReference", "KA-VEND-0001");
  return fetch(`${base}/vendor/orders/${orderId}/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

async function makeUser(role, overrides = {}) {
  const user = await User.create({ name: `${role} u`, email: `${role.toLowerCase()}-${uid()}@ld.local`, phone: "9999999999", passwordHash: await AuthService.hashPassword("ChangeMe!User1"), role, lastOtpVerifiedAt: new Date(), ...overrides });
  return { user, token: (await AuthService.issueTokens(user)).accessToken };
}
const STAFF_PERMS = [Permission.ORDER_VIEW, Permission.ORDER_MANAGE, Permission.CLIENT_VIEW, Permission.ESTAMP_VIEW, Permission.ESTAMP_DOWNLOAD];
const makeAssistant = () => makeUser(Role.ASSISTANT_MASTER_ADMIN, { permissions: STAFF_PERMS });

async function makeOrg({ assignedAssistantId = null, balance = 5000 } = {}) {
  const org = await Organization.create({ name: `Flow Org ${uid()}`, contactEmail: `f-${uid()}@example.com`, contactPhone: "1", createdBy: uid(), status: OrganizationStatus.ACTIVE, isEstampServiceEnabled: true, assignedAssistantId });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `FLOW-${uid()}`, title: "Rental Agreement", createdBy: uid(), currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 500 }, createdBy: uid() });
  const { user: client, token: clientToken } = await makeUser(Role.SUPER_ADMIN, { organizationId: org._id });
  return { org, article, client, clientToken };
}
const requestBody = (ctx, overrides = {}) => ({
  stateCode: "KA",
  articleId: ctx.article._id.toString(),
  firstParty: "Alice",
  secondParty: "Bob",
  descriptionOfDocument: "Rental agreement",
  considerationPrice: 1000,
  stampDutyPaidBy: "Alice",
  numberOfEStamps: 1,
  idempotencyKey: `flow-${uid()}`,
  ...overrides,
});
// Created through the service, i.e. without the controller's emails, for the
// tests that are about later stages and want a clean email log to start from.
async function submitViaService(ctx) {
  return EStampRequestService.createRequest({ ...requestBody(ctx), organizationId: ctx.org._id, createdBy: ctx.client._id, actorRole: Role.SUPER_ADMIN });
}
async function closeWindow(request) {
  await EStampRequest.updateOne({ _id: request._id }, { $set: { modificationDeadline: new Date(Date.now() - 1000) } });
  await EStampRequestService.lockExpiredRequests();
}
async function lockedOrder(ctx) {
  const { request, order } = await submitViaService(ctx);
  await closeWindow(request);
  return { request: await EStampRequest.findById(request._id), order: await EStampOrder.findById(order._id) };
}
// A full cast: Master Admin, the assigned Assistant, a Vendor, and a client
// organization with TWO Super Admins (so "the Super Admin" is not just the
// requester).
async function cast() {
  const { user: master } = await makeUser(Role.MASTER_ADMIN);
  const { user: assistant, token: assistantToken } = await makeAssistant();
  const { user: vendor, token: vendorToken } = await makeUser(Role.VENDOR);
  const ctx = await makeOrg({ assignedAssistantId: assistant._id });
  const { user: otherSuperAdmin } = await makeUser(Role.SUPER_ADMIN, { organizationId: ctx.org._id });
  return { master, assistant, assistantToken, vendor, vendorToken, otherSuperAdmin, ...ctx };
}
async function dispatched(c) {
  const { request, order } = await lockedOrder(c);
  const r = await call("POST", "/orders/dispatch", c.assistantToken, { orderIds: [order._id.toString()], vendorId: c.vendor._id.toString() });
  expect(r.status).toBe(200);
  expect(r.body.data.results[0].ok).toBe(true);
  return { request, order: await EStampOrder.findById(order._id) };
}
// Vendor uploads, assistant approves: the order is issued and the certificate
// is released into the portal.
async function issuedViaVendor(c) {
  const { order } = await dispatched(c);
  expect((await call("POST", `/vendor/orders/${order._id}/accept`, c.vendorToken)).status).toBe(200);
  expect((await vendorUpload(order._id, c.vendorToken)).status).toBe(200);
  expect((await call("POST", `/orders/${order._id}/vendor-approve`, c.assistantToken)).status).toBe(200);
  return order;
}

describe("step 1 - Super Admin buys (single request)", () => {
  it("tells the Master Admin, the ASSIGNED Assistant and the buyer on both channels - and nobody unrelated", async () => {
    const { user: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: assistant } = await makeAssistant();
    const { user: unrelated } = await makeAssistant();
    const ctx = await makeOrg({ assignedAssistantId: assistant._id });

    const r = await call("POST", "/estamps", ctx.clientToken, requestBody(ctx));
    expect(r.status).toBe(201);

    for (const person of [master, assistant]) {
      expect(await Notification.countDocuments({ recipientId: person._id.toString(), title: /^New E-Stamp Order Placed/ })).toBe(1);
      expect(emailsTo(person.email)).toHaveLength(1);
    }
    expect(emailsTo(ctx.client.email)).toHaveLength(1);
    expect(await Notification.countDocuments({ recipientId: unrelated._id.toString() })).toBe(0);
    expect(emailsTo(unrelated.email)).toHaveLength(0);
  });

  it("a retried submission (same idempotency key) re-sends nothing", async () => {
    const { user: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: assistant } = await makeAssistant();
    const ctx = await makeOrg({ assignedAssistantId: assistant._id });
    const body = requestBody(ctx);

    expect((await call("POST", "/estamps", ctx.clientToken, body)).status).toBe(201);
    expect((await call("POST", "/estamps", ctx.clientToken, body)).status).toBe(201);

    expect(emailsTo(master.email)).toHaveLength(1);
    expect(emailsTo(assistant.email)).toHaveLength(1);
    expect(emailsTo(ctx.client.email)).toHaveLength(1);
    expect(await Notification.countDocuments({ recipientId: assistant._id.toString(), title: /^New E-Stamp Order Placed/ })).toBe(1);
  });

  it("with no Assistant assigned, the Master Admin is still told", async () => {
    const { user: master } = await makeUser(Role.MASTER_ADMIN);
    const ctx = await makeOrg({ assignedAssistantId: null });
    expect((await call("POST", "/estamps", ctx.clientToken, requestBody(ctx))).status).toBe(201);
    expect(emailsTo(master.email)).toHaveLength(1);
  });
});

describe("step 1 - Super Admin buys (bulk)", () => {
  const batchFor = (ctx, createdRequests) => ({
    _id: uid(),
    batchNumber: "LDE-BULK-1",
    organizationId: ctx.org._id,
    createdBy: ctx.client._id,
    status: "COMPLETED",
    totalRows: createdRequests,
    createdRequests,
    failedRows: 0,
  });

  it("sends ONE email per person for the whole batch - never one per row", async () => {
    const { user: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: assistant } = await makeAssistant();
    const ctx = await makeOrg({ assignedAssistantId: assistant._id });

    await BulkEStampService._notifyBatchOutcome(batchFor(ctx, 500), ctx.client._id.toString(), Role.SUPER_ADMIN);

    expect(emailsTo(master.email)).toHaveLength(1);
    expect(emailsTo(assistant.email)).toHaveLength(1);
    expect(emailsTo(ctx.client.email)).toHaveLength(1);
    expect(sent).toHaveLength(3);
  });

  it("does not tell staff about a batch that created nothing", async () => {
    const { user: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: assistant } = await makeAssistant();
    const ctx = await makeOrg({ assignedAssistantId: assistant._id });

    await BulkEStampService._notifyBatchOutcome(batchFor(ctx, 0), ctx.client._id.toString(), Role.SUPER_ADMIN);

    expect(emailsTo(master.email)).toHaveLength(0);
    expect(emailsTo(assistant.email)).toHaveLength(0);
    expect(emailsTo(ctx.client.email)).toHaveLength(1);
  });
});

describe("step 1 - package purchase", () => {
  async function purchase(ctx) {
    const { PaymentService } = require("../src/services/payment.service.js");
    const order = await PaymentService.createOrder({ organizationId: ctx.org._id, userId: ctx.client._id, amount: 1000 });
    const razorpayPaymentId = `pay_${uid()}`;
    const razorpaySignature = crypto.createHmac("sha256", "mock_secret_dev_only").update(`${order.razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
    await PaymentService.confirmPayment({ razorpayOrderId: order.razorpayOrderId, razorpayPaymentId, razorpaySignature, userId: ctx.client._id });
    return order;
  }

  it("emails the Master Admin and the assigned Assistant that a payment is waiting to be credited", async () => {
    const { user: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: assistant } = await makeAssistant();
    const { user: unrelated } = await makeAssistant();
    const ctx = await makeOrg({ assignedAssistantId: assistant._id });

    await purchase(ctx);

    expect(subjectsTo(master.email).join(" ")).toMatch(/New E-Stamp Package Purchased/);
    expect(subjectsTo(assistant.email).join(" ")).toMatch(/New E-Stamp Package Purchased/);
    expect(emailsTo(unrelated.email)).toHaveLength(0);
  });

  it("the buyer keeps their own payment email and is not sent a duplicate staff-style one", async () => {
    await makeUser(Role.MASTER_ADMIN);
    const ctx = await makeOrg({});

    await purchase(ctx);

    const subjects = subjectsTo(ctx.client.email);
    expect(subjects.some((s) => /^Purchase Confirmation/.test(s))).toBe(true);
    expect(subjects.some((s) => /Payment waiting to be credited|New E-Stamp Package Purchased/.test(s))).toBe(false);
  });
});

describe("step 2 - the 20-minute window", () => {
  it("while open the Super Admin can edit and cancel; the moment it closes they can still VIEW but not edit or cancel", async () => {
    const ctx = await makeOrg({});
    const created = await call("POST", "/estamps", ctx.clientToken, requestBody(ctx));
    const id = created.body.data.request._id;

    // Open: editing works.
    expect((await call("PATCH", `/estamps/${id}`, ctx.clientToken, { firstParty: "Alice Updated" })).status).toBe(200);

    await closeWindow({ _id: id });

    // Closed: view still works, edit and cancel are refused.
    const view = await call("GET", `/estamps/${id}`, ctx.clientToken);
    expect(view.status).toBe(200);
    expect(view.body.data.firstParty).toBe("Alice Updated");
    expect(view.body.data.canModify).toBe(false);
    expect(view.body.data.canCancel).toBe(false);
    expect((await call("PATCH", `/estamps/${id}`, ctx.clientToken, { firstParty: "Too Late" })).status).toBe(409);
    expect((await call("POST", `/estamps/${id}/cancel`, ctx.clientToken)).status).toBe(409);
    expect((await EStampRequest.findById(id)).firstParty).toBe("Alice Updated");
  });

  it("tells the Super Admin by email that the request is now locked and view-only", async () => {
    const ctx = await makeOrg({});
    const { request } = await submitViaService(ctx);
    await closeWindow(request);

    const mail = emailsTo(ctx.client.email).find((m) => /Wallet Amount Charged/.test(m.subject));
    expect(mail).toBeTruthy();
    expect(mail.html).toMatch(/can no longer be edited or cancelled/);
    expect(mail.html).toMatch(/view it in the portal/);
    // The in-app notice keeps its original wording alongside the new text.
    const notice = await Notification.findOne({ recipientId: ctx.client._id.toString(), title: "E-Stamp Wallet Amount Charged" });
    expect(notice.message).toContain("has been deducted");
  });

  it("the window closing makes the order ready, and emails the assigned Assistant to fulfil it", async () => {
    const c = await cast();
    const { order } = await lockedOrder(c);
    expect(subjectsTo(c.assistant.email)).toContain(`New order to fulfil - order ${order.orderNumber}`);
    expect(emailsTo(c.master.email).some((m) => /New order to fulfil/.test(m.subject))).toBe(false);
  });

  it("cancelling inside the window tells the client AND the staff who would otherwise fulfil it", async () => {
    const c = await cast();
    const { request } = await submitViaService(c);
    sent.length = 0;

    expect((await call("POST", `/estamps/${request._id}/cancel`, c.clientToken)).status).toBe(200);

    for (const person of [c.client, c.otherSuperAdmin, c.master, c.assistant]) {
      expect(subjectsTo(person.email).some((s) => /cancelled/i.test(s))).toBe(true);
    }
    expect((await Wallet.findOne({ organizationId: c.org._id })).reservedBalance).toBe(0);
  });
});

describe("step 3 - Assistant dispatches to a Vendor", () => {
  it("tells the client the order is processing, once, WITHOUT naming any vendor", async () => {
    const c = await cast();
    const { order } = await lockedOrder(c);
    sent.length = 0;

    const r = await call("POST", "/orders/dispatch", c.assistantToken, { orderIds: [order._id.toString()], vendorId: c.vendor._id.toString() });
    expect(r.status).toBe(200);

    for (const person of [c.client, c.otherSuperAdmin]) {
      const mail = emailsTo(person.email).find((m) => /in processing/.test(m.subject));
      expect(mail).toBeTruthy();
      expect(mail.html).toMatch(/now being processed/);
      expect(mail.html).not.toContain(c.vendor.email);
      expect(mail.html).not.toContain(c.vendor.name);
    }
    // The vendor is emailed too, with a link to their own queue.
    const vendorMail = emailsTo(c.vendor.email)[0];
    expect(vendorMail.subject).toMatch(/New orders to stamp/);
    expect(vendorMail.html).toContain(`${PRIMARY_FRONTEND_URL}/vendor/orders`);

    // A repeat (e.g. re-dispatch after a hand-back) never tells the client twice.
    const requestDoc = await EStampRequest.findById(order.requestId);
    await notifyOrderProcessing(await EStampOrder.findById(order._id), requestDoc, c.assistant._id.toString());
    expect(await Notification.countDocuments({ recipientId: c.client._id.toString(), title: "E-Stamp order in processing" })).toBe(1);
  });

  it("the vendor accepting tells the assigned Assistant - and tells the client nothing about the vendor", async () => {
    const c = await cast();
    const { order } = await dispatched(c);
    sent.length = 0;

    expect((await call("POST", `/vendor/orders/${order._id}/accept`, c.vendorToken)).status).toBe(200);
    expect((await call("POST", `/vendor/orders/${order._id}/accept`, c.vendorToken)).status).toBe(200); // idempotent

    expect(emailsTo(c.assistant.email).filter((m) => /Vendor accepted order/.test(m.subject))).toHaveLength(1);
    expect(emailsTo(c.client.email)).toHaveLength(0);
  });

  it("the vendor handing an order back tells the Assistant by email", async () => {
    const c = await cast();
    const { order } = await dispatched(c);
    sent.length = 0;

    const r = await call("POST", `/vendor/orders/${order._id}/cannot-process`, c.vendorToken, { reason: "Article not available at my SRO" });
    expect(r.status).toBe(200);

    expect(emailsTo(c.assistant.email).some((m) => /Vendor cannot process order/.test(m.subject))).toBe(true);
    expect(emailsTo(c.client.email)).toHaveLength(0);
  });
});

describe("step 4 - the Vendor uploads to the portal", () => {
  it("emails the Assistant to review, and keeps the Super Admin out of it until it is approved", async () => {
    const c = await cast();
    const { order } = await dispatched(c);
    sent.length = 0;

    expect((await vendorUpload(order._id, c.vendorToken)).status).toBe(200);

    expect(emailsTo(c.assistant.email).some((m) => /Vendor certificate to review/.test(m.subject))).toBe(true);
    expect(emailsTo(c.client.email)).toHaveLength(0);
    expect(emailsTo(c.otherSuperAdmin.email)).toHaveLength(0);
  });
});

describe("step 5 - the Super Admin is told the outcome", () => {
  it("SUCCESS: every Super Admin gets exactly one 'issued' and one 'ready' email, each linking into the portal", async () => {
    const c = await cast();
    const { order } = await dispatched(c);
    expect((await vendorUpload(order._id, c.vendorToken)).status).toBe(200);
    sent.length = 0;

    expect((await call("POST", `/orders/${order._id}/vendor-approve`, c.assistantToken)).status).toBe(200);
    expect((await call("POST", `/orders/${order._id}/vendor-approve`, c.assistantToken)).status).toBe(200); // a repeat approve

    for (const person of [c.client, c.otherSuperAdmin]) {
      const subjects = subjectsTo(person.email);
      expect(subjects.filter((s) => /E-Stamp issued/.test(s))).toHaveLength(1);
      expect(subjects.filter((s) => /E-Stamp ready/.test(s))).toHaveLength(1);
    }
    const mail = emailsTo(c.client.email).find((m) => /E-Stamp issued/.test(m.subject));
    expect(mail.html).toMatch(/successfully/);
    expect(mail.html).toContain(`${PRIMARY_FRONTEND_URL}/orders/${order._id}`);
  });

  it("FAILURE: every Super Admin gets a failure email with the reason", async () => {
    const c = await cast();
    const { order } = await dispatched(c);
    sent.length = 0;

    const r = await call("POST", `/orders/${order._id}/fail`, c.assistantToken, { reason: "Stamp paper unavailable", refundBalance: true });
    expect(r.status).toBe(200);

    for (const person of [c.client, c.otherSuperAdmin]) {
      const mail = emailsTo(person.email).find((m) => /processing failed/.test(m.subject));
      expect(mail).toBeTruthy();
      expect(mail.html).toContain("Stamp paper unavailable");
      expect(mail.html).toContain(`${PRIMARY_FRONTEND_URL}/orders/${order._id}`);
    }
  });

  it("a requester who is NOT a Super Admin and the Super Admin each hear once", async () => {
    const c = await cast();
    const { user: member } = await makeUser(Role.USER, { organizationId: c.org._id });
    const created = await EStampRequestService.createRequest({ ...requestBody(c), organizationId: c.org._id, createdBy: member._id, actorRole: Role.USER });
    await closeWindow(created.request);
    const r = await call("POST", "/orders/dispatch", c.assistantToken, { orderIds: [created.order._id.toString()], vendorId: c.vendor._id.toString() });
    expect(r.status).toBe(200);
    expect((await vendorUpload(created.order._id, c.vendorToken)).status).toBe(200);
    sent.length = 0;

    expect((await call("POST", `/orders/${created.order._id}/vendor-approve`, c.assistantToken)).status).toBe(200);

    for (const person of [member, c.client, c.otherSuperAdmin]) {
      expect(subjectsTo(person.email).filter((s) => /E-Stamp issued/.test(s))).toHaveLength(1);
    }
  });
});

describe("the certificate is NEVER sent by email - portal only", () => {
  it("no outcome email carries an attachment, a certificate link, or any link outside the portal", async () => {
    const c = await cast();
    const { order } = await dispatched(c);
    expect((await vendorUpload(order._id, c.vendorToken)).status).toBe(200);
    sent.length = 0;
    expect((await call("POST", `/orders/${order._id}/vendor-approve`, c.assistantToken)).status).toBe(200);

    const outcome = sent.filter((m) => /E-Stamp issued|E-Stamp ready/.test(m.subject));
    expect(outcome.length).toBeGreaterThanOrEqual(4);
    for (const mail of outcome) {
      // The provider is handed exactly to/subject/html - there is no attachment channel.
      expect(Object.keys(mail).sort()).toEqual(["html", "subject", "to"]);
      const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href.startsWith(PRIMARY_FRONTEND_URL)).toBe(true);
        expect(href).not.toMatch(/\.pdf|\.png|\.jpe?g|cloudinary|mock-storage|\/files\//i);
      }
      expect(mail.html).toContain("never sent by email");
    }
  });
});

describe("download is limited to the portal, and to the right people", () => {
  it("the assigned Assistant, the Master Admin and the client can download; an unassigned Assistant and another org cannot", async () => {
    const c = await cast();
    const order = await issuedViaVendor(c);
    const download = (token) => call("GET", `/files/estamp/${order._id}/download`, token);

    expect((await download(c.clientToken)).status).toBe(200);
    expect((await download(c.assistantToken)).status).toBe(200);
    const { token: masterToken } = await makeUser(Role.MASTER_ADMIN);
    expect((await download(masterToken)).status).toBe(200);

    const { token: unassignedToken } = await makeAssistant();
    expect((await download(unassignedToken)).status).toBe(404);
    const other = await makeOrg({});
    expect((await download(other.clientToken)).status).toBe(404);
  });
});

describe("staff routing", () => {
  it("falls back to every Master Admin when no Assistant is assigned", async () => {
    const { user: master } = await makeUser(Role.MASTER_ADMIN);
    const ctx = await makeOrg({ assignedAssistantId: null });
    const order = { _id: uid(), orderNumber: "LDE-ORD-X", organizationId: ctx.org._id };

    await notifyOrderStaff(order, { title: "Vendor accepted order", message: "accepted", eventKey: `test:${uid()}`, status: "Accepted" });

    expect(emailsTo(master.email)).toHaveLength(1);
  });

  it("falls back to the Master Admins when the assigned Assistant is deactivated", async () => {
    const { user: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: assistant } = await makeAssistant();
    await User.updateOne({ _id: assistant._id }, { isActive: false });
    const ctx = await makeOrg({ assignedAssistantId: assistant._id });
    const order = { _id: uid(), orderNumber: "LDE-ORD-Y", organizationId: ctx.org._id };

    expect(await notifyAssignedAssistant(ctx.org._id, { type: "ESTAMP_STATUS", title: "t", message: "m" })).toBe(false);
    await notifyOrderStaff(order, { title: "Vendor accepted order", message: "accepted", eventKey: `test:${uid()}`, status: "Accepted" });

    expect(emailsTo(master.email)).toHaveLength(1);
    expect(emailsTo(assistant.email)).toHaveLength(0);
  });
});

describe("email templates - links go into the portal, and are safe", () => {
  const html = (name, data) => renderTemplate(name, data).html;

  it("the outcome emails link to the portal page and say the certificate is never emailed", () => {
    for (const name of ["orderIssued", "orderFailed", "certificateAvailable"]) {
      const out = html(name, { orderNumber: "LDE-ORD-1", reason: "x", portalPath: "/orders/abc123" });
      expect(out).toContain(`href="${PRIMARY_FRONTEND_URL}/orders/abc123"`);
      expect(out).toContain("never sent by email");
    }
  });

  it("renders no link at all when no portal path is given", () => {
    expect(html("orderIssued", { orderNumber: "LDE-ORD-1" })).not.toContain("href=");
  });

  it("escapes a hostile path instead of injecting markup", () => {
    const out = html("orderStatusUpdate", { title: "t", message: "m", portalPath: '/orders/x"><script>alert(1)</script>' });
    expect(out).not.toContain("<script>");
  });

  it("escapes a hostile message", () => {
    const out = html("orderStatusUpdate", { title: "<b>t</b>", message: "<img src=x onerror=alert(1)>", portalPath: "/orders/1" });
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>t</b>");
  });

  it("names no order number in the subject of a multi-order event", () => {
    expect(renderTemplate("orderStatusUpdate", { title: "New orders to stamp", message: "3 sent" }).subject).toBe("New orders to stamp");
  });
});
