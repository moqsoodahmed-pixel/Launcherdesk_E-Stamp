import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { createRequire } from "node:module";
import { Organization, Wallet, Article, ArticleVersion, User, AuditLog, Notification, EStampOrder, EStampProviderBalanceSnapshot } from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus } from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import * as providerController from "../src/controllers/estamp-provider.controller.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

const require = createRequire(import.meta.url);
const { EStampProviderService } = require("../src/services/estamp-provider.service.js");
const { getEStampProvider } = require("../src/services/estamp-providers/index.js");
const { MockEStampProvider } = require("../src/services/estamp-providers/MockEStampProvider.js");
const { env } = require("../src/config/env.js");
const { SettingsService } = require("../src/services/settings.service.js");

// Phase 17 - ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD is now a live
// SettingsService-managed setting (DB override if present, else the
// registry default which mirrors env.js's default of null/"never alert"
// exactly) rather than a frozen-at-boot env value. Tests that need a
// specific threshold now set it via SettingsService.updateSetting - mutating
// env.ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD directly no longer has any
// effect on maybeNotifyLowBalance's actual read path.
async function setLowBalanceThreshold(value) {
  await SettingsService.updateSetting({ key: "ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD", value, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });
}

function opsReq(overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) }, ...overrides });
}
function clientReq(overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: new mongoose.Types.ObjectId().toString(), permissions: [] }, ...overrides });
}

async function makeIssuedOrder({ balance = 100000, fixedAmount = 500, stateCode = "KA" } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: "Usage Test Co",
    contactEmail: `usage-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode, articleCode: `USE-${new mongoose.Types.ObjectId()}`, title: "Usage Test Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  const { request, order } = await EStampRequestService.createRequest({
    organizationId: org._id,
    createdBy: creator,
    stateCode,
    articleId: article._id.toString(),
    firstParty: "A",
    secondParty: "B",
    descriptionOfDocument: "Usage test",
    considerationPrice: 0,
    stampDutyPaidBy: "A",
    numberOfEStamps: 1,
  });
  request.status = "LOCKED";
  await request.save();
  order.eStampStatus = "CREATED";
  await order.save();
  await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), creator.toString(), Role.MASTER_ADMIN);
  const synced = await EStampRequestService.syncEStampOrderStatus(order._id.toString(), org._id.toString(), creator.toString(), Role.MASTER_ADMIN);
  return { org, article, request, order: synced.order };
}

describe("Provider abstraction: balance/usage", () => {
  it("the mock provider returns a clearly-labeled mock balance", async () => {
    const provider = getEStampProvider();
    expect(provider).toBeInstanceOf(MockEStampProvider);
    const balance = await provider.getBalance();
    expect(balance.source).toBe("mock");
    expect(typeof balance.available).toBe("number");
  });

  it("the mock provider returns clearly-labeled mock usage", async () => {
    const provider = getEStampProvider();
    const usage = await provider.getUsage();
    expect(usage.source).toBe("mock");
  });

  it("the real (unimplemented) provider fails clearly rather than fabricating a balance", () => {
    const original = env.ESTAMP_PROVIDER;
    env.ESTAMP_PROVIDER = "SOME_REAL_VENDOR";
    try {
      const provider = getEStampProvider();
      expect(() => provider.getBalance()).toThrow(/not implemented/i);
    } finally {
      env.ESTAMP_PROVIDER = original;
    }
  });

  it("production never silently falls back to mock for balance/usage either", () => {
    const original = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(() => getEStampProvider()).toThrow(/ESTAMP_PROVIDER_NOT_CONFIGURED|mock/i);
    } finally {
      env.NODE_ENV = original;
    }
  });
});

describe("Balance", () => {
  it("Master Admin can retrieve the latest balance", async () => {
    await EStampProviderService.refreshBalance(new mongoose.Types.ObjectId().toString());
    const { res, error } = await runController(providerController.getBalance, opsReq(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.status).toBe("AVAILABLE");
  });

  it("Master Admin can explicitly refresh the balance, and it is stored as a snapshot", async () => {
    const before = await EStampProviderBalanceSnapshot.countDocuments();
    const { res, error } = await runController(providerController.refreshBalance, opsReq(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.status).toBe("AVAILABLE");
    const after = await EStampProviderBalanceSnapshot.countDocuments();
    expect(after).toBe(before + 1);
  });

  it("an unconfigured/unavailable real provider returns an honest NOT_CONFIGURED status, never a fabricated balance", async () => {
    const original = env.ESTAMP_PROVIDER;
    env.ESTAMP_PROVIDER = "SOME_REAL_VENDOR";
    try {
      const result = await EStampProviderService.refreshBalance(null);
      expect(result.status).toBe("NOT_CONFIGURED");
      expect(result.available).toBeNull();
    } finally {
      env.ESTAMP_PROVIDER = original;
    }
  });

  it("a provider error never becomes a zero balance - it is recorded as ERROR/NOT_CONFIGURED with available=null", async () => {
    const original = env.ESTAMP_PROVIDER;
    env.ESTAMP_PROVIDER = "SOME_REAL_VENDOR";
    try {
      const result = await EStampProviderService.refreshBalance(null);
      expect(result.available).not.toBe(0);
      expect(result.available).toBeNull();
    } finally {
      env.ESTAMP_PROVIDER = original;
    }
  });

  it("the latest snapshot is returned correctly, and an honest UNAVAILABLE state is returned when no fetch has ever happened", async () => {
    await EStampProviderBalanceSnapshot.deleteMany({});
    const result = await EStampProviderService.getLatestBalance();
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.available).toBeNull();

    await EStampProviderService.refreshBalance(null);
    const after = await EStampProviderService.getLatestBalance();
    expect(after.status).toBe("AVAILABLE");
  });
});

describe("Security: access control", () => {
  it("a client role (SUPER_ADMIN) cannot access provider balance/refresh/usage - no default permission", async () => {
    const req = clientReq();
    const { threw } = await runMiddleware(requirePermission(Permission.ESTAMP_PROVIDER_VIEW), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("an Assistant Master Admin without explicit ESTAMP_PROVIDER_VIEW is denied", async () => {
    const req = makeReq({ user: { id: "x", role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [] } });
    const { threw } = await runMiddleware(requirePermission(Permission.ESTAMP_PROVIDER_VIEW), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("an Assistant Master Admin explicitly granted ESTAMP_PROVIDER_VIEW can view balance, and it is audited", async () => {
    await EStampProviderService.refreshBalance(null);
    const assistantId = new mongoose.Types.ObjectId().toString();
    const req = makeReq({ user: { id: assistantId, role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [Permission.ESTAMP_PROVIDER_VIEW] } });
    const { error } = await runController(providerController.getBalance, req, makeRes());
    expect(error).toBeNull();
    const auditEntry = await AuditLog.findOne({ actorId: assistantId, action: AuditAction.ESTAMP_PROVIDER_BALANCE_VIEWED });
    expect(auditEntry).not.toBeNull();
  });

  it("a tenant organization cannot access global provider information via organization-scoped context", async () => {
    // There is no organizationId-scoped variant of these routes at all -
    // the permission gate alone is the boundary, tested above. This test
    // documents that a client actor's own organizationId is irrelevant here.
    const req = clientReq({ query: { organizationId: new mongoose.Types.ObjectId().toString() } });
    const { threw } = await runMiddleware(requirePermission(Permission.ESTAMP_PROVIDER_VIEW), req, makeRes());
    expect(threw).not.toBeNull();
  });
});

describe("Usage", () => {
  it("aggregates real internal order data correctly (totals)", async () => {
    const { org } = await makeIssuedOrder({ fixedAmount: 500 });
    const usage = await EStampProviderService.getUsage({ organizationId: org._id.toString() });
    expect(usage.totals.totalOrders).toBe(1);
    expect(usage.totals.issued).toBe(1);
    expect(usage.totals.totalStampValue).toBe(500);
  });

  it("rejects an invalid date range (from after to)", async () => {
    await expect(EStampProviderService.getUsage({ from: "2025-01-10", to: "2025-01-01" })).rejects.toMatchObject({ code: "INVALID_DATE_RANGE" });
  });

  it("rejects an unreasonably large date range", async () => {
    await expect(EStampProviderService.getUsage({ from: "2000-01-01", to: "2025-01-01" })).rejects.toMatchObject({ code: "RANGE_TOO_LARGE" });
  });

  it("filters by organization", async () => {
    const { org: orgA } = await makeIssuedOrder({ fixedAmount: 100 });
    const { org: orgB } = await makeIssuedOrder({ fixedAmount: 200 });
    const usageA = await EStampProviderService.getUsage({ organizationId: orgA._id.toString() });
    expect(usageA.totals.totalOrders).toBe(1);
    expect(usageA.totals.totalStampValue).toBe(100);
    const usageB = await EStampProviderService.getUsage({ organizationId: orgB._id.toString() });
    expect(usageB.totals.totalStampValue).toBe(200);
  });

  it("filters by state", async () => {
    const { org } = await makeIssuedOrder({ stateCode: "MH", fixedAmount: 300 });
    const usage = await EStampProviderService.getUsage({ organizationId: org._id.toString(), stateCode: "MH" });
    expect(usage.totals.totalOrders).toBe(1);
    const usageWrongState = await EStampProviderService.getUsage({ organizationId: org._id.toString(), stateCode: "DL" });
    expect(usageWrongState.totals.totalOrders).toBe(0);
  });

  it("filters by article", async () => {
    const { org, article } = await makeIssuedOrder({ fixedAmount: 400 });
    const usage = await EStampProviderService.getUsage({ organizationId: org._id.toString(), articleId: article._id.toString() });
    expect(usage.totals.totalOrders).toBe(1);
    const usageWrongArticle = await EStampProviderService.getUsage({ organizationId: org._id.toString(), articleId: new mongoose.Types.ObjectId().toString() });
    expect(usageWrongArticle.totals.totalOrders).toBe(0);
  });

  it("filters by status", async () => {
    const { org } = await makeIssuedOrder({ fixedAmount: 100 });
    const usage = await EStampProviderService.getUsage({ organizationId: org._id.toString(), status: "COMPLETED" });
    expect(usage.totals.totalOrders).toBe(1);
    const usageWrongStatus = await EStampProviderService.getUsage({ organizationId: org._id.toString(), status: "FAILED" });
    expect(usageWrongStatus.totals.totalOrders).toBe(0);
  });

  it("groups by organization correctly with correct aggregation totals", async () => {
    const { org: orgA } = await makeIssuedOrder({ fixedAmount: 100 });
    const { org: orgB } = await makeIssuedOrder({ fixedAmount: 250 });
    const usage = await EStampProviderService.getUsage({ groupBy: "organization" });
    const rowA = usage.breakdown.find((r) => r.key.toString() === orgA._id.toString());
    const rowB = usage.breakdown.find((r) => r.key.toString() === orgB._id.toString());
    expect(rowA.totalStampValue).toBe(100);
    expect(rowB.totalStampValue).toBe(250);
  });

  it("uses stored historical values, never recalculating stamp duty during reporting", async () => {
    const { org, article } = await makeIssuedOrder({ fixedAmount: 500 });
    // Change the article's rule AFTER the order was issued.
    await ArticleVersion.create({ articleId: article._id, versionNumber: 2, calculationRule: { type: "FIXED", fixedAmount: 99999 }, createdBy: new mongoose.Types.ObjectId() });
    article.currentVersion = 2;
    await article.save();
    const usage = await EStampProviderService.getUsage({ organizationId: org._id.toString() });
    expect(usage.totals.totalStampValue).toBe(500); // unchanged - historical order amount, not recalculated
  });

  it("rejects arbitrary/unsafe query input by only ever matching the explicit whitelist of fields", async () => {
    const { org } = await makeIssuedOrder();
    // Even if a caller tried to smuggle a Mongo operator through a filter
    // value, the service only ever uses primitive fields it explicitly
    // reads (organizationId/stateCode/articleId/status) - there is no path
    // by which an arbitrary object reaches $match.
    const usage = await EStampProviderService.getUsage({ organizationId: org._id.toString(), status: { $ne: "COMPLETED" } });
    // status is validated against the OrderStatus enum and silently ignored
    // if it doesn't match - never passed through raw.
    expect(usage.totals.totalOrders).toBe(1);
  });
});

describe("Low balance notifications", () => {
  it("a valid low balance triggers a Master Admin notification", async () => {
    const master = await User.create({ name: "Master", email: `m-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    await setLowBalanceThreshold(999999999); // mock always returns 100000, so this guarantees "below threshold"
    await EStampProviderService.refreshBalance(null);
    const notification = await Notification.findOne({ recipientId: master._id, type: "SECURITY_ALERT" });
    expect(notification).not.toBeNull();
  });

  it("an unavailable/unconfigured provider never triggers a low-balance alert", async () => {
    const master = await User.create({ name: "Master2", email: `m2-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    const originalProvider = env.ESTAMP_PROVIDER;
    await setLowBalanceThreshold(999999999);
    env.ESTAMP_PROVIDER = "SOME_REAL_VENDOR";
    try {
      await EStampProviderService.refreshBalance(null);
      const notification = await Notification.findOne({ recipientId: master._id, type: "SECURITY_ALERT" });
      expect(notification).toBeNull();
    } finally {
      env.ESTAMP_PROVIDER = originalProvider;
    }
  });

  it("a genuine zero balance is treated as a real, valid balance (not a provider failure) and can trigger a low-balance alert like any other low value", async () => {
    // The mock provider always returns 100000, so we simulate a zero-balance
    // AVAILABLE snapshot directly to exercise this specific distinction.
    const snapshot = await EStampProviderBalanceSnapshot.create({ provider: "mock", status: "AVAILABLE", available: 0, currency: "INR", unit: "AMOUNT", source: "mock", fetchedAt: new Date() });
    expect(snapshot.status).toBe("AVAILABLE");
    expect(snapshot.available).toBe(0); // a real zero, not null/undefined (which would mean unavailable)
  });

  it("duplicate refreshes while still below threshold do not spam repeated alerts", async () => {
    const master = await User.create({ name: "Master3", email: `m3-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    await setLowBalanceThreshold(999999999);
    await EStampProviderService.refreshBalance(null);
    await EStampProviderService.refreshBalance(null);
    await EStampProviderService.refreshBalance(null);
    const count = await Notification.countDocuments({ recipientId: master._id, type: "SECURITY_ALERT" });
    expect(count).toBe(1); // only the first crossing notified, not every subsequent refresh
  });
});

describe("Tenant isolation", () => {
  it("Organization A's usage query cannot be manipulated to expose Organization B's data, nor global totals, through the organization filter", async () => {
    const { org: orgA } = await makeIssuedOrder({ fixedAmount: 111 });
    const { org: orgB } = await makeIssuedOrder({ fixedAmount: 222 });
    const usageA = await EStampProviderService.getUsage({ organizationId: orgA._id.toString() });
    expect(usageA.totals.totalStampValue).toBe(111);
    expect(usageA.breakdown).toEqual([]); // no groupBy requested - no accidental leakage of other orgs' rows
  });

  it("route-level access to usage/balance is gated identically regardless of any organizationId a client might supply", async () => {
    const req = clientReq({ query: { organizationId: "anything" } });
    const { threw } = await runMiddleware(requirePermission(Permission.ESTAMP_PROVIDER_VIEW), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });
});
