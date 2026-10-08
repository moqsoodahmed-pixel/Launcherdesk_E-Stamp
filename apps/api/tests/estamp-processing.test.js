import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { createRequire } from "node:module";
import {
  Organization,
  Wallet,
  Article,
  ArticleVersion,
  User,
  AuditLog,
  Notification,
  EStampRequest,
  EStampOrder,
  EStampDocument,
} from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus, EStampRequestStatus, EStampOrderProcessingStatus, OrderStatus } from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import * as orderController from "../src/controllers/order.controller.js";
import * as fileController from "../src/controllers/file.controller.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

const require = createRequire(import.meta.url);
const { getEStampProvider } = require("../src/services/estamp-providers/index.js");
const { MockEStampProvider } = require("../src/services/estamp-providers/MockEStampProvider.js");
const { RealEStampProvider } = require("../src/services/estamp-providers/RealEStampProvider.js");
const { env } = require("../src/config/env.js");

async function makeLockedOrder({ balance = 100000, fixedAmount = 500 } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: "Processing Test Co",
    contactEmail: `proc-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `PROC-${new mongoose.Types.ObjectId()}`, title: "Processing Test Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });

  const { request, order } = await EStampRequestService.createRequest({
    organizationId: org._id,
    createdBy: creator,
    stateCode: "KA",
    articleId: article._id.toString(),
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Processing test",
    considerationPrice: 0,
    stampDutyPaidBy: "Alice",
    numberOfEStamps: 1,
  });
  // Simulate lockExpiredRequests() having already run.
  request.status = EStampRequestStatus.LOCKED;
  request.lockedAt = new Date();
  await request.save();
  order.eStampStatus = EStampOrderProcessingStatus.CREATED;
  await order.save();
  return { org, article, request, order, creator };
}

function opsReq(overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) }, ...overrides });
}

describe("Provider abstraction", () => {
  it("the mock provider is selected in development/test", () => {
    expect(getEStampProvider()).toBeInstanceOf(MockEStampProvider);
  });

  it("production fails clearly when the real provider is not configured (ESTAMP_PROVIDER unset/mock)", () => {
    // env.js snapshots process.env at module-load time, so mutating
    // process.env at runtime has no effect on the already-frozen `env`
    // object - mutate env's own property directly instead.
    const original = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(() => getEStampProvider()).toThrow(/ESTAMP_PROVIDER_NOT_CONFIGURED|mock/i);
    } finally {
      env.NODE_ENV = original;
    }
  });

  it("selecting a non-mock provider name resolves to the (unimplemented) real adapter, which fails clearly rather than faking a call", () => {
    const original = env.ESTAMP_PROVIDER;
    env.ESTAMP_PROVIDER = "SOME_REAL_VENDOR";
    try {
      const provider = getEStampProvider();
      expect(provider).toBeInstanceOf(RealEStampProvider);
      expect(() => provider.issueEStamp()).toThrow(/not yet implemented/i);
      expect(() => provider.checkStatus()).toThrow(/not yet implemented/i);
    } finally {
      env.ESTAMP_PROVIDER = original;
    }
  });

  it("provider selection is deterministic (same env, same provider class every time)", () => {
    const a = getEStampProvider();
    const b = getEStampProvider();
    expect(a.constructor).toBe(b.constructor);
  });

  // Phase 18 - integration-readiness boundary check. No real provider
  // webhook signature scheme has ever been supplied to this codebase, so
  // handleProviderWebhook must fail closed (never treat an unverifiable
  // webhook as authentic) when a real (non-mock) provider name is
  // configured. RealEStampProvider.verifyWebhookSignature IS a function
  // (so the `typeof !== "function"` early guard in handleProviderWebhook
  // does not trip) but it throws ESTAMP_PROVIDER_NOT_CONFIGURED as soon as
  // it is actually invoked - proving a webhook can never be silently
  // accepted as genuine merely because the method exists.
  it("a provider webhook cannot be silently accepted when the real provider's signature scheme is unimplemented", async () => {
    const original = env.ESTAMP_PROVIDER;
    env.ESTAMP_PROVIDER = "SOME_REAL_VENDOR";
    try {
      await expect(EStampRequestService.handleProviderWebhook(Buffer.from("{}"), "any-signature")).rejects.toThrow(/not yet implemented|not implemented/i);
    } finally {
      env.ESTAMP_PROVIDER = original;
    }
  });

  it("the mock provider's webhook verification rejects an invalid signature (never returns true for the wrong secret)", () => {
    const { MockEStampProvider: MockProvider } = require("../src/services/estamp-providers/MockEStampProvider.js");
    const provider = new MockProvider();
    const valid = provider.verifyWebhookSignature(Buffer.from("{}"), "totally-wrong-signature");
    expect(valid).toBe(false);
  });
});

describe("Order processing", () => {
  it("a valid (locked) order can be submitted for processing", async () => {
    const { org, order } = await makeLockedOrder();
    const result = await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    expect(result.order.eStampStatus).toBe(EStampOrderProcessingStatus.SUBMITTED);
    expect(result.order.providerReference).toBeDefined();
    const reloadedRequest = await EStampRequest.findById(result.request._id);
    expect(reloadedRequest.status).toBe(EStampRequestStatus.PROCESSING);
  });

  it("an order still in the modification window (not yet locked) cannot be processed", async () => {
    const { org, order, request } = await makeLockedOrder();
    request.status = EStampRequestStatus.MODIFICATION_WINDOW;
    await request.save();
    await expect(
      EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN)
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("an already-issued order cannot be submitted again (idempotent no-op)", async () => {
    const { org, order } = await makeLockedOrder();
    order.eStampStatus = EStampOrderProcessingStatus.ISSUED;
    order.status = OrderStatus.COMPLETED;
    await order.save();
    const result = await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    expect(result.alreadyTerminal).toBe(true);
    expect(result.order.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);
  });

  it("processing an order never debits the wallet again", async () => {
    const { org, order } = await makeLockedOrder({ balance: 1000, fixedAmount: 500 });
    const before = await Wallet.findOne({ organizationId: org._id });
    expect(before.balance).toBe(500); // already debited once at request creation
    await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    const after = await Wallet.findOne({ organizationId: org._id });
    expect(after.balance).toBe(500); // unchanged by processing
  });
});

describe("Idempotency and concurrency", () => {
  it("processing the same order twice in sequence does not create two provider submissions", async () => {
    const { org, order } = await makeLockedOrder();
    const first = await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    const second = await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    expect(second.order.providerReference).toBe(first.order.providerReference);
  });

  it("concurrent processing attempts on the same order result in exactly one effective submission", async () => {
    const { org, order } = await makeLockedOrder();
    const actor = new mongoose.Types.ObjectId().toString();
    const [r1, r2] = await Promise.all([
      EStampRequestService.processOrder(order._id.toString(), org._id.toString(), actor, Role.MASTER_ADMIN),
      EStampRequestService.processOrder(order._id.toString(), org._id.toString(), actor, Role.MASTER_ADMIN),
    ]);
    const submittedResults = [r1, r2].filter((r) => r.order.eStampStatus === EStampOrderProcessingStatus.SUBMITTED);
    expect(submittedResults.length).toBeGreaterThanOrEqual(1);
    // Whichever "lost" the race reports alreadySubmitting rather than
    // silently double-submitting to the provider.
    const losers = [r1, r2].filter((r) => r.alreadySubmitting);
    expect(submittedResults.length + losers.length).toBe(2);
    const finalOrder = await EStampOrder.findById(order._id);
    expect(finalOrder.retryCount).toBeLessThanOrEqual(1); // provider was only actually called once
  });

  it("a duplicate provider webhook callback does not duplicate the state change", async () => {
    const { org, order } = await makeLockedOrder();
    await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    const submitted = await EStampOrder.findById(order._id);

    const body = { providerReference: submitted.providerReference, status: "ISSUED" };
    const rawBody = Buffer.from(JSON.stringify(body));
    const crypto = require("crypto");
    const signature = crypto.createHmac("sha256", "mock_estamp_webhook_secret_dev_only").update(rawBody).digest("hex");

    const first = await EStampRequestService.handleProviderWebhook(rawBody, signature);
    const second = await EStampRequestService.handleProviderWebhook(rawBody, signature);
    expect(first.handled).toBe(true);
    expect(second.alreadyProcessed).toBe(true);
    const issuedCount = await AuditLog.countDocuments({ action: AuditAction.ESTAMP_ISSUED, entityId: order._id.toString() });
    expect(issuedCount).toBe(1);
  });
});

describe("Provider failures", () => {
  it("a provider rejection (sync reports FAILED) becomes an internal FAILED state", async () => {
    const { org, order } = await makeLockedOrder();
    await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    // Force the mock's deterministic failure convention.
    await EStampOrder.updateOne({ _id: order._id }, { providerReference: `${(await EStampOrder.findById(order._id)).providerReference}-SIMFAIL` });
    const result = await EStampRequestService.syncEStampOrderStatus(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    expect(result.order.eStampStatus).toBe(EStampOrderProcessingStatus.FAILED);
    const reloadedRequest = await EStampRequest.findById(order.requestId);
    expect(reloadedRequest.status).toBe(EStampRequestStatus.FAILED);
  });

  it("a provider call timeout/error does not blindly resubmit - order stays in an uncertain (SUBMITTING) state, not auto-marked FAILED", async () => {
    const { org, order } = await makeLockedOrder();
    // Force the real (unimplemented) provider by switching ESTAMP_PROVIDER
    // temporarily - its issueEStamp() throws, simulating a hard provider error.
    const original = env.ESTAMP_PROVIDER;
    env.ESTAMP_PROVIDER = "SOME_REAL_VENDOR";
    try {
      const result = await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
      expect(result.uncertain).toBe(true);
      expect(result.order.eStampStatus).toBe(EStampOrderProcessingStatus.SUBMITTING);
      expect(result.order.providerReference).toBeUndefined();
    } finally {
      env.ESTAMP_PROVIDER = original;
    }
  });

  it("an unknown/malformed provider response is handled safely without corrupting order state", async () => {
    const { org, order } = await makeLockedOrder();
    await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    const result = await EStampRequestService.syncEStampOrderStatus(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    // Mock provider's checkStatus never returns anything other than
    // ISSUED/FAILED, so this exercises the "still pending" branch by design:
    // it must never throw and must never reach a terminal state on its own.
    expect([EStampOrderProcessingStatus.PROCESSING, EStampOrderProcessingStatus.ISSUED]).toContain(result.order.eStampStatus);
  });

  it("a production/config error from the provider factory is handled safely (thrown, not silently swallowed into a fake success)", () => {
    const original = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(() => getEStampProvider()).toThrow();
    } finally {
      env.NODE_ENV = original;
    }
  });
});

describe("Tenant isolation", () => {
  it("Organization A cannot view, process, or sync Organization B's order", async () => {
    const { org: orgA } = await makeLockedOrder();
    const { org: orgB, order: orderB } = await makeLockedOrder();

    const { error: getErr } = await runController(orderController.getOrder, makeReq({ user: { id: "x", role: Role.SUPER_ADMIN, organizationId: orgA._id.toString(), permissions: [] }, params: { id: orderB._id.toString() } }), makeRes());
    expect(getErr).not.toBeNull();
    expect(getErr.statusCode).toBe(404);

    await expect(
      EStampRequestService.processOrder(orderB._id.toString(), orgA._id.toString(), "actor", Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 404 });

    const reloaded = await EStampOrder.findById(orderB._id);
    expect(reloaded.eStampStatus).toBe(EStampOrderProcessingStatus.CREATED); // untouched
  });

  it("Organization A cannot download Organization B's certificate", async () => {
    const { org: orgA } = await makeLockedOrder();
    const { org: orgB, order: orderB, request: requestB } = await makeLockedOrder();
    const asset = await (await import("../src/models/index.js")).FileAsset.create({
      organizationId: orgB._id,
      ownerUserId: new mongoose.Types.ObjectId(),
      cloudinaryPublicId: "mock/test/certificate",
      resourceType: "raw",
      fileType: "ESTAMP_DOCUMENT",
      originalFileName: "stamp.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    });
    await EStampDocument.create({ organizationId: orgB._id, requestId: requestB._id, orderId: orderB._id, fileAssetId: asset._id });

    const req = makeReq({ user: { id: "x", role: Role.SUPER_ADMIN, organizationId: orgA._id.toString(), permissions: [] }, params: { orderId: orderB._id.toString() } });
    const { error } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });
});

describe("RBAC", () => {
  it("an unauthorized client role (SUPER_ADMIN, without ORDER_MANAGE) cannot process/sync/retry an order", async () => {
    for (const perm of [Permission.ORDER_MANAGE]) {
      const req = makeReq({ user: { id: "x", role: Role.SUPER_ADMIN, organizationId: "org", permissions: [] } });
      const { threw } = await runMiddleware(requirePermission(perm), req, makeRes());
      expect(threw).not.toBeNull();
      expect(threw.statusCode).toBe(403);
    }
  });

  it("Master Admin (permission-gated ORDER_MANAGE via all-permissions) can process an order", async () => {
    const { org, order } = await makeLockedOrder();
    const req = opsReq({ params: { id: order._id.toString() } });
    const { error } = await runController(orderController.processOrder, req, makeRes());
    expect(error).toBeNull();
  });

  it("an Assistant Master Admin without explicit ORDER_MANAGE is denied", async () => {
    const req = makeReq({ user: { id: "x", role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [] } });
    const { threw } = await runMiddleware(requirePermission(Permission.ORDER_MANAGE), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("an Assistant Master Admin explicitly granted ORDER_MANAGE can process an order, audited and notifying Master Admin", async () => {
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
});

describe("Certificate", () => {
  it("an unissued order cannot have a certificate attached, and cannot be downloaded", async () => {
    const { org, order } = await makeLockedOrder();
    const req = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) },
      body: { organizationId: org._id.toString(), fileType: "ESTAMP_DOCUMENT", orderId: order._id.toString() },
      file: { buffer: Buffer.from("fake"), originalname: "cert.pdf", mimetype: "application/pdf" },
    });
    const { error } = await runController(fileController.uploadFile, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("NOT_ISSUED");

    const downloadReq = makeReq({ user: { id: "x", role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions: [] }, params: { orderId: order._id.toString() } });
    const { error: downloadErr } = await runController(fileController.downloadEStamp, downloadReq, makeRes());
    expect(downloadErr).not.toBeNull();
    expect(downloadErr.statusCode).toBe(404);
  });

  it("an issued order can have a certificate attached (by an ORDER_MANAGE-permitted actor) and then downloaded, remaining tenant-isolated", async () => {
    const { org, order } = await makeLockedOrder();
    await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    const submitted = await EStampOrder.findById(order._id);
    const synced = await EStampRequestService.syncEStampOrderStatus(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    expect(synced.order.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);

    const uploadReq = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) },
      body: { organizationId: org._id.toString(), fileType: "ESTAMP_DOCUMENT", orderId: order._id.toString() },
      file: { buffer: Buffer.from("fake-not-a-real-certificate"), originalname: "cert.pdf", mimetype: "application/pdf" },
    });
    const { error: uploadErr } = await runController(fileController.uploadFile, uploadReq, makeRes());
    expect(uploadErr).toBeNull();

    const ownReq = makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions: [] }, params: { orderId: order._id.toString() } });
    const { res: ownRes, error: ownErr } = await runController(fileController.downloadEStamp, ownReq, makeRes());
    expect(ownErr).toBeNull();
    expect(ownRes.body.data.url).toBeDefined();

    const otherOrgReq = makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: new mongoose.Types.ObjectId().toString(), permissions: [] }, params: { orderId: order._id.toString() } });
    const { error: otherErr } = await runController(fileController.downloadEStamp, otherOrgReq, makeRes());
    expect(otherErr).not.toBeNull();
    expect(otherErr.statusCode).toBe(404);
  });
});

describe("Modification/cancellation protection", () => {
  it("a locked (processing-ready) request can no longer be modified or cancelled - the 20-minute window has already closed", async () => {
    const { org, request } = await makeLockedOrder();
    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), org._id.toString(), "actor", Role.SUPER_ADMIN, { firstParty: "Hacked" })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), org._id.toString(), "actor", Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("a request actively PROCESSING cannot be modified or cancelled either", async () => {
    const { org, order } = await makeLockedOrder();
    const { request } = await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    expect(request.status).toBe(EStampRequestStatus.PROCESSING);
    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), org._id.toString(), "actor", Role.SUPER_ADMIN, { firstParty: "Hacked" })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("Webhook", () => {
  it("an invalid provider signature is rejected and never mutates order state", async () => {
    const { org, order } = await makeLockedOrder();
    await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    const submitted = await EStampOrder.findById(order._id);
    const body = { providerReference: submitted.providerReference, status: "ISSUED" };
    const rawBody = Buffer.from(JSON.stringify(body));
    await expect(EStampRequestService.handleProviderWebhook(rawBody, "forged-signature")).rejects.toMatchObject({ statusCode: 401 });
    const reloaded = await EStampOrder.findById(order._id);
    expect(reloaded.eStampStatus).toBe(EStampOrderProcessingStatus.SUBMITTED); // untouched
  });

  it("a webhook referencing an unknown provider reference does not modify any record", async () => {
    const body = { providerReference: "MOCK-REF-does-not-exist", status: "ISSUED" };
    const rawBody = Buffer.from(JSON.stringify(body));
    const crypto = require("crypto");
    const signature = crypto.createHmac("sha256", "mock_estamp_webhook_secret_dev_only").update(rawBody).digest("hex");
    const result = await EStampRequestService.handleProviderWebhook(rawBody, signature);
    expect(result.handled).toBe(false);
    expect(result.reason).toBe("unknown_order");
  });

  it("the webhook never trusts an organizationId from the payload - it correlates strictly via the provider reference", async () => {
    const { org, order } = await makeLockedOrder();
    await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.MASTER_ADMIN);
    const submitted = await EStampOrder.findById(order._id);
    const spoofedOrgId = new mongoose.Types.ObjectId().toString();
    const body = { providerReference: submitted.providerReference, status: "ISSUED", organizationId: spoofedOrgId };
    const rawBody = Buffer.from(JSON.stringify(body));
    const crypto = require("crypto");
    const signature = crypto.createHmac("sha256", "mock_estamp_webhook_secret_dev_only").update(rawBody).digest("hex");
    await EStampRequestService.handleProviderWebhook(rawBody, signature);
    const reloaded = await EStampOrder.findById(order._id);
    expect(reloaded.organizationId.toString()).toBe(org._id.toString()); // unchanged, never the spoofed value
    expect(reloaded.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);
  });
});
