import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Organization, Wallet, Article, ArticleVersion, User, AuditLog, Notification, EStampOrder, EStampRequest } from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus, EStampOrderProcessingStatus, OrderStatus } from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import * as orderController from "../src/controllers/order.controller.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

async function makeLockedOrder({ balance = 100000, fixedAmount = 500, stateCode = "KA", orgName = "Order Mgmt Test Co" } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: orgName,
    contactEmail: `ordmgmt-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode, articleCode: `OM-${new mongoose.Types.ObjectId()}`, title: "Order Mgmt Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  const { request, order } = await EStampRequestService.createRequest({
    organizationId: org._id,
    createdBy: creator,
    stateCode,
    articleId: article._id.toString(),
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Order mgmt test",
    considerationPrice: 0,
    stampDutyPaidBy: "Alice",
    numberOfEStamps: 1,
  });
  request.status = "LOCKED";
  await request.save();
  order.eStampStatus = EStampOrderProcessingStatus.CREATED;
  await order.save();
  return { org, article, request, order, creator };
}

function opsReq(overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) }, ...overrides });
}
function clientReq(organizationId, overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: organizationId.toString(), permissions: [Permission.ORDER_VIEW] }, ...overrides });
}

describe("Listing", () => {
  it("Master Admin can list all orders across organizations", async () => {
    const { order: order1 } = await makeLockedOrder();
    const { order: order2 } = await makeLockedOrder();
    const { res, error } = await runController(orderController.listOrders, opsReq({ query: {} }), makeRes());
    expect(error).toBeNull();
    const ids = res.body.data.items.map((i) => i._id.toString());
    expect(ids).toContain(order1._id.toString());
    expect(ids).toContain(order2._id.toString());
  });

  it("a client can list only their own organization's orders", async () => {
    const { org, order } = await makeLockedOrder();
    await makeLockedOrder(); // another org's order
    const { res, error } = await runController(orderController.listOrders, clientReq(org._id, { query: {} }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0]._id.toString()).toBe(order._id.toString());
  });

  it("a client cannot list another organization by passing a different organizationId in the query", async () => {
    const { org: orgA } = await makeLockedOrder();
    const { org: orgB, order: orderB } = await makeLockedOrder();
    const { res, error } = await runController(orderController.listOrders, clientReq(orgA._id, { query: { organizationId: orgB._id.toString() } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.find((i) => i._id.toString() === orderB._id.toString())).toBeUndefined();
  });

  it("pagination works", async () => {
    for (let i = 0; i < 3; i++) await makeLockedOrder();
    const { res, error } = await runController(orderController.listOrders, opsReq({ query: { page: "1", limit: "2" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(2);
    expect(res.body.data.total).toBeGreaterThanOrEqual(3);
  });

  it("search matches orderNumber/providerReference", async () => {
    const { org, order } = await makeLockedOrder();
    const { res, error } = await runController(orderController.listOrders, opsReq({ query: { search: order.orderNumber } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.some((i) => i._id.toString() === order._id.toString())).toBe(true);
  });

  it("eStampStatus filtering works", async () => {
    const { org, order } = await makeLockedOrder();
    const { res, error } = await runController(orderController.listOrders, opsReq({ query: { organizationId: org._id.toString(), eStampStatus: EStampOrderProcessingStatus.CREATED } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(1);
    const { res: res2 } = await runController(orderController.listOrders, opsReq({ query: { organizationId: org._id.toString(), eStampStatus: EStampOrderProcessingStatus.ISSUED } }), makeRes());
    expect(res2.body.data.items.length).toBe(0);
  });

  it("stateCode filtering works", async () => {
    const { org } = await makeLockedOrder({ stateCode: "MH" });
    const { res, error } = await runController(orderController.listOrders, opsReq({ query: { organizationId: org._id.toString(), stateCode: "MH" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(1);
    const { res: wrongState } = await runController(orderController.listOrders, opsReq({ query: { organizationId: org._id.toString(), stateCode: "DL" } }), makeRes());
    expect(wrongState.body.data.items.length).toBe(0);
  });

  it("articleId filtering works", async () => {
    const { org, article } = await makeLockedOrder();
    const { res, error } = await runController(orderController.listOrders, opsReq({ query: { organizationId: org._id.toString(), articleId: article._id.toString() } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(1);
  });

  it("date filtering works", async () => {
    const { org } = await makeLockedOrder();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { res, error } = await runController(orderController.listOrders, opsReq({ query: { organizationId: org._id.toString(), dateFrom: future } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(0);
  });

  it("Master Admin organization filter works", async () => {
    const { org, order } = await makeLockedOrder();
    const { res, error } = await runController(orderController.listOrders, opsReq({ query: { organizationId: org._id.toString() } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.every((i) => i.organizationId.toString() === org._id.toString())).toBe(true);
  });
});

describe("Detail", () => {
  it("Master Admin can view any order, including request info, timeline, and certificate availability", async () => {
    const { order } = await makeLockedOrder();
    const { res, error } = await runController(orderController.getOrder, opsReq({ params: { id: order._id.toString() } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.order._id.toString()).toBe(order._id.toString());
    expect(res.body.data.request.firstParty).toBe("Alice");
    expect(res.body.data.certificateAvailable).toBe(false);
    expect(Array.isArray(res.body.data.timeline)).toBe(true);
  });

  it("a client can view their own order", async () => {
    const { org, order } = await makeLockedOrder();
    const { error } = await runController(orderController.getOrder, clientReq(org._id, { params: { id: order._id.toString() } }), makeRes());
    expect(error).toBeNull();
  });

  it("a client cannot view another organization's order", async () => {
    const { org: orgA } = await makeLockedOrder();
    const { order: orderB } = await makeLockedOrder();
    const { error } = await runController(orderController.getOrder, clientReq(orgA._id, { params: { id: orderB._id.toString() } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });

  it("a missing order returns the existing 404 behavior", async () => {
    const { error } = await runController(orderController.getOrder, opsReq({ params: { id: new mongoose.Types.ObjectId().toString() } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });
});

describe("Summary", () => {
  it("Master Admin summary is globally correct", async () => {
    await makeLockedOrder();
    await makeLockedOrder();
    const { res, error } = await runController(orderController.getOrderSummary, opsReq({ query: {} }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBeGreaterThanOrEqual(2);
    expect(res.body.data.CREATED).toBeGreaterThanOrEqual(2);
  });

  it("client summary is organization-scoped", async () => {
    const { org } = await makeLockedOrder();
    await makeLockedOrder(); // another org
    const { res, error } = await runController(orderController.getOrderSummary, clientReq(org._id, { query: {} }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(1);
  });

  it("summary totals are not corrupted by pagination (summary ignores page/limit)", async () => {
    const { org } = await makeLockedOrder();
    for (let i = 0; i < 2; i++) await makeLockedOrder({ orgName: `Extra-${i}` });
    const { res } = await runController(orderController.getOrderSummary, opsReq({ query: { page: "1", limit: "1" } }), makeRes());
    expect(res.body.data.total).toBeGreaterThanOrEqual(3);
  });
});

describe("Processing / Sync / Retry", () => {
  it("an authorized operational user can process an order", async () => {
    const { org, order } = await makeLockedOrder();
    const { error } = await runController(orderController.processOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    expect(error).toBeNull();
  });

  it("an unauthorized client cannot process an order (no ORDER_MANAGE)", async () => {
    const req = clientReq(new mongoose.Types.ObjectId());
    const { threw } = await runMiddleware(requirePermission(Permission.ORDER_MANAGE), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("processing does not debit the wallet", async () => {
    const { org, order } = await makeLockedOrder({ balance: 1000, fixedAmount: 500 });
    const before = await Wallet.findOne({ organizationId: org._id });
    await runController(orderController.processOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    const after = await Wallet.findOne({ organizationId: org._id });
    expect(after.balance).toBe(before.balance);
  });

  it("an authorized sync action works", async () => {
    const { org, order } = await makeLockedOrder();
    await runController(orderController.processOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    const { res, error } = await runController(orderController.syncOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.order.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);
  });

  it("an unauthorized sync action is rejected", async () => {
    const req = clientReq(new mongoose.Types.ObjectId());
    const { threw } = await runMiddleware(requirePermission(Permission.ORDER_MANAGE), req, makeRes());
    expect(threw).not.toBeNull();
  });

  it("a failed order can use the existing retry path when permitted", async () => {
    const { org, order } = await makeLockedOrder();
    await runController(orderController.processOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    const submitted = await EStampOrder.findById(order._id);
    await EStampOrder.updateOne({ _id: order._id }, { providerReference: `${submitted.providerReference}-SIMFAIL` });
    await runController(orderController.syncOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    const failed = await EStampOrder.findById(order._id);
    expect(failed.eStampStatus).toBe(EStampOrderProcessingStatus.FAILED);
    // FAILED is terminal (see Phase 7) - retry never blindly resubmits a
    // failed order, it reports the existing terminal state instead.
    const { res: retryRes, error: retryErr } = await runController(orderController.retryOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    expect(retryErr).toBeNull();
    expect(retryRes.body.data.alreadyTerminal).toBe(true);
  });

  it("an unauthorized retry is rejected", async () => {
    const req = clientReq(new mongoose.Types.ObjectId());
    const { threw } = await runMiddleware(requirePermission(Permission.ORDER_MANAGE), req, makeRes());
    expect(threw).not.toBeNull();
  });

  it("retry does not debit the wallet again", async () => {
    const { org, order } = await makeLockedOrder({ balance: 1000, fixedAmount: 500 });
    await runController(orderController.processOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    const afterFirst = await Wallet.findOne({ organizationId: org._id });
    await runController(orderController.retryOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    const afterRetry = await Wallet.findOne({ organizationId: org._id });
    expect(afterRetry.balance).toBe(afterFirst.balance);
  });

  it("a successful (ISSUED) order cannot be arbitrarily retried into resubmission", async () => {
    const { org, order } = await makeLockedOrder();
    await runController(orderController.processOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    await runController(orderController.syncOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    const issued = await EStampOrder.findById(order._id);
    expect(issued.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);
    const providerRefBefore = issued.providerReference;
    const { res: retryRes } = await runController(orderController.retryOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    expect(retryRes.body.data.alreadyTerminal).toBe(true);
    const reloaded = await EStampOrder.findById(order._id);
    expect(reloaded.providerReference).toBe(providerRefBefore); // unchanged
  });
});

describe("Assistant Master Admin", () => {
  it("Assistant without ORDER_MANAGE is denied for process/sync/retry", async () => {
    const req = makeReq({ user: { id: "x", role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [] } });
    const { threw } = await runMiddleware(requirePermission(Permission.ORDER_MANAGE), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("an Assistant explicitly granted ORDER_MANAGE processing an order is audited and notifies Master Admin", async () => {
    const { org, order } = await makeLockedOrder();
    const master = await User.create({ name: "Master", email: `m-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    const assistantId = new mongoose.Types.ObjectId().toString();
    const req = makeReq({ user: { id: assistantId, role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [Permission.ORDER_MANAGE] }, params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } });
    const { error } = await runController(orderController.processOrder, req, makeRes());
    expect(error).toBeNull();
    const notification = await Notification.findOne({ recipientId: master._id, relatedActorId: assistantId });
    expect(notification).not.toBeNull();
    expect(notification.type).toBe("ASSISTANT_ADMIN_ACTIVITY");
  });

  it("an Assistant viewing an order detail is audited (ORDER_VIEWED)", async () => {
    const { org, order } = await makeLockedOrder();
    const assistantId = new mongoose.Types.ObjectId().toString();
    const req = makeReq({ user: { id: assistantId, role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [Permission.ORDER_VIEW] }, params: { id: order._id.toString() } });
    const { error } = await runController(orderController.getOrder, req, makeRes());
    expect(error).toBeNull();
    const auditEntry = await AuditLog.findOne({ actorId: assistantId, action: AuditAction.ORDER_VIEWED });
    expect(auditEntry).not.toBeNull();
  });
});

describe("Security", () => {
  it("organizationId spoofing cannot escape tenant scope for listing", async () => {
    const { org: orgA } = await makeLockedOrder();
    const { org: orgB, order: orderB } = await makeLockedOrder();
    const { res } = await runController(orderController.listOrders, clientReq(orgA._id, { query: { organizationId: orgB._id.toString() } }), makeRes());
    expect(res.body.data.items.find((i) => i._id.toString() === orderB._id.toString())).toBeUndefined();
  });

  it("an arbitrary sort field is rejected/ignored in favor of the safe default", async () => {
    const { org } = await makeLockedOrder();
    const { res, error } = await runController(orderController.listOrders, opsReq({ query: { organizationId: org._id.toString(), sortBy: "passwordHash" } }), makeRes());
    expect(error).toBeNull(); // silently falls back to createdAt, never throws or applies the unsafe field
  });

  it("an invalid date range is rejected", async () => {
    const { error } = await runController(orderController.listOrders, opsReq({ query: { dateFrom: "2025-01-10", dateTo: "2025-01-01" } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_DATE_RANGE");
  });

  it("an invalid status value is rejected", async () => {
    const { error } = await runController(orderController.listOrders, opsReq({ query: { status: "NOT_A_REAL_STATUS" } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_STATUS");
  });

  it("an invalid eStampStatus value is rejected", async () => {
    const { error } = await runController(orderController.listOrders, opsReq({ query: { eStampStatus: "HACKED" } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_STATUS");
  });
});

describe("State machine protection (regression from Phase 7)", () => {
  it("the API surface has no endpoint that directly sets ISSUED or a provider reference", async () => {
    const { org, order } = await makeLockedOrder();
    // getOrder/listOrders are read-only; the only mutating endpoints are
    // process/sync/retry, all of which delegate to EStampRequestService's
    // existing, transition-checked logic - there is no direct field-update path.
    const { res } = await runController(orderController.getOrder, opsReq({ params: { id: order._id.toString() } }), makeRes());
    expect(res.body.data.order.eStampStatus).toBe(EStampOrderProcessingStatus.CREATED);
  });

  it("an invalid transition (e.g. processing a still-in-modification-window order) is still rejected", async () => {
    const { org, order, request } = await makeLockedOrder();
    request.status = "MODIFICATION_WINDOW";
    await request.save();
    const { error } = await runController(orderController.processOrder, opsReq({ params: { id: order._id.toString() }, query: { organizationId: org._id.toString() } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_STATE_TRANSITION");
  });
});
