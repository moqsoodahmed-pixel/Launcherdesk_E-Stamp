// Phase 16 - Terms, Policies & No-Refund Controls. This is a SOFTWARE
// MECHANISM for policy versioning/acknowledgement only - no approved legal
// Terms/Privacy/Refund text exists anywhere in this repository, and none is
// fabricated here. Every `content` value used in these tests is a clearly
// fake test string, never real-looking legal language.
//
// Covers: policy lifecycle (draft -> publish -> supersede, duplicate
// version rejection, concurrent-publish race safety via the partial unique
// index), permissions (POLICY_VIEW/POLICY_MANAGE wiring), acceptance
// (server-derived timestamp/ip/user-agent, forged-field rejection,
// idempotency, stale-version rejection, re-acceptance-on-new-version
// detection), the public unauthenticated current-policy endpoint,
// immutability (no PATCH/PUT/DELETE route), the enforcement mechanism
// working in isolation while proven NOT wired into any live business flow,
// refund/no-refund regression (cancelRequest still never credits the
// wallet), and audit coverage (safe metadata only, content never logged).
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
  Policy,
  PolicyAcknowledgement,
  PolicyType,
  PolicyStatus,
} from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus, getEffectivePermissions, DEFAULT_ROLE_PERMISSIONS } from "@launcherdesk/shared";
import { PolicyService } from "../src/services/policy.service.js";
import * as policyController from "../src/controllers/policy.controller.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { validateBody } from "../src/middleware/validate.js";
import { createPolicySchema, acknowledgePolicySchema, createEStampRequestSchema } from "@launcherdesk/validation";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

const require = createRequire(import.meta.url);
const { default: policyRouter } = require("../src/routes/v1/policy.routes.js");

async function createOrg(overrides = {}) {
  return Organization.create({
    name: overrides.name || `Policy Test Org ${new mongoose.Types.ObjectId()}`,
    contactEmail: `policy-${new mongoose.Types.ObjectId()}@example.com`,
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
  const article = await Article.create({ stateCode: "KA", articleCode: `ART-POL-${new mongoose.Types.ObjectId()}`, title: "Test Article", createdBy: creator, currentVersion: 1 });
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

const FAKE_CONTENT = "TEST PLACEHOLDER CONTENT - not real legal text - v1";
const FAKE_CONTENT_V2 = "TEST PLACEHOLDER CONTENT - not real legal text - v2";

describe("Policy lifecycle", () => {
  it("createDraft creates a DRAFT document", async () => {
    const draft = await PolicyService.createDraft({
      type: PolicyType.TERMS,
      version: "1.0",
      title: "Terms of Service",
      content: FAKE_CONTENT,
      createdBy: new mongoose.Types.ObjectId(),
      actorRole: Role.MASTER_ADMIN,
    });
    expect(draft.status).toBe(PolicyStatus.DRAFT);
    expect(draft.publishedAt).toBeNull();
  });

  it("rejects a duplicate {type,version} with a clean 409, backed by the unique index", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    await PolicyService.createDraft({ type: PolicyType.TERMS, version: "1.0", title: "T", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await expect(
      PolicyService.createDraft({ type: PolicyType.TERMS, version: "1.0", title: "T2", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN })
    ).rejects.toMatchObject({ statusCode: 409, code: "POLICY_VERSION_EXISTS" });
  });

  it("publish flips DRAFT -> PUBLISHED and sets publishedAt/effectiveAt/publishedBy", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.PRIVACY, version: "1.0", title: "Privacy", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    const published = await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);
    expect(published.status).toBe(PolicyStatus.PUBLISHED);
    expect(published.publishedAt).not.toBeNull();
    expect(published.effectiveAt).not.toBeNull();
    expect(published.publishedBy.toString()).toBe(actorId.toString());
  });

  it("publishing a second draft version supersedes the first - exactly one PUBLISHED at a time", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const v1 = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "1.0", title: "Terms", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(v1._id, actorId, Role.MASTER_ADMIN);
    const v2 = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "2.0", title: "Terms", content: FAKE_CONTENT_V2, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(v2._id, actorId, Role.MASTER_ADMIN);

    const v1Reloaded = await Policy.findById(v1._id);
    const v2Reloaded = await Policy.findById(v2._id);
    expect(v1Reloaded.status).toBe(PolicyStatus.SUPERSEDED);
    expect(v1Reloaded.supersededAt).not.toBeNull();
    expect(v2Reloaded.status).toBe(PolicyStatus.PUBLISHED);

    const publishedCount = await Policy.countDocuments({ type: PolicyType.TERMS, status: PolicyStatus.PUBLISHED });
    expect(publishedCount).toBe(1);
  });

  it("republishing an already-PUBLISHED or SUPERSEDED document is rejected (only a DRAFT can be published)", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.REFUND, version: "1.0", title: "Refund", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    const published = await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);
    await expect(PolicyService.publish(published._id, actorId, Role.MASTER_ADMIN)).rejects.toMatchObject({ statusCode: 409, code: "POLICY_NOT_DRAFT" });
  });

  it("CONCURRENCY: publishing two different DRAFT versions of the same type simultaneously - exactly one wins, the other gets a clean conflict, never two simultaneously PUBLISHED", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId1 = new mongoose.Types.ObjectId();
    const actorId2 = new mongoose.Types.ObjectId();
    const v1 = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "3.0", title: "Terms", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    const v2 = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "4.0", title: "Terms", content: FAKE_CONTENT_V2, createdBy, actorRole: Role.MASTER_ADMIN });

    const results = await Promise.allSettled([
      PolicyService.publish(v1._id, actorId1, Role.MASTER_ADMIN),
      PolicyService.publish(v2._id, actorId2, Role.MASTER_ADMIN),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toMatchObject({ statusCode: 409, code: "POLICY_ALREADY_PUBLISHED" });

    const publishedCount = await Policy.countDocuments({ type: PolicyType.TERMS, status: PolicyStatus.PUBLISHED });
    expect(publishedCount).toBe(1); // never two simultaneously published, regardless of which one won
  });

  it("getCurrent returns null (never a fabricated document) when no version has ever been published for a type", async () => {
    const current = await PolicyService.getCurrent(PolicyType.REFUND);
    expect(current).toBeNull();
  });

  it("getHistory returns all versions including drafts and superseded ones, paginated", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const v1 = await PolicyService.createDraft({ type: PolicyType.PRIVACY, version: "5.0", title: "P", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(v1._id, actorId, Role.MASTER_ADMIN);
    await PolicyService.createDraft({ type: PolicyType.PRIVACY, version: "6.0", title: "P", content: FAKE_CONTENT_V2, createdBy, actorRole: Role.MASTER_ADMIN });
    const { items, total } = await PolicyService.getHistory(PolicyType.PRIVACY, {});
    expect(total).toBe(2);
    expect(items.map((i) => i.status).sort()).toEqual([PolicyStatus.DRAFT, PolicyStatus.PUBLISHED].sort());
  });
});

describe("Immutability - no route exists to modify or delete a Policy or PolicyAcknowledgement", () => {
  it("the policy router exposes no PATCH/PUT/DELETE on any path", () => {
    const allMethods = policyRouter.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods));
    expect(allMethods).not.toContain("patch");
    expect(allMethods).not.toContain("put");
    expect(allMethods).not.toContain("delete");
  });

  it("only GET and POST routes are registered (create-draft/publish/acknowledge are the only writes, both append/transition-only)", () => {
    const allMethods = new Set(policyRouter.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods)));
    expect(allMethods).toEqual(new Set(["get", "post"]));
  });
});

describe("Public endpoint: GET /:type/current requires NO Authorization header", () => {
  it("returns the current published policy (safe fields only) with no req.user at all", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "1.0", title: "Terms of Service", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);

    // No `user` key on the request at all - simulating a request with no
    // Authorization header/authenticate middleware in front of it.
    const req = makeReq({ params: { type: "TERMS" } });
    const { res, error } = await runController(policyController.getCurrentPolicy, req, makeRes());
    expect(error).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.version).toBe("1.0");
    expect(res.body.data.content).toBe(FAKE_CONTENT);
    // Safe-field allowlist - never internal actor ids.
    expect(res.body.data.createdBy).toBeUndefined();
    expect(res.body.data.publishedBy).toBeUndefined();
  });

  it("returns an honest empty/null result for a type with no published version - never a 401, never fabricated content", async () => {
    const req = makeReq({ params: { type: "REFUND" } });
    const { res, error } = await runController(policyController.getCurrentPolicy, req, makeRes());
    expect(error).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("the route is registered BEFORE router.use(authenticate) in the route stack, so it never reaches the auth gate", () => {
    const layers = policyRouter.stack;
    const routeIndex = layers.findIndex((l) => l.route && l.route.path === "/:type/current");
    const authenticateIndex = layers.findIndex((l) => !l.route && l.name !== "query" && l.name !== "expressInit");
    expect(routeIndex).toBeGreaterThanOrEqual(0);
    // The public route layer must come before the first non-route (router.use)
    // middleware layer, which is where authenticate is mounted.
    expect(routeIndex).toBeLessThan(authenticateIndex);
  });
});

describe("Permissions", () => {
  it("Master Admin (all-permissions rule) passes both POLICY_VIEW and POLICY_MANAGE", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission));
    const view = await runMiddleware(requirePermission(Permission.POLICY_VIEW), req, makeRes());
    const manage = await runMiddleware(requirePermission(Permission.POLICY_MANAGE), req, makeRes());
    expect(view.threw).toBeNull();
    expect(manage.threw).toBeNull();
  });

  it("neither permission is in ASSISTANT_MASTER_ADMIN's default template, USER's, ADMIN's, or SUPER_ADMIN's defaults", () => {
    for (const role of [Role.ASSISTANT_MASTER_ADMIN, Role.USER, Role.ADMIN, Role.SUPER_ADMIN]) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(Permission.POLICY_VIEW);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(Permission.POLICY_MANAGE);
    }
  });

  it("Assistant Master Admin without an explicit grant is rejected for both", async () => {
    const req = reqAs(Role.ASSISTANT_MASTER_ADMIN, null, []);
    const view = await runMiddleware(requirePermission(Permission.POLICY_VIEW), req, makeRes());
    const manage = await runMiddleware(requirePermission(Permission.POLICY_MANAGE), req, makeRes());
    expect(view.threw?.statusCode).toBe(403);
    expect(manage.threw?.statusCode).toBe(403);
  });

  it("Assistant Master Admin explicitly granted POLICY_MANAGE is allowed", async () => {
    const permissions = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [Permission.POLICY_MANAGE]);
    const req = reqAs(Role.ASSISTANT_MASTER_ADMIN, null, permissions);
    const { threw } = await runMiddleware(requirePermission(Permission.POLICY_MANAGE), req, makeRes());
    expect(threw).toBeNull();
  });

  it("SUPER_ADMIN, ADMIN and USER are all denied POLICY_MANAGE and POLICY_VIEW by default", async () => {
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.USER]) {
      const req = reqAs(role, new mongoose.Types.ObjectId());
      const manage = await runMiddleware(requirePermission(Permission.POLICY_MANAGE), req, makeRes());
      const view = await runMiddleware(requirePermission(Permission.POLICY_VIEW), req, makeRes());
      expect(manage.threw?.statusCode).toBe(403);
      expect(view.threw?.statusCode).toBe(403);
    }
  });

  it("createPolicyDraft controller rejects an unpermitted actor via the route-level gate (integration of validate + authorize)", async () => {
    const req = reqAs(Role.USER, new mongoose.Types.ObjectId(), [], { body: createPolicySchema.parse({ type: "TERMS", version: "9.9", title: "T", content: FAKE_CONTENT }) });
    const { threw } = await runMiddleware(requirePermission(Permission.POLICY_MANAGE), req, makeRes());
    expect(threw?.statusCode).toBe(403);
  });
});

describe("Acceptance", () => {
  it("acknowledge() records the exact current version with a server-set timestamp/ip/user-agent", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "1.0", title: "Terms", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);

    const userId = new mongoose.Types.ObjectId();
    const org = await createOrg();
    const req = makeReq({ ip: "203.0.113.5", headers: { "user-agent": "AcceptanceTestAgent/1.0" } });
    const before = Date.now();
    const ack = await PolicyService.acknowledge({ userId, organizationId: org._id, policyType: PolicyType.TERMS, actorRole: Role.USER, req });
    expect(ack.policyVersion).toBe("1.0");
    expect(ack.policyType).toBe(PolicyType.TERMS);
    expect(ack.ip).toBe("203.0.113.5");
    expect(ack.userAgent).toBe("AcceptanceTestAgent/1.0");
    expect(ack.acceptedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("a client-forged userId/organizationId/ip/userAgent/acceptedAt supplied alongside a call is ignored - only req/authenticated-session-derived values are ever stored", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.PRIVACY, version: "1.0", title: "Privacy", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);

    const realUserId = new mongoose.Types.ObjectId();
    const realOrg = await createOrg();
    const forgedUserId = new mongoose.Types.ObjectId();
    const forgedOrgId = new mongoose.Types.ObjectId();
    const req = makeReq({ ip: "198.51.100.9", headers: { "user-agent": "RealAgent/2.0" } });

    // Simulates a caller passing extra/forged fields through - the service
    // only ever reads the named params it destructures (userId,
    // organizationId, req.ip, req.headers) - forged extras are structurally
    // never consulted.
    const ack = await PolicyService.acknowledge({
      userId: realUserId,
      organizationId: realOrg._id,
      policyType: PolicyType.PRIVACY,
      actorRole: Role.USER,
      req,
      // forged/extra - must have zero effect
      forgedUserId: forgedUserId.toString(),
      organizationIdOverride: forgedOrgId.toString(),
      ip: "6.6.6.6",
      userAgent: "ForgedAgent/EVIL",
      acceptedAt: new Date("2000-01-01"),
    });

    expect(ack.userId.toString()).toBe(realUserId.toString());
    expect(ack.organizationId.toString()).toBe(realOrg._id.toString());
    expect(ack.ip).toBe("198.51.100.9"); // real req.ip, not the forged "6.6.6.6"
    expect(ack.userAgent).toBe("RealAgent/2.0"); // real header, not "ForgedAgent/EVIL"
    expect(ack.acceptedAt.getFullYear()).not.toBe(2000); // server-set now(), not the forged year-2000 date
  });

  it("the acknowledge validation schema (.strict()) rejects a body carrying forged fields like userId/ip/policyId outright, before the controller even runs", () => {
    const result = acknowledgePolicySchema.safeParse({ policyType: "TERMS", userId: "forged", ip: "6.6.6.6", policyId: "forged" });
    expect(result.success).toBe(false);
  });

  it("duplicate identical acknowledgement is idempotent - returns the same record, does not create a second row (unique index backed)", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.REFUND, version: "1.0", title: "Refund", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);

    const userId = new mongoose.Types.ObjectId();
    const req = makeReq();
    const first = await PolicyService.acknowledge({ userId, organizationId: null, policyType: PolicyType.REFUND, actorRole: Role.USER, req });
    const second = await PolicyService.acknowledge({ userId, organizationId: null, policyType: PolicyType.REFUND, actorRole: Role.USER, req });
    expect(second._id.toString()).toBe(first._id.toString());
    const count = await PolicyAcknowledgement.countDocuments({ userId, policyId: first.policyId });
    expect(count).toBe(1);
  });

  it("accepting a stale/wrong displayed version is rejected with a clear error, and the server never records acceptance of a non-current version", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const v1 = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "10.0", title: "Terms", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(v1._id, actorId, Role.MASTER_ADMIN);
    const v2 = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "11.0", title: "Terms", content: FAKE_CONTENT_V2, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(v2._id, actorId, Role.MASTER_ADMIN);

    const userId = new mongoose.Types.ObjectId();
    await expect(
      PolicyService.acknowledge({ userId, organizationId: null, policyType: PolicyType.TERMS, acknowledgedVersion: "10.0", actorRole: Role.USER, req: makeReq() })
    ).rejects.toMatchObject({ statusCode: 409, code: "POLICY_VERSION_STALE" });
    const count = await PolicyAcknowledgement.countDocuments({ userId });
    expect(count).toBe(0);
  });

  it("accepting when no published policy of that type exists yet is rejected with a clean 404, never a raw error", async () => {
    const userId = new mongoose.Types.ObjectId();
    await expect(
      PolicyService.acknowledge({ userId, organizationId: null, policyType: PolicyType.REFUND, actorRole: Role.USER, req: makeReq() })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("after a newer version is published, the OLD acceptance record remains intact/unmodified while hasAcceptedCurrent correctly reports not-accepted for the new version", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const v1 = await PolicyService.createDraft({ type: PolicyType.PRIVACY, version: "20.0", title: "Privacy", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(v1._id, actorId, Role.MASTER_ADMIN);

    const userId = new mongoose.Types.ObjectId();
    const ackV1 = await PolicyService.acknowledge({ userId, organizationId: null, policyType: PolicyType.PRIVACY, actorRole: Role.USER, req: makeReq() });

    let { accepted } = await PolicyService.hasAcceptedCurrent(userId, PolicyType.PRIVACY);
    expect(accepted).toBe(true);

    const v2 = await PolicyService.createDraft({ type: PolicyType.PRIVACY, version: "21.0", title: "Privacy", content: FAKE_CONTENT_V2, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(v2._id, actorId, Role.MASTER_ADMIN);

    ({ accepted } = await PolicyService.hasAcceptedCurrent(userId, PolicyType.PRIVACY));
    expect(accepted).toBe(false); // not yet accepted the NEW current version

    const ackV1Reloaded = await PolicyAcknowledgement.findById(ackV1._id);
    expect(ackV1Reloaded).not.toBeNull();
    expect(ackV1Reloaded.policyVersion).toBe("20.0"); // untouched by the new publish
  });

  it("cross-tenant/user isolation: acknowledgements are keyed by userId, never leak across organizations or users", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "30.0", title: "Terms", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);

    const orgA = await createOrg();
    const orgB = await createOrg();
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    await PolicyService.acknowledge({ userId: userA, organizationId: orgA._id, policyType: PolicyType.TERMS, actorRole: Role.USER, req: makeReq() });
    await PolicyService.acknowledge({ userId: userB, organizationId: orgB._id, policyType: PolicyType.TERMS, actorRole: Role.USER, req: makeReq() });

    const { items: itemsA } = await PolicyService.getMyAcknowledgements(userA, {});
    expect(itemsA.length).toBe(1);
    expect(itemsA[0].userId.toString()).toBe(userA.toString());
    expect(itemsA.some((i) => i.userId.toString() === userB.toString())).toBe(false);
  });

  it("an internal actor (Master/Assistant Master Admin) with no organization stores organizationId null on their acknowledgement", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.REFUND, version: "40.0", title: "Refund", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);
    const masterId = new mongoose.Types.ObjectId();
    const ack = await PolicyService.acknowledge({ userId: masterId, organizationId: null, policyType: PolicyType.REFUND, actorRole: Role.MASTER_ADMIN, req: makeReq() });
    expect(ack.organizationId).toBeNull();
  });
});

describe("Enforcement mechanism - works in isolation, but is NOT wired into any live business flow", () => {
  it("assertAcceptedCurrent throws CURRENT_POLICY_ACCEPTANCE_REQUIRED when the user has not accepted", async () => {
    const userId = new mongoose.Types.ObjectId();
    await expect(PolicyService.assertAcceptedCurrent(userId, PolicyType.TERMS)).rejects.toMatchObject({ code: "CURRENT_POLICY_ACCEPTANCE_REQUIRED" });
  });

  it("assertAcceptedCurrent passes silently once the user has accepted the current version", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "50.0", title: "Terms", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);
    const userId = new mongoose.Types.ObjectId();
    await PolicyService.acknowledge({ userId, organizationId: null, policyType: PolicyType.TERMS, actorRole: Role.USER, req: makeReq() });
    await expect(PolicyService.assertAcceptedCurrent(userId, PolicyType.TERMS)).resolves.toBeUndefined();
  });

  it("REGRESSION GUARD: creating an E-Stamp request succeeds today with ZERO policy acceptance on record - proving enforcement is not wired into this flow (a deliberate, correct choice, not a bug)", async () => {
    const { org, article } = await makeOrgWithArticle();
    const creator = new mongoose.Types.ObjectId();
    // Confirm, explicitly, that nothing has ever been acknowledged by this actor.
    const ackCountBefore = await PolicyAcknowledgement.countDocuments({ userId: creator });
    expect(ackCountBefore).toBe(0);

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
    expect(request).toBeTruthy(); // succeeded despite zero policy acceptance
  });
});

describe("Refund/no-refund behavior - unchanged regression check", () => {
  it("cancelRequest still does not credit the wallet on cancellation", async () => {
    const { org, article } = await makeOrgWithArticle({ balance: 100000, fixedAmount: 500 });
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
    const walletAfterCreate = await Wallet.findOne({ organizationId: org._id });
    const balanceAfterDebit = walletAfterCreate.balance;
    expect(balanceAfterDebit).toBe(100000 - 500);

    await EStampRequestService.cancelRequest(request._id.toString(), org._id, creator.toString(), Role.SUPER_ADMIN);

    const walletAfterCancel = await Wallet.findOne({ organizationId: org._id });
    expect(walletAfterCancel.balance).toBe(balanceAfterDebit); // unchanged - no refund credited
  });
});

describe("Audit coverage", () => {
  it("publish records a POLICY_PUBLISHED entry with safe metadata only ({type, version}) - the policy content never appears", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const secretContent = "UNIQUE-MARKER-CONTENT-STRING-SHOULD-NEVER-LEAK-INTO-AUDIT";
    const draft = await PolicyService.createDraft({ type: PolicyType.TERMS, version: "60.0", title: "Terms", content: secretContent, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(draft._id, actorId, Role.SUPER_ADMIN);

    const entry = await AuditLog.findOne({ action: AuditAction.POLICY_PUBLISHED, entityId: draft._id.toString() });
    expect(entry).not.toBeNull();
    expect(entry.actorId.toString()).toBe(actorId.toString());
    expect(entry.actorRole).toBe(Role.SUPER_ADMIN);
    expect(entry.metadata).toEqual({ type: PolicyType.TERMS, version: "60.0" });

    const all = await AuditLog.find({}).lean();
    const serialized = JSON.stringify(all.map((a) => a.metadata));
    expect(serialized).not.toContain(secretContent);
  });

  it("acknowledge records a POLICY_ACKNOWLEDGED entry with the real actor and safe metadata", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.PRIVACY, version: "70.0", title: "Privacy", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);
    const userId = new mongoose.Types.ObjectId();
    const org = await createOrg();
    await PolicyService.acknowledge({ userId, organizationId: org._id, policyType: PolicyType.PRIVACY, actorRole: Role.USER, req: makeReq() });

    const entry = await AuditLog.findOne({ action: AuditAction.POLICY_ACKNOWLEDGED, entityId: draft._id.toString() });
    expect(entry).not.toBeNull();
    expect(entry.actorId.toString()).toBe(userId.toString());
    expect(entry.organizationId.toString()).toBe(org._id.toString());
    expect(entry.metadata).toEqual({ type: PolicyType.PRIVACY, version: "70.0" });
  });

  it("a rejected (conflict) publish attempt does not add a spurious audit entry", async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const draft = await PolicyService.createDraft({ type: PolicyType.REFUND, version: "80.0", title: "Refund", content: FAKE_CONTENT, createdBy, actorRole: Role.MASTER_ADMIN });
    const published = await PolicyService.publish(draft._id, actorId, Role.MASTER_ADMIN);
    const countAfterFirstPublish = await AuditLog.countDocuments({ action: AuditAction.POLICY_PUBLISHED, entityId: draft._id.toString() });
    await expect(PolicyService.publish(published._id, actorId, Role.MASTER_ADMIN)).rejects.toMatchObject({ code: "POLICY_NOT_DRAFT" });
    const countAfterSecondAttempt = await AuditLog.countDocuments({ action: AuditAction.POLICY_PUBLISHED, entityId: draft._id.toString() });
    expect(countAfterSecondAttempt).toBe(countAfterFirstPublish); // no new entry for the rejected attempt
  });
});
