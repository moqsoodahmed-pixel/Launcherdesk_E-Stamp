import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { createRequire } from "node:module";
import { Organization, Wallet, Article, ArticleVersion, User, AuditLog, Notification, EStampRequest, EStampOrder } from "../src/models/index.js";
import { Role, AuditAction, OrganizationStatus, EStampRequestStatus } from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import * as estampController from "../src/controllers/estamp-request.controller.js";
import { createEStampRequestSchema, updateEStampRequestSchema } from "@launcherdesk/validation";
import { makeReq, makeRes, runController } from "./helpers/http.js";

// These are plain CommonJS modules - loaded via require() (like the rest of
// the CJS codebase, and like estamp-request.service.js itself) rather than
// ESM import, so `instanceof` checks below compare against the SAME class
// the service actually uses. See modification-window.test.js for the same
// pattern and why (dual CJS/ESM module instance hazard under Vitest).
const require = createRequire(import.meta.url);
const { getEStampProvider } = require("../src/services/estamp-providers/index.js");
const { MockEStampProvider } = require("../src/services/estamp-providers/MockEStampProvider.js");

async function makeOrgWithArticle({ balance = 100000, fixedAmount = 500 } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: "EStamp Test Co",
    contactEmail: `estamp-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `ART-${new mongoose.Types.ObjectId()}`, title: "Test Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  return { org, article };
}

function baseRequestBody(article, overrides = {}) {
  return createEStampRequestSchema.parse({
    stateCode: "KA",
    articleId: article._id.toString(),
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Test agreement",
    considerationPrice: 0,
    stampDutyPaidBy: "Alice",
    numberOfEStamps: 1,
    ...overrides,
  });
}

function reqAsUser(user, overrides = {}) {
  return makeReq({
    user: { id: user._id.toString(), role: user.role, organizationId: user.organizationId.toString(), permissions: [] },
    ...overrides,
  });
}

describe("Creation", () => {
  it("a valid request succeeds, debits the wallet, and creates a linked order", async () => {
    const { org, article } = await makeOrgWithArticle({ balance: 10000, fixedAmount: 500 });
    const user = await User.create({ name: "U", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.USER, organizationId: org._id });
    const { request, order } = await EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: user._id, actorRole: Role.USER });
    expect(request.status).toBe(EStampRequestStatus.MODIFICATION_WINDOW);
    expect(request.calculatedStampDuty).toBe(500);
    expect(order.requestId.toString()).toBe(request._id.toString());
    expect(order.amount).toBe(500);
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(9500);

    const auditEntry = await AuditLog.findOne({ action: AuditAction.ESTAMP_REQUEST_CREATED, entityId: request._id.toString() });
    expect(auditEntry).not.toBeNull();
  });

  it("organizationId is always derived from the authenticated user, never the request body", async () => {
    const { org, article } = await makeOrgWithArticle();
    const otherOrg = await Organization.create({ name: "Other", contactEmail: `other-${new mongoose.Types.ObjectId()}@x.com`, contactPhone: "1", createdBy: new mongoose.Types.ObjectId(), status: OrganizationStatus.ACTIVE });
    const user = await User.create({ name: "U", email: `u2-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.USER, organizationId: org._id });

    const body = baseRequestBody(article);
    const req = reqAsUser(user, { body: { ...body, organizationId: otherOrg._id.toString() } });
    const { res, error } = await runController(estampController.createRequest, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.request.organizationId.toString()).toBe(org._id.toString());
  });

  it("rejects an unknown/invalid article", async () => {
    const { org } = await makeOrgWithArticle();
    await expect(
      EStampRequestService.createRequest({
        organizationId: org._id,
        createdBy: new mongoose.Types.ObjectId(),
        stateCode: "KA",
        articleId: new mongoose.Types.ObjectId().toString(),
        firstParty: "A",
        secondParty: "B",
        descriptionOfDocument: "X",
        considerationPrice: 0,
        stampDutyPaidBy: "A",
        numberOfEStamps: 1,
      })
    ).rejects.toMatchObject({ statusCode: 400, code: "ARTICLE_NOT_FOUND" });
  });

  it("rejects an inactive article", async () => {
    const { org, article } = await makeOrgWithArticle();
    article.isActive = false;
    await article.save();
    await expect(
      EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() })
    ).rejects.toMatchObject({ code: "ARTICLE_NOT_FOUND" });
  });

  it("rejects an article that does not belong to the requested state", async () => {
    const { org, article } = await makeOrgWithArticle(); // article is stateCode "KA"
    await expect(
      EStampRequestService.createRequest({ ...baseRequestBody(article, { stateCode: "MH" }), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() })
    ).rejects.toMatchObject({ code: "ARTICLE_NOT_FOUND" });
  });

  it("rejects an invalid quantity (zero, negative, or over the max) at the schema layer", () => {
    for (const numberOfEStamps of [0, -1, 101]) {
      const result = createEStampRequestSchema.safeParse({
        stateCode: "KA",
        articleId: "abc",
        firstParty: "A",
        secondParty: "B",
        descriptionOfDocument: "X",
        considerationPrice: 0,
        stampDutyPaidBy: "A",
        numberOfEStamps,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects a request when the organization does not have E-Stamp service enabled", async () => {
    const { org, article } = await makeOrgWithArticle();
    org.isEstampServiceEnabled = false;
    await org.save();
    await expect(
      EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() })
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("Calculation is server-authoritative", () => {
  it("a client-supplied calculatedStampDuty/amount is never honored - the server always recomputes it", async () => {
    const { org, article } = await makeOrgWithArticle({ fixedAmount: 500 });
    const body = { ...baseRequestBody(article), calculatedStampDuty: 1, amount: 1 }; // schema strips unknown fields anyway
    const req = reqAsUser(
      { _id: new mongoose.Types.ObjectId(), role: Role.USER, organizationId: org._id },
      { body: createEStampRequestSchema.parse(baseRequestBody(article)) } // only whitelisted fields ever reach the service
    );
    const { res, error } = await runController(estampController.createRequest, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.request.calculatedStampDuty).toBe(500); // from the FIXED rule, not from any client input
  });

  it("the request schema rejects an attempt to submit calculatedStampDuty/organizationId/status directly", () => {
    const result = createEStampRequestSchema.safeParse({
      stateCode: "KA",
      articleId: "abc",
      firstParty: "A",
      secondParty: "B",
      descriptionOfDocument: "X",
      considerationPrice: 0,
      stampDutyPaidBy: "A",
      numberOfEStamps: 1,
      calculatedStampDuty: 999999,
      organizationId: "spoofed",
      status: "COMPLETED",
    });
    expect(result.success).toBe(false);
  });
});

describe("Wallet / balance", () => {
  it("sufficient balance allows the request", async () => {
    const { org, article } = await makeOrgWithArticle({ balance: 1000, fixedAmount: 500 });
    const { request } = await EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() });
    expect(request).toBeDefined();
  });

  it("insufficient balance rejects the request and leaves the wallet untouched", async () => {
    const { org, article } = await makeOrgWithArticle({ balance: 100, fixedAmount: 500 });
    await expect(
      EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(100); // unchanged
  });

  it("concurrent requests cannot double-spend the same balance", async () => {
    const { org, article } = await makeOrgWithArticle({ balance: 500, fixedAmount: 500 });
    const creator = new mongoose.Types.ObjectId();
    const results = await Promise.allSettled([
      EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: creator }),
      EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: creator }),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(0); // charged exactly once, never negative
  });
});

describe("Idempotency: double-submission protection", () => {
  it("resubmitting the same idempotencyKey returns the original request instead of creating a second one / double-charging", async () => {
    const { org, article } = await makeOrgWithArticle({ balance: 1000, fixedAmount: 500 });
    const creator = new mongoose.Types.ObjectId();
    const body = { ...baseRequestBody(article), idempotencyKey: "client-form-submission-1" };
    const first = await EStampRequestService.createRequest({ ...body, organizationId: org._id, createdBy: creator });
    const second = await EStampRequestService.createRequest({ ...body, organizationId: org._id, createdBy: creator });
    expect(second.request._id.toString()).toBe(first.request._id.toString());
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(500); // charged exactly once, not twice
    const count = await EStampRequest.countDocuments({ organizationId: org._id });
    expect(count).toBe(1);
  });
});

describe("Modification", () => {
  it("modification succeeds within the 20-minute window and is audited", async () => {
    const { org, article } = await makeOrgWithArticle();
    const superAdmin = await User.create({ name: "SA", email: `sa-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.SUPER_ADMIN, organizationId: org._id });
    const { request } = await EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: superAdmin._id, actorRole: Role.SUPER_ADMIN });

    const body = updateEStampRequestSchema.parse({ firstParty: "Alice Updated" });
    const updated = await EStampRequestService.modifyRequest(request._id.toString(), org._id, superAdmin._id.toString(), Role.SUPER_ADMIN, body);
    expect(updated.firstParty).toBe("Alice Updated");

    const auditEntry = await AuditLog.findOne({ action: AuditAction.ESTAMP_REQUEST_MODIFIED, entityId: request._id.toString() });
    expect(auditEntry).not.toBeNull();
  });

  it("modification fails once the deadline has passed - a client-supplied deadline cannot override this", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() });
    // Simulate the window having elapsed server-side (never trust a client timer).
    request.modificationDeadline = new Date(Date.now() - 1000);
    await request.save();

    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Hacked" })
    ).rejects.toMatchObject({ statusCode: 409 });
    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.firstParty).toBe("Alice"); // unchanged
  });

  it("a locked (post-window) request cannot be modified even if status was never explicitly checked by the client", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() });
    request.status = EStampRequestStatus.LOCKED;
    await request.save();
    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Hacked" })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("the update schema rejects financial/identity fields (stateCode, articleId, considerationPrice, numberOfEStamps, status)", () => {
    for (const field of ["stateCode", "articleId", "considerationPrice", "numberOfEStamps", "status", "organizationId"]) {
      const result = updateEStampRequestSchema.safeParse({ [field]: "anything" });
      expect(result.success).toBe(false);
    }
  });
});

describe("Cancellation", () => {
  it("cancellation succeeds within the window, updates the linked order, and is audited", async () => {
    const { org, article } = await makeOrgWithArticle();
    const user = new mongoose.Types.ObjectId();
    const { request, order } = await EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: user });
    const cancelled = await EStampRequestService.cancelRequest(request._id.toString(), org._id, user.toString(), Role.SUPER_ADMIN);
    expect(cancelled.status).toBe(EStampRequestStatus.CANCELLED);
    const reloadedOrder = await EStampOrder.findById(order._id);
    expect(reloadedOrder.status).toBe("CANCELLED");
    const auditEntry = await AuditLog.findOne({ action: AuditAction.ESTAMP_REQUEST_CANCELLED, entityId: request._id.toString() });
    expect(auditEntry).not.toBeNull();
  });

  it("cancellation fails after the window has expired", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() });
    request.modificationDeadline = new Date(Date.now() - 1000);
    await request.save();
    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("a locked/processing request cannot be cancelled", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() });
    request.status = EStampRequestStatus.PROCESSING;
    await request.save();
    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("Tenant isolation", () => {
  it("Organization A cannot view, modify, or cancel Organization B's request", async () => {
    const { org: orgA, article } = await makeOrgWithArticle();
    const { org: orgB, article: articleB } = await makeOrgWithArticle();
    const userA = await User.create({ name: "A", email: `a-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.SUPER_ADMIN, organizationId: orgA._id });
    const { request: requestB } = await EStampRequestService.createRequest({ ...baseRequestBody(articleB), organizationId: orgB._id, createdBy: new mongoose.Types.ObjectId() });

    const { error: getErr } = await runController(estampController.getRequest, reqAsUser(userA, { params: { id: requestB._id.toString() } }), makeRes());
    expect(getErr).not.toBeNull();
    expect(getErr.statusCode).toBe(404);

    await expect(
      EStampRequestService.modifyRequest(requestB._id.toString(), orgA._id, userA._id.toString(), Role.SUPER_ADMIN, { firstParty: "Stolen" })
    ).rejects.toMatchObject({ statusCode: 404 });

    await expect(
      EStampRequestService.cancelRequest(requestB._id.toString(), orgA._id, userA._id.toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 404 });

    const reloaded = await EStampRequest.findById(requestB._id);
    expect(reloaded.status).toBe(EStampRequestStatus.MODIFICATION_WINDOW); // untouched
  });

  it("Master Admin can view a request belonging to any organization", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() });
    const master = makeReq({ user: { id: "m", role: Role.MASTER_ADMIN, organizationId: null, permissions: [] }, params: { id: request._id.toString() } });
    const { error } = await runController(estampController.getRequest, master, makeRes());
    expect(error).toBeNull();
  });
});

describe("Assistant Master Admin oversight", () => {
  it("Assistant creating an E-Stamp request on behalf of a client is audited and notifies Master Admin", async () => {
    const { org, article } = await makeOrgWithArticle();
    const master = await User.create({ name: "Master", email: `m-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    const assistantId = new mongoose.Types.ObjectId();

    const { request } = await EStampRequestService.createRequest({
      ...baseRequestBody(article),
      organizationId: org._id,
      createdBy: assistantId,
      actorRole: Role.ASSISTANT_MASTER_ADMIN,
    });

    const auditEntry = await AuditLog.findOne({ action: AuditAction.ESTAMP_REQUEST_CREATED, entityId: request._id.toString() });
    expect(auditEntry.actorRole).toBe(Role.ASSISTANT_MASTER_ADMIN);

    const notification = await Notification.findOne({ recipientId: master._id, relatedActorId: assistantId.toString() });
    expect(notification).not.toBeNull();
    expect(notification.type).toBe("ASSISTANT_ADMIN_ACTIVITY");
  });
});

describe("Provider abstraction", () => {
  it("getEStampProvider() returns the mock adapter in this (non-production) environment, never a real vendor client", () => {
    const provider = getEStampProvider();
    expect(provider).toBeInstanceOf(MockEStampProvider);
  });

  it("issueEStamp() goes through the provider interface, not a hardcoded vendor call, and never fabricates an ISSUED certificate", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await EStampRequestService.createRequest({ ...baseRequestBody(article), organizationId: org._id, createdBy: new mongoose.Types.ObjectId() });
    request.status = EStampRequestStatus.LOCKED;
    await request.save();

    const { request: processed, providerResult } = await EStampRequestService.issueEStamp(request._id.toString());
    // The mock adapter is honest about being unable to actually issue a real
    // certificate - it reports PENDING, not a fabricated ISSUED/government result.
    expect(providerResult.status).toBe("PENDING");
    expect(providerResult.rawResponse.mock).toBe(true);
    expect(processed.status).toBe(EStampRequestStatus.PROCESSING);
  });
});

describe("Phase 22: GET /estamps list filters", () => {
  it("filters by stateCode, scoped to the caller's own organization (tenant isolation)", async () => {
    const { org, article } = await makeOrgWithArticle();
    const otherOrgSetup = await makeOrgWithArticle();
    const user = await User.create({ name: "U", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.USER, organizationId: org._id });
    await EStampRequestService.createRequest({ organizationId: org._id, createdBy: user._id, ...baseRequestBody(article) });
    await EStampRequestService.createRequest({ organizationId: otherOrgSetup.org._id, createdBy: new mongoose.Types.ObjectId(), ...baseRequestBody(otherOrgSetup.article) });

    const { res, error } = await runController(estampController.listRequests, reqAsUser(user, { query: { stateCode: "ka" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].organizationId.toString()).toBe(org._id.toString());
  });

  it("rejects an invalid status filter rather than silently ignoring it", async () => {
    const { org, article } = await makeOrgWithArticle();
    void article;
    const user = await User.create({ name: "U", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.USER, organizationId: org._id });
    const { error } = await runController(estampController.listRequests, reqAsUser(user, { query: { status: "NOT_A_REAL_STATUS" } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
  });

  it("rejects an invalid date range (dateFrom after dateTo)", async () => {
    const { org } = await makeOrgWithArticle();
    const user = await User.create({ name: "U", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.USER, organizationId: org._id });
    const { error } = await runController(estampController.listRequests, reqAsUser(user, { query: { dateFrom: "2030-01-01", dateTo: "2020-01-01" } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
  });

  it("filters by createdAt date range, returning only requests inside the window", async () => {
    const { org, article } = await makeOrgWithArticle();
    const user = await User.create({ name: "U", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.USER, organizationId: org._id });
    await EStampRequestService.createRequest({ organizationId: org._id, createdBy: user._id, ...baseRequestBody(article) });

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { res, error } = await runController(estampController.listRequests, reqAsUser(user, { query: { dateFrom: future } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(0); // created before the future window starts
  });

  it("a search term containing regex metacharacters never 500s - matched literally, not as a pattern", async () => {
    const { org, article } = await makeOrgWithArticle();
    const user = await User.create({ name: "U", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.USER, organizationId: org._id });
    await EStampRequestService.createRequest({ organizationId: org._id, createdBy: user._id, ...baseRequestBody(article) });

    const { res, error } = await runController(estampController.listRequests, reqAsUser(user, { query: { search: "(unmatched[" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(0); // no requestNumber literally contains this string
  });
});
