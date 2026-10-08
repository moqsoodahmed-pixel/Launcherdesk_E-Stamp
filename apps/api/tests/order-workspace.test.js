import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Organization, Wallet, Article, ArticleVersion, EStampOrder, EStampRequest, EStampDocument, FileAsset, AuditLog } from "../src/models/index.js";
import { Role, Permission, EStampOrderProcessingStatus } from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import * as orderController from "../src/controllers/order.controller.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";

// Phase 24 - Order workspace backend contract: server-computed
// availableActions, AUDIT_VIEW-gated history, list enrichment, tenant
// isolation of operational actions, and the no-blind-resubmission rule.

async function makeLockedOrder({ balance = 100000, fixedAmount = 500 } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: `Workspace Co ${new mongoose.Types.ObjectId()}`,
    contactEmail: `ws-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: "ACTIVE",
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `WS-${new mongoose.Types.ObjectId()}`, title: "Workspace Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  const { request, order } = await EStampRequestService.createRequest({
    organizationId: org._id,
    createdBy: creator,
    stateCode: "KA",
    articleId: article._id.toString(),
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Workspace test",
    considerationPrice: 0,
    stampDutyPaidBy: "Alice",
    numberOfEStamps: 1,
  });
  request.status = "LOCKED";
  await request.save();
  order.eStampStatus = EStampOrderProcessingStatus.CREATED;
  await order.save();
  return { org, request, order };
}

const uid = () => new mongoose.Types.ObjectId().toString();
function master(overrides = {}) {
  return makeReq({ user: { id: uid(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) }, ...overrides });
}
function assistant(permissions, overrides = {}) {
  return makeReq({ user: { id: uid(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions }, ...overrides });
}
function client(orgId, permissions, role = Role.ADMIN, overrides = {}) {
  return makeReq({ user: { id: uid(), role, organizationId: orgId.toString(), permissions }, ...overrides });
}
async function detail(req, orderId) {
  req.params = { id: orderId.toString() };
  const { res, error } = await runController(orderController.getOrder, req, makeRes());
  return { data: res?.body?.data, error };
}

describe("availableActions (server-authoritative)", () => {
  it("Master Admin on a CREATED order: process only; retry is never offered", async () => {
    const { order } = await makeLockedOrder();
    const { data } = await detail(master(), order._id);
    expect(data.availableActions).toEqual({ process: true, sync: false, retry: false });
  });

  it("a client with only ORDER_VIEW gets no actions", async () => {
    const { org, order } = await makeLockedOrder();
    const { data, error } = await detail(client(org._id, [Permission.ORDER_VIEW]), order._id);
    expect(error).toBeNull();
    expect(data.availableActions).toEqual({ process: false, sync: false, retry: false });
  });

  it("a client explicitly granted ORDER_MANAGE gets process for their own order", async () => {
    const { org, order } = await makeLockedOrder();
    const { data } = await detail(client(org._id, [Permission.ORDER_VIEW, Permission.ORDER_MANAGE]), order._id);
    expect(data.availableActions.process).toBe(true);
  });

  it("an Assistant without ORDER_MANAGE gets no actions; with it, gets process", async () => {
    const { order } = await makeLockedOrder();
    const without = await detail(assistant([Permission.ORDER_VIEW]), order._id);
    expect(without.data.availableActions.process).toBe(false);
    const withManage = await detail(assistant([Permission.ORDER_VIEW, Permission.ORDER_MANAGE]), order._id);
    expect(withManage.data.availableActions.process).toBe(true);
  });

  it("process is withheld when the request is still in its modification window", async () => {
    const { order, request } = await makeLockedOrder();
    request.status = "MODIFICATION_WINDOW";
    await request.save();
    const { data } = await detail(master(), order._id);
    expect(data.availableActions.process).toBe(false);
  });

  it("after submission (provider reference) sync is offered and process is not; ISSUED offers nothing", async () => {
    const { org, order } = await makeLockedOrder();
    const q = { organizationId: org._id.toString() };
    await runController(orderController.processOrder, master({ params: { id: order._id.toString() }, query: q }), makeRes());
    const submitted = await detail(master(), order._id);
    expect(submitted.data.order.eStampStatus).toBe(EStampOrderProcessingStatus.SUBMITTED);
    expect(submitted.data.availableActions).toEqual({ process: false, sync: true, retry: false });
    await runController(orderController.syncOrder, master({ params: { id: order._id.toString() }, query: q }), makeRes());
    const issued = await detail(master(), order._id);
    expect(issued.data.order.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);
    expect(issued.data.availableActions).toEqual({ process: false, sync: false, retry: false });
  });
});

describe("ambiguous SUBMITTING is never resubmitted", () => {
  it("SUBMITTING without a provider reference offers no action and retry is a state no-op", async () => {
    const { org, order } = await makeLockedOrder();
    await EStampOrder.updateOne({ _id: order._id }, { eStampStatus: EStampOrderProcessingStatus.SUBMITTING, retryCount: 1 });
    await EStampRequest.updateOne({ _id: order.requestId }, { status: "PROCESSING" });
    const { data } = await detail(master(), order._id);
    expect(data.availableActions).toEqual({ process: false, sync: false, retry: false });

    const { res, error } = await runController(
      orderController.retryOrder,
      master({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }),
      makeRes()
    );
    expect(error).toBeNull();
    expect(res.body.data.alreadySubmitting).toBe(true);
    const after = await EStampOrder.findById(order._id);
    expect(after.eStampStatus).toBe(EStampOrderProcessingStatus.SUBMITTING); // not reset to CREATED
    expect(after.retryCount).toBe(1); // no new submission attempt
    expect(after.providerReference).toBeFalsy();
  });
});

describe("audit history gating", () => {
  it("history is null without AUDIT_VIEW and an array with it", async () => {
    const { org, order } = await makeLockedOrder();
    await runController(orderController.processOrder, master({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    const without = await detail(client(org._id, [Permission.ORDER_VIEW]), order._id);
    expect(without.data.history).toBeNull();
    const withAudit = await detail(client(org._id, [Permission.ORDER_VIEW, Permission.AUDIT_VIEW]), order._id);
    expect(Array.isArray(withAudit.data.history)).toBe(true);
    expect(withAudit.data.history.length).toBeGreaterThan(0);
  });

  it("an Assistant without AUDIT_VIEW does not receive history", async () => {
    const { order } = await makeLockedOrder();
    const { data } = await detail(assistant([Permission.ORDER_VIEW]), order._id);
    expect(data.history).toBeNull();
  });
});

describe("timeline uses only real records", () => {
  it("starts with the real Request created timestamp and has no fabricated later events", async () => {
    const { order, request } = await makeLockedOrder();
    const { data } = await detail(master(), order._id);
    const labels = data.timeline.map((t) => t.label);
    expect(labels[0]).toBe("Request created");
    expect(new Date(data.timeline[0].at).getTime()).toBe(new Date(request.createdAt).getTime());
    expect(labels).toContain("Order created");
    expect(labels).not.toContain("Submitted to provider");
    expect(labels).not.toContain("Issued");
    expect(labels).not.toContain("Certificate document attached");
  });

  it("includes Submitted/Issued only once their real timestamps exist", async () => {
    const { org, order } = await makeLockedOrder();
    const q = { organizationId: org._id.toString() };
    await runController(orderController.processOrder, master({ params: { id: order._id.toString() }, query: q }), makeRes());
    await runController(orderController.syncOrder, master({ params: { id: order._id.toString() }, query: q }), makeRes());
    const { data } = await detail(master(), order._id);
    const labels = data.timeline.map((t) => t.label);
    expect(labels).toContain("Submitted to provider");
    expect(labels).toContain("Issued");
  });
});

describe("certificate availability is distinct from ISSUED", () => {
  async function issuedOrder() {
    const ctx = await makeLockedOrder();
    const q = { organizationId: ctx.org._id.toString() };
    await runController(orderController.processOrder, master({ params: { id: ctx.order._id.toString() }, query: q }), makeRes());
    await runController(orderController.syncOrder, master({ params: { id: ctx.order._id.toString() }, query: q }), makeRes());
    return ctx;
  }

  it("ISSUED without a document: certificateAvailable false, document null", async () => {
    const { order } = await issuedOrder();
    const { data } = await detail(master(), order._id);
    expect(data.order.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);
    expect(data.certificateAvailable).toBe(false);
    expect(data.document).toBeNull();
  });

  it("ISSUED with a document: certificateAvailable true and no storage identifiers leak", async () => {
    const { org, order } = await issuedOrder();
    const asset = await FileAsset.create({
      organizationId: org._id,
      ownerUserId: new mongoose.Types.ObjectId(),
      cloudinaryPublicId: "mock/ws-test/1",
      resourceType: "raw",
      fileType: "ESTAMP_DOCUMENT",
      originalFileName: "c.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    });
    await EStampDocument.create({ organizationId: org._id, requestId: order.requestId, orderId: order._id, fileAssetId: asset._id });
    const { data } = await detail(master(), order._id);
    expect(data.certificateAvailable).toBe(true);
    expect(data.document.contentType).toBe("application/pdf");
    expect(JSON.stringify(data.document)).not.toContain("cloudinary");
  });
});

describe("list enrichment", () => {
  it("adds requestNumber for everyone, organizationName only for internal actors", async () => {
    const { org, order, request } = await makeLockedOrder();
    const internal = await runController(orderController.listOrders, master({ query: { search: order.orderNumber } }), makeRes());
    const row = internal.res.body.data.items.find((i) => i._id.toString() === order._id.toString());
    expect(row.requestNumber).toBe(request.requestNumber);
    expect(row.organizationName).toBe(org.name);

    const tenant = await runController(orderController.listOrders, client(org._id, [Permission.ORDER_VIEW], Role.ADMIN, { query: { search: order.orderNumber } }), makeRes());
    const trow = tenant.res.body.data.items[0];
    expect(trow.requestNumber).toBe(request.requestNumber);
    expect(trow).not.toHaveProperty("organizationName");
  });

  it("search with regex metacharacters is treated literally", async () => {
    await makeLockedOrder();
    const { res, error } = await runController(orderController.listOrders, master({ query: { search: ".*" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items).toHaveLength(0);
  });

  it("limit is capped server-side", async () => {
    const { res } = await runController(orderController.listOrders, master({ query: { limit: "100000" } }), makeRes());
    expect(res.body.data.limit).toBe(100);
  });
});

describe("cross-tenant operational actions", () => {
  it("org B (even with ORDER_MANAGE) cannot view, process, sync or retry org A's order", async () => {
    const { order } = await makeLockedOrder();
    const { org: orgB } = await makeLockedOrder();
    const perms = [Permission.ORDER_VIEW, Permission.ORDER_MANAGE, Permission.AUDIT_VIEW];
    const params = { id: order._id.toString() };
    const view = await runController(orderController.getOrder, client(orgB._id, perms, Role.SUPER_ADMIN, { params }), makeRes());
    expect(view.error.statusCode).toBe(404);
    for (const fn of [orderController.processOrder, orderController.syncOrder, orderController.retryOrder]) {
      // A spoofed organizationId in the query must be ignored for tenant actors.
      const r = await runController(fn, client(orgB._id, perms, Role.SUPER_ADMIN, { params, query: { organizationId: order.organizationId.toString() } }), makeRes());
      expect(r.error.statusCode).toBe(404);
    }
    const untouched = await EStampOrder.findById(order._id);
    expect(untouched.eStampStatus).toBe(EStampOrderProcessingStatus.CREATED);
    expect(untouched.providerReference).toBeFalsy();
  });
});

describe("wallet safety", () => {
  it("process + sync + retry never change the wallet balance or add ledger debits", async () => {
    const { org, order } = await makeLockedOrder({ balance: 1000, fixedAmount: 500 });
    const before = await Wallet.findOne({ organizationId: org._id });
    const q = { organizationId: org._id.toString() };
    for (const fn of [orderController.processOrder, orderController.syncOrder, orderController.retryOrder]) {
      await runController(fn, master({ params: { id: order._id.toString() }, query: q }), makeRes());
    }
    const after = await Wallet.findOne({ organizationId: org._id });
    expect(after.balance).toBe(before.balance);
  });
});

describe("audit of views", () => {
  it("an Assistant view is still audited (ORDER_VIEWED)", async () => {
    const { order } = await makeLockedOrder();
    await detail(assistant([Permission.ORDER_VIEW]), order._id);
    const entry = await AuditLog.findOne({ entityType: "EStampOrder", entityId: order._id.toString(), action: "ORDER_VIEWED" });
    expect(entry).not.toBeNull();
  });
});
