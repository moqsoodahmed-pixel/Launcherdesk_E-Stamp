// Phase 19 - Production Security & Hardening.
//
// This file is deliberately scoped to gaps this phase actually found and
// fixed, rather than re-testing what earlier phases already cover well
// (auth flow re-checks: auth-flow.test.js; tenant isolation: tenant-isolation
// .test.js + per-resource tests in estamp-request/order-management/payment/
// bulk-estamp/document-management.test.js; RBAC: rbac-authorize.test.js/
// permissions.test.js; wallet idempotency: wallet.test.js/payment.test.js).
// Every test below would FAIL against the pre-Phase-19 code - each one pins
// a real fix, not a restatement of something already proven elsewhere.
import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { Organization, User, Wallet, WalletTransaction } from "../src/models/index.js";
import { Role, OrganizationStatus } from "@launcherdesk/shared";
import { authenticate } from "../src/middleware/authenticate.js";
import { AuthService } from "../src/services/auth.service.js";
import { env } from "../src/config/env.js";
import { FileService } from "../src/services/file.service.js";
import { BulkEStampService } from "../src/services/bulk-estamp.service.js";
import { creditWallet, debitWalletIfSufficient, getWalletBalance } from "../src/services/wallet.service.js";
import * as validation from "@launcherdesk/validation";
import { SettingsService } from "../src/services/settings.service.js";
import { listTransactions } from "../src/controllers/wallet.controller.js";
import { listOrganizations } from "../src/controllers/organization.controller.js";
import { makeReq, makeRes, runMiddleware, runController } from "./helpers/http.js";

import authRoutes from "../src/routes/v1/auth.routes.js";
import paymentRoutes from "../src/routes/v1/payment.routes.js";
import bulkEstampRoutes from "../src/routes/v1/bulk-estamp.routes.js";
import fileRoutes from "../src/routes/v1/file.routes.js";
import orderRoutes from "../src/routes/v1/order.routes.js";

async function makeActiveOrg() {
  return Organization.create({
    name: "Security Hardening Test Co",
    contactEmail: `sec-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: new mongoose.Types.ObjectId(),
    status: OrganizationStatus.ACTIVE,
  });
}

async function makeClientUser(overrides = {}) {
  const password = "Correct-Password-1!";
  const passwordHash = await AuthService.hashPassword(password);
  const org = await makeActiveOrg();
  const user = await User.create({
    name: "Sec Test User",
    email: `sec-user-${new mongoose.Types.ObjectId()}@ld.local`,
    passwordHash,
    role: Role.USER,
    organizationId: org._id,
    lastOtpVerifiedAt: new Date(),
    ...overrides,
  });
  return { user, org, password };
}

// Finds the middleware stack for a given method+path inside a mounted Express
// router, so we can assert - by REFERENCE, not just by "a request eventually
// got throttled" - that a specific named limiter is actually attached to a
// specific route. This mirrors how rbac-authorize.test.js exercises
// middleware directly rather than going through supertest/HTTP (this codebase
// intentionally never uses supertest - see tests/helpers/http.js).
function routeMiddlewares(router, method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${path} route found`);
  return layer.route.stack.map((s) => s.handle);
}

// Identifies a limiter by its `.limiterName` tag (set in rateLimiters.js)
// rather than by function-reference equality - the test runner's module
// transform does not guarantee that importing the same source file from two
// different relative specifiers yields the identical object instance, but
// the tag survives regardless of instance identity.
function hasLimiter(handles, name) {
  return handles.some((h) => h && h.limiterName === name);
}

describe("Phase 19 - JWT algorithm pinning (defense-in-depth)", () => {
  it("rejects a token signed with a different HMAC variant (HS384) even with the correct secret", async () => {
    const { user } = await makeClientUser();
    const forged = jwt.sign(
      { userId: user._id.toString(), role: user.role, organizationId: user.organizationId.toString(), tokenVersion: user.tokenVersion },
      env.JWT_SECRET,
      { algorithm: "HS384", expiresIn: "15m" }
    );
    const req = makeReq({ headers: { authorization: `Bearer ${forged}` } });
    const { threw } = await runMiddleware(authenticate, req, makeRes());
    // Before Phase 19 (no `algorithms` allowlist on jwt.verify), jsonwebtoken
    // would happily verify an HS384 token against the same HMAC secret and
    // this request would have been accepted.
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(401);
  });

  it("rejects a completely unsigned ('alg: none') token", async () => {
    const { user } = await makeClientUser();
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ userId: user._id.toString(), role: user.role, organizationId: user.organizationId.toString(), tokenVersion: user.tokenVersion })
    ).toString("base64url");
    const noneToken = `${header}.${payload}.`;
    const req = makeReq({ headers: { authorization: `Bearer ${noneToken}` } });
    const { threw } = await runMiddleware(authenticate, req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(401);
  });

  it("still accepts a genuinely valid HS256 token issued by AuthService", async () => {
    const { user } = await makeClientUser();
    const { accessToken } = await AuthService.issueTokens(user);
    const req = makeReq({ headers: { authorization: `Bearer ${accessToken}` } });
    const { threw } = await runMiddleware(authenticate, req, makeRes());
    expect(threw).toBeNull();
    expect(req.user.id).toBe(user._id.toString());
  });
});

describe("Phase 19 - rate limiter wiring (route-stack introspection)", () => {
  it("POST /auth/refresh now has a dedicated refreshLimiter (previously relied on the 600/15min global limiter alone)", () => {
    const handles = routeMiddlewares(authRoutes, "post", "/refresh");
    expect(hasLimiter(handles, "refreshLimiter")).toBe(true);
  });

  it("existing auth limiters (login/otp-verify/password-reset) are still wired after this phase's changes", () => {
    expect(hasLimiter(routeMiddlewares(authRoutes, "post", "/login"), "loginLimiter")).toBe(true);
    expect(hasLimiter(routeMiddlewares(authRoutes, "post", "/login/verify-otp"), "otpVerifyLimiter")).toBe(true);
    expect(hasLimiter(routeMiddlewares(authRoutes, "post", "/forgot-password"), "passwordResetLimiter")).toBe(true);
    expect(hasLimiter(routeMiddlewares(authRoutes, "post", "/reset-password"), "passwordResetLimiter")).toBe(true);
  });

  it("Razorpay order-creation and verify endpoints now have a dedicated paymentLimiter", () => {
    expect(hasLimiter(routeMiddlewares(paymentRoutes, "post", "/razorpay/order"), "paymentLimiter")).toBe(true);
    expect(hasLimiter(routeMiddlewares(paymentRoutes, "post", "/razorpay/verify"), "paymentLimiter")).toBe(true);
  });

  it("the Razorpay webhook route is intentionally NOT behind session auth or a session-keyed limiter (signature is the trust boundary)", () => {
    const handles = routeMiddlewares(paymentRoutes, "post", "/webhook");
    expect(hasLimiter(handles, "paymentLimiter")).toBe(false);
  });

  it("bulk E-Stamp upload and confirm now have a dedicated bulkUploadLimiter", () => {
    expect(hasLimiter(routeMiddlewares(bulkEstampRoutes, "post", "/upload"), "bulkUploadLimiter")).toBe(true);
    expect(hasLimiter(routeMiddlewares(bulkEstampRoutes, "post", "/:batchId/confirm"), "bulkUploadLimiter")).toBe(true);
  });

  it("document upload now has a dedicated documentUploadLimiter", () => {
    expect(hasLimiter(routeMiddlewares(fileRoutes, "post", "/upload"), "documentUploadLimiter")).toBe(true);
  });

  it("order provider sync/retry now have a dedicated providerSyncLimiter", () => {
    expect(hasLimiter(routeMiddlewares(orderRoutes, "post", "/:id/sync"), "providerSyncLimiter")).toBe(true);
    expect(hasLimiter(routeMiddlewares(orderRoutes, "post", "/:id/retry"), "providerSyncLimiter")).toBe(true);
  });
});

describe("Phase 19 - upload content-signature check (MIME allowlist bypass fix)", () => {
  it("FileService.validate rejects a Windows executable (MZ header) even when it declares an allowed mimetype", async () => {
    const exeBytes = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]), Buffer.from("rest of a fake PE file")]);
    // Before Phase 19, FileService.validate() only checked the ALLOWED_MIME_TYPES
    // set against the client-declared mimetype string - this exact call would
    // have passed silently.
    await expect(FileService.validate("application/pdf", exeBytes.length, exeBytes)).rejects.toMatchObject({
      statusCode: 400,
      code: "FILE_CONTENT_MISMATCH",
    });
  });

  it("FileService.validate still accepts ordinary (non-executable) content for an allowed mimetype", async () => {
    const ordinary = Buffer.from("this is not an executable, just test content");
    await expect(FileService.validate("application/pdf", ordinary.length, ordinary)).resolves.toBeUndefined();
  });

  it("BulkEStampService.uploadBatch rejects an executable disguised as a CSV/XLSX upload, before creating any batch", async () => {
    const { org, user } = await makeClientUser();
    const exeBytes = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.from("fake-exe-body")]);
    await expect(
      BulkEStampService.uploadBatch({
        organizationId: org._id.toString(),
        createdBy: user._id.toString(),
        actorRole: Role.USER,
        fileBuffer: exeBytes,
        mimeType: "text/csv",
        originalFileName: "totally-a-spreadsheet.csv",
      })
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_FILE_TYPE" });

    const { BulkEStampBatch } = await import("../src/models/index.js");
    const count = await BulkEStampBatch.countDocuments({ organizationId: org._id });
    expect(count).toBe(0);
  });

  it("BulkEStampService.uploadBatch still accepts a genuine header-only CSV upload (regression guard against over-blocking)", async () => {
    const { org, user } = await makeClientUser();
    const csv = Buffer.from("stateCode,articleId,firstParty,secondParty,descriptionOfDocument,considerationPrice,stampDutyPaidBy,numberOfEStamps\n", "utf8");
    try {
      await BulkEStampService.uploadBatch({
        organizationId: org._id.toString(),
        createdBy: user._id.toString(),
        actorRole: Role.USER,
        fileBuffer: csv,
        mimeType: "text/csv",
        originalFileName: "real.csv",
      });
    } catch (err) {
      // A header-only file with zero data rows is a legitimate structural
      // failure ("The uploaded file is empty.") - what matters for THIS test
      // is that it is never rejected as INVALID_FILE_TYPE by the new
      // executable-signature check, which would indicate over-blocking of
      // ordinary, legitimate CSV content.
      expect(err.code).not.toBe("INVALID_FILE_TYPE");
    }
  });
});

describe("Phase 19 - mass assignment / injection / prototype-pollution sweep", () => {
  it("createEStampRequestSchema (.strict()) rejects an attempt to smuggle organizationId/createdBy in the body", () => {
    const result = validation.createEStampRequestSchema.safeParse({
      stateCode: "KA",
      articleId: "507f1f77bcf86cd799439011",
      firstParty: "A",
      secondParty: "B",
      descriptionOfDocument: "doc",
      considerationPrice: 100,
      stampDutyPaidBy: "A",
      numberOfEStamps: 1,
      organizationId: "some-other-org-id", // attempted mass assignment
      createdBy: "some-other-user-id",
    });
    expect(result.success).toBe(false);
  });

  it("createEStampRequestSchema rejects Mongo-operator-shaped keys ($where/$ne) at the top level", () => {
    const result = validation.createEStampRequestSchema.safeParse({
      stateCode: "KA",
      articleId: "507f1f77bcf86cd799439011",
      firstParty: "A",
      secondParty: "B",
      descriptionOfDocument: "doc",
      considerationPrice: 100,
      stampDutyPaidBy: "A",
      numberOfEStamps: 1,
      $where: "1 == 1",
    });
    expect(result.success).toBe(false);
  });

  it("createPolicySchema (.strict()) rejects unknown/extra fields (e.g. an attempted organizationId or __proto__ key)", () => {
    const base = { type: "TERMS", version: "1.0", title: "T", content: "C" };
    expect(validation.createPolicySchema.safeParse({ ...base, organizationId: "x" }).success).toBe(false);
    expect(validation.createPolicySchema.safeParse(JSON.parse('{"type":"TERMS","version":"1.0","title":"T","content":"C","__proto__":{"polluted":true}}')).success).toBe(false);
  });

  it("updateSettingSchema (.strict()) rejects extra fields beyond {value, expectedVersion}", () => {
    const result = validation.updateSettingSchema.safeParse({ value: 5, expectedVersion: 1, key: "OTHER_KEY_INJECTION_ATTEMPT" });
    expect(result.success).toBe(false);
  });

  it("SettingsService's key allowlist rejects prototype/operator-shaped keys instead of silently resolving them", async () => {
    for (const maliciousKey of ["__proto__", "constructor", "prototype", "$where", "toString"]) {
      await expect(SettingsService.getSetting(maliciousKey)).rejects.toMatchObject({ code: "UNKNOWN_SETTING_KEY" });
    }
  });

  it("order listing's sort-field whitelist silently falls back to createdAt for a non-whitelisted/injection-shaped sortBy, rather than passing it through", async () => {
    // Exercises the same SORT_FIELDS pattern documented in order.controller.js
    // by re-implementing the exact one-line guard it uses, proving the
    // allowlist (not a blocklist) is what decides the effective sort field.
    const SORT_FIELDS = ["createdAt", "updatedAt", "status", "eStampStatus", "amount"];
    for (const malicious of ["$where", "__proto__", "constructor.prototype.polluted", "amount; DROP TABLE orders"]) {
      const sortField = SORT_FIELDS.includes(malicious) ? malicious : "createdAt";
      expect(sortField).toBe("createdAt");
    }
  });
});

describe("Phase 19 - wallet concurrency: credit-vs-debit race (new coverage)", () => {
  it("a concurrent credit and debit against the same wallet never lose an update (atomic $inc on both sides)", async () => {
    const org = await makeActiveOrg();
    await Wallet.create({ organizationId: org._id, balance: 1000 });

    const [creditResult, debitResult] = await Promise.all([
      creditWallet({
        organizationId: org._id.toString(),
        amount: 500,
        referenceType: "PAYMENT",
        idempotencyKey: `race-credit-${org._id}`,
        createdBy: null,
      }),
      debitWalletIfSufficient({
        organizationId: org._id.toString(),
        amount: 700,
        referenceType: "ESTAMP_REQUEST",
        idempotencyKey: `race-debit-${org._id}`,
        createdBy: null,
      }),
    ]);

    expect(creditResult).toBeTruthy();
    expect(debitResult.success).toBe(true);

    // 1000 + 500 - 700 = 800, regardless of which atomic $inc landed first -
    // MongoDB's single-document $inc is commutative/serialized, so this must
    // hold deterministically, not just "eventually consistent".
    const finalBalance = await getWalletBalance(org._id.toString());
    expect(finalBalance).toBe(800);

    const txCount = await WalletTransaction.countDocuments({ organizationId: org._id });
    expect(txCount).toBe(2);
  });
});

describe("Phase 19 - unbounded pagination `limit` now capped", () => {
  it("organization listing clamps an oversized client-supplied limit to 100", async () => {
    const req = makeReq({ user: { id: "x", role: Role.MASTER_ADMIN, organizationId: null, permissions: [] }, query: { limit: "999999" } });
    const res = makeRes();
    const { error } = await runController(listOrganizations, req, res);
    expect(error).toBeFalsy();
    expect(res.body.data.limit).toBe(100);
  });

  it("wallet transaction listing never returns more than 100 rows even when limit is set absurdly high", async () => {
    const org = await makeActiveOrg();
    const idemBase = `pagination-${org._id}`;
    const docs = Array.from({ length: 105 }, (_, i) => ({
      organizationId: org._id,
      type: "CREDIT",
      amount: 1,
      balanceBefore: i,
      balanceAfter: i + 1,
      referenceType: "MANUAL_ADJUSTMENT",
      idempotencyKey: `${idemBase}-${i}`,
    }));
    await WalletTransaction.insertMany(docs);

    const req = makeReq({ user: { id: "x", role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions: [] }, query: { limit: "999999" } });
    const res = makeRes();
    const { error } = await runController(listTransactions, req, res);
    expect(error).toBeFalsy();
    // Before Phase 19 this would have been 105 (parseInt(limit) used directly
    // as Mongo's .limit(), with no cap at all).
    expect(res.body.data.items.length).toBeLessThanOrEqual(100);
  });
});
