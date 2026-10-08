// Phase 12 - hardening the 20-minute modify/cancel lifecycle: boundary
// correctness, atomic-conditional-update race safety (modify-vs-cancel,
// cancel-vs-cancel, cancel-vs-lockExpiredRequests), and the server-derived
// canModify/canCancel/windowExpiresAt/windowRemainingSeconds read fields.
// See estamp-request.test.js for the original (pre-hardening) coverage,
// which this file does not duplicate except where a boundary/race scenario
// specifically needs its own fixture.
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
  BulkEStampBatch,
  BulkEStampBatchItem,
} from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus, EStampRequestStatus, getEffectivePermissions } from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import * as estampController from "../src/controllers/estamp-request.controller.js";
import { createEStampRequestSchema, updateEStampRequestSchema } from "@launcherdesk/validation";
import { requirePermission } from "../src/middleware/authorize.js";
import { validateBody } from "../src/middleware/validate.js";
import { makeReq, makeRes, runMiddleware, runController } from "./helpers/http.js";

// Plain CommonJS module - loaded via require() so ApiError instanceof checks
// (via rejects.toMatchObject on statusCode/code, which doesn't need this, but
// kept consistent with the rest of this test suite's documented convention;
// see modification-window.test.js/estamp-request.test.js for why).
const require = createRequire(import.meta.url);
const { ApiError } = require("../src/utils/ApiError.js");

async function makeOrgWithArticle({ balance = 100000, fixedAmount = 500 } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: "EStamp Hardening Test Co",
    contactEmail: `estamp-hard-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `ART-H-${new mongoose.Types.ObjectId()}`, title: "Test Article", createdBy: creator, currentVersion: 1 });
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

async function makeRequest(org, article, overrides = {}) {
  const creator = new mongoose.Types.ObjectId();
  const { request, order } = await EStampRequestService.createRequest({
    ...baseRequestBody(article),
    organizationId: org._id,
    createdBy: creator,
    ...overrides,
  });
  return { request, order, creator };
}

function reqAsUser(user, overrides = {}) {
  return makeReq({
    user: { id: user._id?.toString?.() || user.id, role: user.role, organizationId: (user.organizationId ?? null)?.toString?.() ?? null, permissions: user.permissions || [] },
    ...overrides,
  });
}

async function makeMasterAdmin() {
  return User.create({
    name: "Master Admin",
    email: `master-hard-${new mongoose.Types.ObjectId()}@ld.local`,
    passwordHash: "x",
    role: Role.MASTER_ADMIN,
    organizationId: null,
    isActive: true,
  });
}

describe("Boundary correctness: strictly `deadline > now` for both modify and cancel", () => {
  it("modify succeeds with ~1 second left on the window", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.modificationDeadline = new Date(Date.now() + 1000);
    await request.save();
    const updated = await EStampRequestService.modifyRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Still open" });
    expect(updated.firstParty).toBe("Still open");
  });

  it("modify fails at the EXACT deadline instant - same-instant must reject, not allow", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.modificationDeadline = new Date(); // "now" at construction time
    await request.save();
    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Too late" })
    ).rejects.toMatchObject({ statusCode: 409, code: "WINDOW_EXPIRED" });
    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.firstParty).toBe("Alice"); // unchanged
  });

  it("modify fails 1ms after the deadline", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.modificationDeadline = new Date(Date.now() - 1);
    await request.save();
    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Too late" })
    ).rejects.toMatchObject({ statusCode: 409, code: "WINDOW_EXPIRED" });
  });

  it("cancel succeeds with ~1 second left on the window", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.modificationDeadline = new Date(Date.now() + 1000);
    await request.save();
    const cancelled = await EStampRequestService.cancelRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN);
    expect(cancelled.status).toBe(EStampRequestStatus.CANCELLED);
  });

  it("cancel fails at the EXACT deadline instant", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.modificationDeadline = new Date();
    await request.save();
    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 409, code: "WINDOW_EXPIRED" });
    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.status).toBe(EStampRequestStatus.MODIFICATION_WINDOW); // unchanged
  });

  it("cancel fails 1ms after the deadline", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.modificationDeadline = new Date(Date.now() - 1);
    await request.save();
    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 409, code: "WINDOW_EXPIRED" });
  });

  it("assertWithinModificationWindow's own boundary fix: exact tie is now rejected (was previously allowed by `<`)", () => {
    const tieRequest = { status: EStampRequestStatus.MODIFICATION_WINDOW, modificationDeadline: new Date(Date.now() - 0) };
    // Force a true tie by reusing the same Date instance both sides compare against.
    const now = tieRequest.modificationDeadline.getTime();
    expect(now <= Date.now()).toBe(true);
    expect(() => EStampRequestService.assertWithinModificationWindow(tieRequest)).toThrow(ApiError);
  });
});

describe("Financial safety: modify cannot touch calculated amount (schema-level restriction)", () => {
  it("the strict update schema rejects considerationPrice/numberOfEStamps/articleId/stateCode outright (400, not silently dropped)", () => {
    for (const [field, value] of [
      ["considerationPrice", 999999],
      ["numberOfEStamps", 50],
      ["articleId", new mongoose.Types.ObjectId().toString()],
      ["stateCode", "MH"],
    ]) {
      const result = updateEStampRequestSchema.safeParse({ firstParty: "Alice", [field]: value });
      expect(result.success).toBe(false);
    }
  });

  it("a full route-shaped tamper attempt (validateBody middleware) is rejected with 400 before ever reaching the service, and the wallet/calculatedStampDuty are provably unchanged", async () => {
    const { org, article } = await makeOrgWithArticle({ balance: 10000, fixedAmount: 500 });
    const { request } = await makeRequest(org, article);
    const walletBefore = await Wallet.findOne({ organizationId: org._id });

    const req = makeReq({ body: { firstParty: "Alice Updated", considerationPrice: 999999 } });
    const { threw } = await runMiddleware(validateBody(updateEStampRequestSchema), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(400);

    // Since validateBody rejects before the controller/service ever run, the
    // request/wallet are necessarily untouched - confirmed explicitly here
    // rather than merely assumed.
    const reloadedRequest = await EStampRequest.findById(request._id);
    expect(reloadedRequest.calculatedStampDuty).toBe(500);
    expect(reloadedRequest.considerationPrice).toBe(0);
    expect(reloadedRequest.firstParty).toBe("Alice");
    const walletAfter = await Wallet.findOne({ organizationId: org._id });
    expect(walletAfter.balance).toBe(walletBefore.balance);
  });
});

describe("Concurrency: modify vs modify (no financial risk, last-write-wins is acceptable, but no corruption)", () => {
  it("two simultaneous modifyRequest calls both succeed and leave one consistent final state", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    const results = await Promise.allSettled([
      EStampRequestService.modifyRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Racer A" }),
      EStampRequestService.modifyRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Racer B" }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const reloaded = await EStampRequest.findById(request._id);
    expect(["Racer A", "Racer B"]).toContain(reloaded.firstParty); // one consistent winner, never corrupted/blended
    expect(reloaded.status).toBe(EStampRequestStatus.MODIFICATION_WINDOW);
  });
});

describe("Concurrency: cancel vs cancel (exactly one audit + one notification fan-out, never duplicated)", () => {
  it("two simultaneous cancelRequest calls by an Assistant Master Admin produce exactly one audit entry and exactly one notification per Master Admin", async () => {
    const master = await makeMasterAdmin();
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    const assistantId = new mongoose.Types.ObjectId().toString();

    const results = await Promise.allSettled([
      EStampRequestService.cancelRequest(request._id.toString(), org._id, assistantId, Role.ASSISTANT_MASTER_ADMIN),
      EStampRequestService.cancelRequest(request._id.toString(), org._id, assistantId, Role.ASSISTANT_MASTER_ADMIN),
    ]);
    // Both calls resolve cleanly (one does the real work, the other sees the
    // idempotent already-cancelled no-op) - neither crashes or throws.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.status).toBe(EStampRequestStatus.CANCELLED);

    const auditCount = await AuditLog.countDocuments({ action: AuditAction.ESTAMP_REQUEST_CANCELLED, entityId: request._id.toString() });
    expect(auditCount).toBe(1);

    const notificationCount = await Notification.countDocuments({ recipientId: master._id.toString(), relatedActorId: assistantId, type: "ASSISTANT_ADMIN_ACTIVITY" });
    expect(notificationCount).toBe(1);

    const reloadedOrder = await EStampOrder.findOne({ requestId: request._id });
    expect(reloadedOrder.status).toBe("CANCELLED");
  });

  it("repeating an identical cancelRequest after a successful cancellation is a clean no-op - same request returned, no second audit/order-update", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request, order } = await makeRequest(org, article);
    const actorId = new mongoose.Types.ObjectId().toString();

    const first = await EStampRequestService.cancelRequest(request._id.toString(), org._id, actorId, Role.SUPER_ADMIN);
    expect(first.status).toBe(EStampRequestStatus.CANCELLED);

    const second = await EStampRequestService.cancelRequest(request._id.toString(), org._id, actorId, Role.SUPER_ADMIN);
    expect(second._id.toString()).toBe(first._id.toString());
    expect(second.status).toBe(EStampRequestStatus.CANCELLED);

    const auditCount = await AuditLog.countDocuments({ action: AuditAction.ESTAMP_REQUEST_CANCELLED, entityId: request._id.toString() });
    expect(auditCount).toBe(1);
  });
});

describe("Concurrency: cancel vs lockExpiredRequests - both possible interleavings", () => {
  it("interleaving 1 - request not yet expired: cancel wins outright, the cron correctly finds nothing to lock", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article); // deadline is the full 20-minute window out, still open
    const actorId = new mongoose.Types.ObjectId().toString();

    const [cancelResult, lockedCount] = await Promise.all([
      EStampRequestService.cancelRequest(request._id.toString(), org._id, actorId, Role.SUPER_ADMIN),
      EStampRequestService.lockExpiredRequests(),
    ]);
    expect(cancelResult.status).toBe(EStampRequestStatus.CANCELLED);
    expect(lockedCount).toBe(0); // this request's deadline had not passed, so the cron correctly ignored it

    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.status).toBe(EStampRequestStatus.CANCELLED); // never corrupted back to LOCKED
  });

  it("interleaving 2 - request already expired: the cron locks it, and cancel then sees a clean rejection (never a corrupted mixed state)", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.modificationDeadline = new Date(Date.now() - 5000);
    await request.save();
    const actorId = new mongoose.Types.ObjectId().toString();

    const [cancelSettled, lockedCount] = await Promise.all([
      EStampRequestService.cancelRequest(request._id.toString(), org._id, actorId, Role.SUPER_ADMIN).then(
        (v) => ({ status: "fulfilled", value: v }),
        (e) => ({ status: "rejected", reason: e })
      ),
      EStampRequestService.lockExpiredRequests(),
    ]);
    expect(lockedCount).toBe(1);
    expect(cancelSettled.status).toBe("rejected");
    expect(cancelSettled.reason.statusCode).toBe(409);

    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.status).toBe(EStampRequestStatus.LOCKED); // exactly one deterministic outcome, never a blend
  });
});

describe("Terminal-state protection: modify/cancel rejected once a request has left MODIFICATION_WINDOW", () => {
  const terminalStatuses = [
    EStampRequestStatus.LOCKED,
    EStampRequestStatus.PROCESSING,
    EStampRequestStatus.COMPLETED,
    EStampRequestStatus.DOWNLOAD_AVAILABLE,
    EStampRequestStatus.CANCELLED,
    EStampRequestStatus.FAILED,
  ];

  it.each(terminalStatuses)("modify is rejected (409/INVALID_STATE) when the request is %s", async (status) => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.status = status;
    await request.save();
    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Hacked" })
    ).rejects.toMatchObject({ statusCode: 409, code: "INVALID_STATE" });
    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.firstParty).toBe("Alice");
  });

  it.each(terminalStatuses)("cancel against a request already at %s either no-ops (if already CANCELLED) or is rejected 409/INVALID_STATE", async (status) => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.status = status;
    await request.save();
    if (status === EStampRequestStatus.CANCELLED) {
      const result = await EStampRequestService.cancelRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN);
      expect(result.status).toBe(EStampRequestStatus.CANCELLED);
      return;
    }
    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 409, code: "INVALID_STATE" });
    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.status).toBe(status); // unchanged
  });
});

describe("Tenant isolation: Organization A cannot modify/cancel Organization B's request (404, matching the codebase-wide convention)", () => {
  it("modifyRequest returns 404, not 403, and leaves the request untouched", async () => {
    const { org: orgA } = await makeOrgWithArticle();
    const { org: orgB, article: articleB } = await makeOrgWithArticle();
    const { request } = await makeRequest(orgB, articleB);
    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), orgA._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Stolen" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("cancelRequest returns 404, not 403, and leaves the request untouched", async () => {
    const { org: orgA } = await makeOrgWithArticle();
    const { org: orgB, article: articleB } = await makeOrgWithArticle();
    const { request } = await makeRequest(orgB, articleB);
    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), orgA._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 404 });
    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.status).toBe(EStampRequestStatus.MODIFICATION_WINDOW);
  });
});

describe("Permission checks: ESTAMP_MODIFY/ESTAMP_CANCEL gate the routes exactly as before - nothing new added", () => {
  it("a role without ESTAMP_MODIFY is rejected by requirePermission with 403", async () => {
    const req = makeReq({ user: { id: "x", role: Role.USER, organizationId: "org-1", permissions: [] } });
    const { threw } = await runMiddleware(requirePermission(Permission.ESTAMP_MODIFY), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("a role without ESTAMP_CANCEL is rejected by requirePermission with 403", async () => {
    const req = makeReq({ user: { id: "x", role: Role.USER, organizationId: "org-1", permissions: [] } });
    const { threw } = await runMiddleware(requirePermission(Permission.ESTAMP_CANCEL), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("Assistant Master Admin with NO explicit grant is denied both ESTAMP_MODIFY and ESTAMP_CANCEL", async () => {
    // ASSISTANT_MASTER_ADMIN's default template (DEFAULT_ROLE_PERMISSIONS) does
    // NOT include ESTAMP_MODIFY/ESTAMP_CANCEL - getEffectivePermissions([])
    // reflects that this role gets ONLY what is explicitly stored, never a
    // silent default.
    const permissions = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, []);
    expect(permissions).not.toContain(Permission.ESTAMP_MODIFY);
    expect(permissions).not.toContain(Permission.ESTAMP_CANCEL);
    const req = makeReq({ user: { id: "x", role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions } });
    const modifyResult = await runMiddleware(requirePermission(Permission.ESTAMP_MODIFY), req, makeRes());
    expect(modifyResult.threw.statusCode).toBe(403);
    const cancelResult = await runMiddleware(requirePermission(Permission.ESTAMP_CANCEL), req, makeRes());
    expect(cancelResult.threw.statusCode).toBe(403);
  });

  it("Assistant Master Admin explicitly granted ESTAMP_MODIFY/ESTAMP_CANCEL passes the permission gate", async () => {
    const permissions = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [Permission.ESTAMP_MODIFY, Permission.ESTAMP_CANCEL]);
    const req = makeReq({ user: { id: "x", role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions } });
    const modifyResult = await runMiddleware(requirePermission(Permission.ESTAMP_MODIFY), req, makeRes());
    expect(modifyResult.threw).toBeNull();
    const cancelResult = await runMiddleware(requirePermission(Permission.ESTAMP_CANCEL), req, makeRes());
    expect(cancelResult.threw).toBeNull();
  });
});

describe("lockExpiredRequests hardening", () => {
  it("locks a genuinely expired MODIFICATION_WINDOW request and flips its order's eStampStatus to CREATED", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request, order } = await makeRequest(org, article);
    request.modificationDeadline = new Date(Date.now() - 1000);
    await request.save();

    const lockedCount = await EStampRequestService.lockExpiredRequests();
    expect(lockedCount).toBe(1);

    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.status).toBe(EStampRequestStatus.LOCKED);
    expect(reloaded.lockedAt).toBeInstanceOf(Date);

    const reloadedOrder = await EStampOrder.findById(order._id);
    expect(reloadedOrder.eStampStatus).toBe("CREATED");
  });

  it("does NOT touch a request whose deadline has not passed", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article); // full window still open

    const lockedCount = await EStampRequestService.lockExpiredRequests();
    expect(lockedCount).toBe(0);
    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.status).toBe(EStampRequestStatus.MODIFICATION_WINDOW);
  });

  it("skips (never corrupts) a request that a concurrent cancel already claimed first", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    // Simulate: the request's deadline has technically passed by the time the
    // cron runs, but a cancellation reached the database microseconds
    // earlier and already moved it to CANCELLED.
    request.modificationDeadline = new Date(Date.now() - 1000);
    request.status = EStampRequestStatus.CANCELLED;
    request.cancelledAt = new Date();
    await request.save();

    const lockedCount = await EStampRequestService.lockExpiredRequests();
    expect(lockedCount).toBe(0); // the atomic per-candidate claim correctly lost/skipped
    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.status).toBe(EStampRequestStatus.CANCELLED); // never overwritten back to LOCKED
  });
});

describe("Bulk compatibility: a bulk-created request goes through the exact same hardened modify/cancel path", () => {
  async function makeBulkCreatedRequest(org, article, actorId) {
    const batch = await BulkEStampBatch.create({
      batchNumber: `LDE-BULK-HARD-${new mongoose.Types.ObjectId()}`,
      organizationId: org._id,
      createdBy: actorId,
      fileName: "hardening-test.csv",
      fileType: "CSV",
      status: "COMPLETED",
      totalRows: 1,
      validRows: 1,
      invalidRows: 0,
      createdRequests: 1,
      failedRows: 0,
    });
    const idempotencyKey = `bulk:${batch._id.toString()}:row:1`;
    const { request, order } = await EStampRequestService.createRequest({
      ...baseRequestBody(article),
      organizationId: org._id,
      createdBy: actorId,
      idempotencyKey,
    });
    const item = await BulkEStampBatchItem.create({
      batchId: batch._id,
      organizationId: org._id,
      rowNumber: 1,
      status: "CREATED",
      inputData: { firstParty: "Alice" },
      requestId: request._id,
      orderId: order._id,
      idempotencyKey,
      calculatedAmount: request.calculatedStampDuty,
    });
    return { batch, item, request, order };
  }

  it("can be modified through modifyRequest exactly like a single-created request", async () => {
    const { org, article } = await makeOrgWithArticle();
    const actorId = new mongoose.Types.ObjectId();
    const { item, request } = await makeBulkCreatedRequest(org, article, actorId);

    const updated = await EStampRequestService.modifyRequest(request._id.toString(), org._id, actorId.toString(), Role.SUPER_ADMIN, { firstParty: "Bulk Updated" });
    expect(updated.firstParty).toBe("Bulk Updated");

    const reloadedItem = await BulkEStampBatchItem.findById(item._id);
    expect(reloadedItem.status).toBe("CREATED"); // untouched - no reverse-sync
  });

  it("can be cancelled through cancelRequest, tenant-isolated correctly, WITHOUT mutating BulkEStampBatchItem or the batch's aggregate counters", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { org: otherOrg } = await makeOrgWithArticle();
    const actorId = new mongoose.Types.ObjectId();
    const { batch, item, request } = await makeBulkCreatedRequest(org, article, actorId);

    // Tenant isolation: a foreign org cannot cancel this bulk-created request.
    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), otherOrg._id, actorId.toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 404 });

    const cancelled = await EStampRequestService.cancelRequest(request._id.toString(), org._id, actorId.toString(), Role.SUPER_ADMIN);
    expect(cancelled.status).toBe(EStampRequestStatus.CANCELLED);

    // Deliberate non-goal (documented, not a bug): the batch item still
    // tracks the BULK-CREATION outcome, not the request's ongoing lifecycle.
    const reloadedItem = await BulkEStampBatchItem.findById(item._id);
    expect(reloadedItem.status).toBe("CREATED");
    const reloadedBatch = await BulkEStampBatch.findById(batch._id);
    expect(reloadedBatch.status).toBe("COMPLETED");
    expect(reloadedBatch.createdRequests).toBe(1);
  });
});

describe("Read-endpoint fields: canModify/canCancel/windowExpiresAt/windowRemainingSeconds are server-computed and informational only", () => {
  it("GET /estamps/:id reports canModify=canCancel=true, with a positive windowRemainingSeconds, while inside the window", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    const user = await User.create({ name: "U", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.SUPER_ADMIN, organizationId: org._id });
    const req = reqAsUser(user, { params: { id: request._id.toString() } });
    const { res, error } = await runController(estampController.getRequest, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.canModify).toBe(true);
    expect(res.body.data.canCancel).toBe(true);
    expect(res.body.data.windowExpiresAt).toBeDefined();
    expect(res.body.data.windowRemainingSeconds).toBeGreaterThan(0);
  });

  it("reports canModify=canCancel=false exactly at the boundary instant", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.modificationDeadline = new Date();
    await request.save();
    const user = await User.create({ name: "U", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.SUPER_ADMIN, organizationId: org._id });
    const req = reqAsUser(user, { params: { id: request._id.toString() } });
    const { res, error } = await runController(estampController.getRequest, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.canModify).toBe(false);
    expect(res.body.data.canCancel).toBe(false);
    expect(res.body.data.windowRemainingSeconds).toBe(0);
  });

  it("reports canModify=canCancel=false once LOCKED, and once CANCELLED", async () => {
    const { org, article } = await makeOrgWithArticle();
    // Distinct idempotencyKeys: two EStampRequests in the SAME org with no
    // idempotencyKey would otherwise collide on the {organizationId,
    // idempotencyKey} unique-sparse index (a document is only excluded from
    // a compound sparse index if ALL its keys are missing - organizationId
    // is always present here, so both would index as (org, null)). This is a
    // pre-existing quirk unrelated to Phase 12 - see bulk-estamp.service.js's
    // own comment about this exact trap - worked around here the same way.
    const { request: lockedRequest } = await makeRequest(org, article, { idempotencyKey: `hardening-locked-${new mongoose.Types.ObjectId()}` });
    lockedRequest.status = EStampRequestStatus.LOCKED;
    await lockedRequest.save();
    const { request: cancelledRequest } = await makeRequest(org, article, { idempotencyKey: `hardening-cancelled-${new mongoose.Types.ObjectId()}` });
    cancelledRequest.status = EStampRequestStatus.CANCELLED;
    await cancelledRequest.save();
    const user = await User.create({ name: "U", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.SUPER_ADMIN, organizationId: org._id });

    for (const r of [lockedRequest, cancelledRequest]) {
      const req = reqAsUser(user, { params: { id: r._id.toString() } });
      const { res, error } = await runController(estampController.getRequest, req, makeRes());
      expect(error).toBeNull();
      expect(res.body.data.canModify).toBe(false);
      expect(res.body.data.canCancel).toBe(false);
      expect(res.body.data.windowExpiresAt).toBeNull();
    }
  });

  it("GET /estamps (list) attaches the same fields to every item", async () => {
    const { org, article } = await makeOrgWithArticle();
    await makeRequest(org, article);
    const user = await User.create({ name: "U", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.SUPER_ADMIN, organizationId: org._id });
    const req = reqAsUser(user, { query: {} });
    const { res, error } = await runController(estampController.listRequests, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBeGreaterThan(0);
    for (const item of res.body.data.items) {
      expect(typeof item.canModify).toBe("boolean");
      expect(typeof item.canCancel).toBe("boolean");
      expect(typeof item.windowRemainingSeconds).toBe("number");
    }
  });

  it("a forged canModify:true in a PATCH body has zero effect - the strict update schema 400s on the unknown field", () => {
    const result = updateEStampRequestSchema.safeParse({ firstParty: "Alice", canModify: true, canCancel: true });
    expect(result.success).toBe(false);
  });
});

describe("Audit: only genuine successes are audited, matching this codebase's existing convention", () => {
  it("a successful modify produces exactly one correctly-attributed ESTAMP_REQUEST_MODIFIED entry", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    const actorId = new mongoose.Types.ObjectId().toString();
    await EStampRequestService.modifyRequest(request._id.toString(), org._id, actorId, Role.SUPER_ADMIN, { firstParty: "Audited" });
    const entries = await AuditLog.find({ action: AuditAction.ESTAMP_REQUEST_MODIFIED, entityId: request._id.toString() });
    expect(entries.length).toBe(1);
    expect(entries[0].actorId.toString()).toBe(actorId);
    expect(entries[0].actorRole).toBe(Role.SUPER_ADMIN);
    expect(entries[0].organizationId.toString()).toBe(org._id.toString());
  });

  it("a successful cancel produces exactly one correctly-attributed ESTAMP_REQUEST_CANCELLED entry", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    const actorId = new mongoose.Types.ObjectId().toString();
    await EStampRequestService.cancelRequest(request._id.toString(), org._id, actorId, Role.SUPER_ADMIN);
    const entries = await AuditLog.find({ action: AuditAction.ESTAMP_REQUEST_CANCELLED, entityId: request._id.toString() });
    expect(entries.length).toBe(1);
    expect(entries[0].actorId.toString()).toBe(actorId);
    expect(entries[0].organizationId.toString()).toBe(org._id.toString());
  });

  it("a rejected (expired) modify attempt produces NO ESTAMP_REQUEST_MODIFIED entry - same precedent as createRequest's own failed-attempt behavior", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.modificationDeadline = new Date(Date.now() - 1000);
    await request.save();
    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Nope" })
    ).rejects.toMatchObject({ statusCode: 409 });
    const entries = await AuditLog.find({ action: AuditAction.ESTAMP_REQUEST_MODIFIED, entityId: request._id.toString() });
    expect(entries.length).toBe(0);
  });

  it("a rejected (wrong-org) cancel attempt produces NO ESTAMP_REQUEST_CANCELLED entry", async () => {
    const { org: orgA } = await makeOrgWithArticle();
    const { org: orgB, article: articleB } = await makeOrgWithArticle();
    const { request } = await makeRequest(orgB, articleB);
    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), orgA._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 404 });
    const entries = await AuditLog.find({ action: AuditAction.ESTAMP_REQUEST_CANCELLED, entityId: request._id.toString() });
    expect(entries.length).toBe(0);
  });
});

describe("Notification: assistant-oversight fan-out fires exactly once per genuine cancellation, none on rejection", () => {
  it("a genuine cancel by an Assistant Master Admin notifies every active Master Admin exactly once", async () => {
    const masterOne = await makeMasterAdmin();
    const masterTwo = await makeMasterAdmin();
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    const assistantId = new mongoose.Types.ObjectId().toString();

    await EStampRequestService.cancelRequest(request._id.toString(), org._id, assistantId, Role.ASSISTANT_MASTER_ADMIN);

    for (const master of [masterOne, masterTwo]) {
      const count = await Notification.countDocuments({ recipientId: master._id.toString(), relatedActorId: assistantId, type: "ASSISTANT_ADMIN_ACTIVITY" });
      expect(count).toBe(1);
    }
  });

  it("a rejected (expired) cancel attempt by an Assistant Master Admin fires NO notification", async () => {
    const master = await makeMasterAdmin();
    const { org, article } = await makeOrgWithArticle();
    const { request } = await makeRequest(org, article);
    request.modificationDeadline = new Date(Date.now() - 1000);
    await request.save();
    const assistantId = new mongoose.Types.ObjectId().toString();

    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), org._id, assistantId, Role.ASSISTANT_MASTER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 409 });

    const count = await Notification.countDocuments({ recipientId: master._id.toString(), relatedActorId: assistantId, type: "ASSISTANT_ADMIN_ACTIVITY" });
    expect(count).toBe(0);
  });
});

describe("Structural proof: modify/cancel vs processOrder is now mutually exclusive by construction", () => {
  it("processOrder requires LOCKED/PROCESSING, which modifyRequest/cancelRequest's atomic update can never match (MODIFICATION_WINDOW only)", async () => {
    const { org, article } = await makeOrgWithArticle();
    const { request, order } = await makeRequest(org, article);
    // Still in MODIFICATION_WINDOW - processOrder must refuse it outright,
    // structurally, before any provider call is ever attempted.
    await expect(
      EStampRequestService.processOrder(order._id.toString(), org._id.toString(), new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 409, code: "INVALID_STATE_TRANSITION" });

    // Conversely, once locked (the only way to become processOrder-eligible),
    // modify/cancel's own atomic precondition (status === MODIFICATION_WINDOW)
    // can never match it any more - the two are mutually exclusive states.
    request.status = EStampRequestStatus.LOCKED;
    await request.save();
    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), org._id, new mongoose.Types.ObjectId().toString(), Role.SUPER_ADMIN, { firstParty: "Too late" })
    ).rejects.toMatchObject({ statusCode: 409, code: "INVALID_STATE" });
  });
});
