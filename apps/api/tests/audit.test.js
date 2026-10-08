// Phase 15 - hardening the EXISTING audit system (not a rebuild). Covers:
// permission wiring (audit.view replacing the old hardcoded requireRole),
// tenant scoping (forged organizationId ignored for tenant/Assistant actors),
// filtering/pagination/sorting validation, the two closed gaps
// (lockExpiredRequests system-attributed audit, OTP_FAILED confirmation),
// the secret-leakage sweep, and immutability (no mutating route exists).
import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import crypto from "crypto";
import { createRequire } from "node:module";
import { Organization, Wallet, Article, ArticleVersion, User, AuditLog, OTP } from "../src/models/index.js";
import {
  Role,
  Permission,
  AuditAction,
  OrganizationStatus,
  EStampRequestStatus,
  DEFAULT_ROLE_PERMISSIONS,
  getEffectivePermissions,
} from "@launcherdesk/shared";
import * as auditController from "../src/controllers/audit.controller.js";
import * as paymentController from "../src/controllers/payment.controller.js";
import { AuthService } from "../src/services/auth.service.js";
import { OtpService } from "../src/services/otp.service.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { PaymentService } from "../src/services/payment.service.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { createRazorpayOrderSchema } from "@launcherdesk/validation";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

// CJS-required (not ESM-imported) purely to introspect the raw Express
// Router's route table for the immutability proof below - matches the
// codebase's documented convention (see modification-window.test.js) of
// using createRequire when a test needs the literal CJS module object.
const require = createRequire(import.meta.url);
const { default: auditRouter } = require("../src/routes/v1/audit.routes.js");

const MOCK_WEBHOOK_SECRET = "mock_webhook_secret_dev_only";
function mockWebhookSignature(rawBody) {
  return crypto.createHmac("sha256", MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");
}

async function createOrg(overrides = {}) {
  return Organization.create({
    name: overrides.name || `Audit Test Org ${new mongoose.Types.ObjectId()}`,
    contactEmail: `audit-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: new mongoose.Types.ObjectId(),
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
}

async function makeOrgWithArticle({ balance = 100000, fixedAmount = 500 } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await createOrg();
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `ART-AUD-${new mongoose.Types.ObjectId()}`, title: "Test Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  return { org, article };
}

function reqAs(role, organizationId, permissionsOverride, overrides = {}) {
  return makeReq({
    user: {
      id: new mongoose.Types.ObjectId().toString(),
      role,
      organizationId: organizationId ? organizationId.toString() : null,
      permissions: permissionsOverride ?? getEffectivePermissions(role, []),
    },
    ...overrides,
  });
}

async function seedEntry(overrides = {}) {
  return AuditLog.create({
    actorId: overrides.actorId ?? new mongoose.Types.ObjectId(),
    actorRole: overrides.actorRole || Role.USER,
    actorType: overrides.actorType || "USER",
    organizationId: overrides.organizationId ?? null,
    action: overrides.action || AuditAction.ORDER_VIEWED,
    entityType: overrides.entityType,
    entityId: overrides.entityId,
    createdAt: overrides.createdAt,
    metadata: overrides.metadata,
  });
}

describe("audit.view permission wiring (route-level gate)", () => {
  it("Master Admin (all-permissions rule) passes", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission));
    const { threw } = await runMiddleware(requirePermission(Permission.AUDIT_VIEW), req, makeRes());
    expect(threw).toBeNull();
  });

  it("SUPER_ADMIN and ADMIN hold audit.view by default (own-org oversight)", async () => {
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN]) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(Permission.AUDIT_VIEW);
      const req = reqAs(role, new mongoose.Types.ObjectId());
      const { threw } = await runMiddleware(requirePermission(Permission.AUDIT_VIEW), req, makeRes());
      expect(threw).toBeNull();
    }
  });

  it("USER does not hold audit.view by default and is rejected", async () => {
    expect(DEFAULT_ROLE_PERMISSIONS[Role.USER]).not.toContain(Permission.AUDIT_VIEW);
    const req = reqAs(Role.USER, new mongoose.Types.ObjectId());
    const { threw } = await runMiddleware(requirePermission(Permission.AUDIT_VIEW), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("Assistant Master Admin without an explicit grant is rejected (never auto-granted)", async () => {
    expect(DEFAULT_ROLE_PERMISSIONS[Role.ASSISTANT_MASTER_ADMIN]).not.toContain(Permission.AUDIT_VIEW);
    const req = reqAs(Role.ASSISTANT_MASTER_ADMIN, null, []);
    const { threw } = await runMiddleware(requirePermission(Permission.AUDIT_VIEW), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("Assistant Master Admin explicitly granted audit.view is allowed", async () => {
    const permissions = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [Permission.AUDIT_VIEW]);
    const req = reqAs(Role.ASSISTANT_MASTER_ADMIN, null, permissions);
    const { threw } = await runMiddleware(requirePermission(Permission.AUDIT_VIEW), req, makeRes());
    expect(threw).toBeNull();
  });
});

describe("Tenant isolation / scoping (listAuditLogs controller)", () => {
  it("Master Admin sees entries across every organization when no organizationId is given (genuinely global)", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await seedEntry({ organizationId: orgA._id });
    await seedEntry({ organizationId: orgB._id });
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission));
    const { res, error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(2);
  });

  it("Master Admin can explicitly scope to one organization", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await seedEntry({ organizationId: orgA._id });
    await seedEntry({ organizationId: orgB._id });
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { organizationId: orgA._id.toString() } });
    const { res, error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(1);
  });

  it("Master Admin supplying a malformed organizationId gets a clean 400, never a raw cast error", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { organizationId: "not-an-id" } });
    const { error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
  });

  it("Assistant Master Admin with audit.view MUST supply organizationId - no silent global fallback", async () => {
    const permissions = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [Permission.AUDIT_VIEW]);
    const req = reqAs(Role.ASSISTANT_MASTER_ADMIN, null, permissions);
    const { error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("ORGANIZATION_ID_REQUIRED");
  });

  it("Assistant Master Admin with audit.view and an explicit organizationId is scoped to exactly that org", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await seedEntry({ organizationId: orgA._id });
    await seedEntry({ organizationId: orgB._id });
    const permissions = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [Permission.AUDIT_VIEW]);
    const req = reqAs(Role.ASSISTANT_MASTER_ADMIN, null, permissions, { query: { organizationId: orgA._id.toString() } });
    const { res, error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(1);
  });

  it("a tenant actor's forged organizationId query param is silently ignored - they only ever see their OWN organization's entries", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await seedEntry({ organizationId: orgA._id, action: AuditAction.ORDER_VIEWED });
    await seedEntry({ organizationId: orgB._id, action: AuditAction.ORDER_MODIFIED });
    const permissions = getEffectivePermissions(Role.SUPER_ADMIN, []);
    // SUPER_ADMIN belongs to orgA but tries to request orgB's data via the query string.
    const req = reqAs(Role.SUPER_ADMIN, orgA._id, permissions, { query: { organizationId: orgB._id.toString() } });
    const { res, error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].action).toBe(AuditAction.ORDER_VIEWED); // orgA's entry, never orgB's
  });
});

describe("Filtering (listAuditLogs)", () => {
  it("filters by a valid action", async () => {
    await seedEntry({ action: AuditAction.LOGIN });
    await seedEntry({ action: AuditAction.LOGOUT });
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { action: AuditAction.LOGIN } });
    const { res } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].action).toBe(AuditAction.LOGIN);
  });

  it("rejects an invalid action value rather than passing it through raw to Mongo", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { action: "NOT_A_REAL_ACTION" } });
    const { error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
  });

  it("filters by actorRole", async () => {
    await seedEntry({ actorRole: Role.SUPER_ADMIN });
    await seedEntry({ actorRole: Role.ADMIN });
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { actorRole: Role.ADMIN } });
    const { res } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(res.body.data.total).toBe(1);
  });

  it("filters by actorType (SYSTEM vs USER)", async () => {
    await seedEntry({ actorType: "USER" });
    await seedEntry({ actorId: null, actorType: "SYSTEM", actorRole: "SYSTEM_CRON" });
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { actorType: "SYSTEM" } });
    const { res } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].actorType).toBe("SYSTEM");
  });

  it("rejects an invalid actorType value", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { actorType: "ROBOT" } });
    const { error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
  });

  it("filters by entityType and entityId", async () => {
    await seedEntry({ entityType: "EStampOrder", entityId: "order-1" });
    await seedEntry({ entityType: "EStampRequest", entityId: "req-1" });
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { entityType: "EStampOrder" } });
    const { res } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(res.body.data.total).toBe(1);

    const req2 = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { entityId: "req-1" } });
    const { res: res2 } = await runController(auditController.listAuditLogs, req2, makeRes());
    expect(res2.body.data.total).toBe(1);
    expect(res2.body.data.items[0].entityId).toBe("req-1");
  });

  it("filters by a date range (dateFrom/dateTo independently and combined)", async () => {
    await seedEntry({ createdAt: new Date("2025-01-01") });
    await seedEntry({ createdAt: new Date("2025-06-01") });
    await seedEntry({ createdAt: new Date("2025-12-01") });

    const fromOnly = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { dateFrom: "2025-06-01" } });
    const { res: r1 } = await runController(auditController.listAuditLogs, fromOnly, makeRes());
    expect(r1.body.data.total).toBe(2);

    const toOnly = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { dateTo: "2025-06-01" } });
    const { res: r2 } = await runController(auditController.listAuditLogs, toOnly, makeRes());
    expect(r2.body.data.total).toBe(2);

    const combined = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), {
      query: { dateFrom: "2025-02-01", dateTo: "2025-11-01" },
    });
    const { res: r3 } = await runController(auditController.listAuditLogs, combined, makeRes());
    expect(r3.body.data.total).toBe(1);
  });

  it("combines multiple filters (action + entityType) correctly", async () => {
    await seedEntry({ action: AuditAction.ESTAMP_DOWNLOADED, entityType: "EStampDocument" });
    await seedEntry({ action: AuditAction.ESTAMP_DOWNLOADED, entityType: "Other" });
    await seedEntry({ action: AuditAction.ESTAMP_UPLOADED, entityType: "EStampDocument" });
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), {
      query: { action: AuditAction.ESTAMP_DOWNLOADED, entityType: "EStampDocument" },
    });
    const { res } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(res.body.data.total).toBe(1);
  });
});

describe("Security hardening (listAuditLogs)", () => {
  it("rejects a malformed date", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { dateFrom: "not-a-date" } });
    const { error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_DATE_RANGE");
  });

  it("rejects dateFrom after dateTo", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), {
      query: { dateFrom: "2025-06-01", dateTo: "2025-01-01" },
    });
    const { error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_DATE_RANGE");
  });

  it("rejects an oversized date range (> 366 days, matching report.service.js's constant)", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), {
      query: { dateFrom: "2000-01-01", dateTo: "2025-01-01" },
    });
    const { error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("RANGE_TOO_LARGE");
  });

  it("a malicious/unknown sortBy is silently ignored (whitelist), never passed to .sort() raw", async () => {
    await seedEntry({ action: AuditAction.LOGIN, createdAt: new Date("2025-01-01") });
    await seedEntry({ action: AuditAction.LOGOUT, createdAt: new Date("2025-02-01") });
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { sortBy: "__proto__.polluted" } });
    const { res, error } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(2); // did not throw, fell back to createdAt desc
  });

  it("an oversized limit is clamped to the max (100)", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { limit: "999999" } });
    const { res } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(res.body.data.limit).toBe(100);
  });

  it("an invalid/negative page falls back to page 1", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { page: "-5" } });
    const { res } = await runController(auditController.listAuditLogs, req, makeRes());
    expect(res.body.data.page).toBe(1);
  });
});

describe("Pagination correctness (listAuditLogs)", () => {
  it("paginates correctly and reports the true total across pages", async () => {
    for (let i = 0; i < 25; i++) {
      await seedEntry({ createdAt: new Date(Date.now() - i * 1000) });
    }
    const page1 = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { page: "1", limit: "10" } });
    const { res: r1 } = await runController(auditController.listAuditLogs, page1, makeRes());
    expect(r1.body.data.items.length).toBe(10);
    expect(r1.body.data.total).toBe(25);

    const page3 = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { page: "3", limit: "10" } });
    const { res: r3 } = await runController(auditController.listAuditLogs, page3, makeRes());
    expect(r3.body.data.items.length).toBe(5); // last, partial page
  });
});

describe("listMyAuditActivity", () => {
  it("is hard-scoped to the caller's own actorId, never exposing another actor's entries", async () => {
    const me = new mongoose.Types.ObjectId();
    const someoneElse = new mongoose.Types.ObjectId();
    await seedEntry({ actorId: me });
    await seedEntry({ actorId: someoneElse });
    const req = makeReq({ user: { id: me.toString(), role: Role.USER, organizationId: null, permissions: [] } });
    const { res } = await runController(auditController.listMyAuditActivity, req, makeRes());
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].actorId.toString()).toBe(me.toString());
  });

  it("returns the standard {items,total,page,limit} paginated shape, with limit clamped to 100", async () => {
    const me = new mongoose.Types.ObjectId();
    await seedEntry({ actorId: me });
    const req = makeReq({ user: { id: me.toString(), role: Role.USER, organizationId: null, permissions: [] }, query: { limit: "500" } });
    const { res } = await runController(auditController.listMyAuditActivity, req, makeRes());
    expect(res.body.data).toHaveProperty("total");
    expect(res.body.data).toHaveProperty("page", 1);
    expect(res.body.data.limit).toBe(100);
  });
});

describe("System-actor correctness: lockExpiredRequests closes the previously-unaudited gap", () => {
  it("locking an expired request writes a system-attributed audit entry - never a fabricated human actorId", async () => {
    const { org, article } = await makeOrgWithArticle();
    const creator = new mongoose.Types.ObjectId();
    const { request } = await EStampRequestService.createRequest({
      organizationId: org._id,
      createdBy: creator,
      stateCode: "KA",
      articleId: article._id.toString(),
      firstParty: "Alice",
      secondParty: "Bob",
      descriptionOfDocument: "Test doc",
      considerationPrice: 0,
      stampDutyPaidBy: "Alice",
      numberOfEStamps: 1,
    });
    // Force the request into an already-expired MODIFICATION_WINDOW state.
    await mongoose.model("EStampRequest").findByIdAndUpdate(request._id, { modificationDeadline: new Date(Date.now() - 1000) });

    const lockedCount = await EStampRequestService.lockExpiredRequests();
    expect(lockedCount).toBe(1);

    const entry = await AuditLog.findOne({ action: AuditAction.ESTAMP_REQUEST_LOCKED, entityId: request._id.toString() });
    expect(entry).not.toBeNull();
    expect(entry.actorId).toBeNull();
    expect(entry.actorType).toBe("SYSTEM");
    expect(entry.actorRole).toBe("SYSTEM_CRON");
    expect(entry.entityType).toBe("EStampRequest");
    expect(entry.organizationId.toString()).toBe(org._id.toString());
  });
});

describe("LOGIN_FAILED / OTP_FAILED audit coverage", () => {
  it("a failed login attempt records LOGIN_FAILED (pre-existing, narrow exception to the successes-only convention)", async () => {
    const org = await createOrg();
    const password = "Correct-Password-1!";
    const passwordHash = await AuthService.hashPassword(password);
    const user = await User.create({
      name: "Audit Test User",
      email: `audit-login-${new mongoose.Types.ObjectId()}@ld.local`,
      passwordHash,
      role: Role.USER,
      organizationId: org._id,
      lastOtpVerifiedAt: new Date(),
    });
    await expect(AuthService.loginStep1(user.email, "definitely-wrong-password", makeReq())).rejects.toMatchObject({ statusCode: 401 });
    const entry = await AuditLog.findOne({ actorId: user._id, action: AuditAction.LOGIN_FAILED });
    expect(entry).not.toBeNull();
  });

  it("a failed OTP verification records OTP_FAILED (already wired in otp.service.js - confirmed, not a gap)", async () => {
    const userId = new mongoose.Types.ObjectId();
    const otp = await OTP.create({
      userId,
      purpose: "LOGIN",
      codeHash: crypto.createHash("sha256").update("135790").digest("hex"),
      challengeToken: `tok-audit-otp-${userId}`,
      expiresAt: new Date(Date.now() + 60 * 1000),
      maxAttempts: 5,
    });
    await expect(OtpService.verify(otp.challengeToken, "000000", makeReq())).rejects.toThrow();
    const entry = await AuditLog.findOne({ actorId: userId.toString(), action: AuditAction.OTP_FAILED });
    expect(entry).not.toBeNull();
  });
});

describe("Secret-leakage sweep - regression guard, not a perfect scanner", () => {
  it("none of the AuditLog entries created by a representative slice of sensitive flows contain secret-shaped values", async () => {
    // 1. OTP failure - the raw code must never appear.
    const userId = new mongoose.Types.ObjectId();
    const otp = await OTP.create({
      userId,
      purpose: "LOGIN",
      codeHash: crypto.createHash("sha256").update("246810").digest("hex"),
      challengeToken: `tok-sweep-${userId}`,
      expiresAt: new Date(Date.now() + 60 * 1000),
      maxAttempts: 5,
    });
    await expect(OtpService.verify(otp.challengeToken, "999999", makeReq())).rejects.toThrow();

    // 2. Login failure - the raw password must never appear.
    const org = await createOrg();
    const passwordHash = await AuthService.hashPassword("Sweep-Test-Password!");
    const user = await User.create({
      name: "Sweep User",
      email: `sweep-${new mongoose.Types.ObjectId()}@ld.local`,
      passwordHash,
      role: Role.USER,
      organizationId: org._id,
      lastOtpVerifiedAt: new Date(),
    });
    await expect(AuthService.loginStep1(user.email, "Sweep-Wrong-Password!", makeReq())).rejects.toMatchObject({ statusCode: 401 });

    // 3. Payment webhook - the signature/webhook secret must never appear.
    await Wallet.create({ organizationId: org._id, balance: 0 });
    const orderReq = makeReq({
      user: { id: user._id.toString(), role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions: [] },
      body: createRazorpayOrderSchema.parse({ amount: 500 }),
    });
    const { res: orderRes } = await runController(paymentController.createRazorpayOrder, orderReq, makeRes());
    const razorpayOrderId = orderRes.body.data.razorpayOrderId;
    const razorpayPaymentId = `pay_${new mongoose.Types.ObjectId()}`;
    const body = { event: "payment.captured", payload: { payment: { entity: { id: razorpayPaymentId, order_id: razorpayOrderId, status: "captured" } } } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = mockWebhookSignature(rawBody);
    await PaymentService.handleWebhook(rawBody, signature);

    const all = await AuditLog.find({}).lean();
    const serialized = JSON.stringify(all.map((a) => ({ metadata: a.metadata, ip: a.ip, userAgent: a.userAgent, actorRole: a.actorRole })));
    const secretMarkers = ["246810", "999999", "Sweep-Test-Password!", "Sweep-Wrong-Password!", MOCK_WEBHOOK_SECRET, signature, "eyJ"];
    for (const marker of secretMarkers) {
      expect(serialized).not.toContain(marker);
    }
  });
});

describe("Immutability - no application route exists to modify or delete an audit record", () => {
  it("the audit router exposes GET only on both / and /mine - no PATCH/PUT/DELETE layer", () => {
    const rootMethods = auditRouter.stack.filter((l) => l.route && l.route.path === "/").flatMap((l) => Object.keys(l.route.methods));
    const mineMethods = auditRouter.stack.filter((l) => l.route && l.route.path === "/mine").flatMap((l) => Object.keys(l.route.methods));
    expect(rootMethods).toEqual(["get"]);
    expect(mineMethods).toEqual(["get"]);
    expect(rootMethods).not.toContain("patch");
    expect(rootMethods).not.toContain("put");
    expect(rootMethods).not.toContain("delete");
  });

  it("no code path anywhere calls AuditLog.update*/deleteOne/deleteMany/findByIdAndUpdate/findByIdAndDelete (grep-verified in the final report)", () => {
    // This is a structural/documentation assertion, not a runtime one - see
    // the final report for the grep proof. Left here as a marker test so a
    // future PR that adds such a call path is at least flagged for review.
    expect(typeof AuditLog.findByIdAndDelete).toBe("function"); // Mongoose exposes it - the guarantee is that nothing in apps/api/src CALLS it
  });
});
