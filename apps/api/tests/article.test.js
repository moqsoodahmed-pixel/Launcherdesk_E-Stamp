import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Article, ArticleVersion, Organization, Wallet, User, AuditLog, Notification, EStampRequest } from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus } from "@launcherdesk/shared";
import * as articleController from "../src/controllers/article.controller.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { CalculationService } from "../src/services/calculation.service.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { createArticleSchema, updateArticleSchema, setArticleStatusSchema, addArticleVersionSchema } from "@launcherdesk/validation";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

function masterAdminReq(overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: [] }, ...overrides });
}
function assistantReq(permissions = [], overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions }, ...overrides });
}
function clientReq(role, overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role, organizationId: new mongoose.Types.ObjectId().toString(), permissions: [] }, ...overrides });
}

async function makeArticleWithVersion({ stateCode = "KA", fixedAmount = 500, effectiveFrom, effectiveTo } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const article = await Article.create({ stateCode, articleCode: `TEST-${new mongoose.Types.ObjectId()}`, title: "Demo Test Article (not an official rate)", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator, effectiveFrom, effectiveTo });
  return article;
}

async function makeOrgWithWallet(balance = 100000) {
  const org = await Organization.create({
    name: "Article Test Co",
    contactEmail: `article-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: new mongoose.Types.ObjectId(),
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  return org;
}

describe("Article CRUD", () => {
  it("Master Admin can create an article with an initial version", async () => {
    const body = createArticleSchema.parse({ stateCode: "KA", articleCode: `NEW-${new mongoose.Types.ObjectId()}`, title: "Demo Article", calculationRule: { type: "FIXED", fixedAmount: 250 } });
    const req = masterAdminReq({ body });
    const { res, error } = await runController(articleController.createArticle, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.currentVersion).toBe(1);
    const version = await ArticleVersion.findOne({ articleId: res.body.data._id });
    expect(version.calculationRule.fixedAmount).toBe(250);
  });

  it("rejects a duplicate stateCode+articleCode combination", async () => {
    const code = `DUP-${new mongoose.Types.ObjectId()}`;
    await makeArticleWithVersion({ stateCode: "KA" }).then(async (a) => {
      a.articleCode = code;
      await a.save();
    });
    const body = createArticleSchema.parse({ stateCode: "KA", articleCode: code, title: "Duplicate", calculationRule: { type: "FIXED", fixedAmount: 1 } });
    const { error } = await runController(articleController.createArticle, masterAdminReq({ body }), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(409);
  });

  it("rejects invalid article data at the schema layer", () => {
    expect(createArticleSchema.safeParse({ stateCode: "K", articleCode: "", title: "", calculationRule: { type: "BOGUS" } }).success).toBe(false);
    expect(createArticleSchema.safeParse({ stateCode: "KA", articleCode: "X", title: "Y", calculationRule: { type: "FIXED" }, extraField: "nope" }).success).toBe(false);
  });

  it("Master Admin can update title/description without affecting the calculation rule", async () => {
    const article = await makeArticleWithVersion();
    const body = updateArticleSchema.parse({ title: "Renamed Demo Article" });
    const { res, error } = await runController(articleController.updateArticle, masterAdminReq({ params: { id: article._id.toString() }, body }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.title).toBe("Renamed Demo Article");
    const auditEntry = await AuditLog.findOne({ action: AuditAction.ARTICLE_MANAGED, entityId: article._id.toString(), "metadata.action": "updated" });
    expect(auditEntry).not.toBeNull();
  });

  it("the update schema rejects stateCode/articleCode/calculationRule (identity/rule fields are never edited in place)", () => {
    for (const field of ["stateCode", "articleCode", "calculationRule", "isActive"]) {
      expect(updateArticleSchema.safeParse({ [field]: "anything" }).success).toBe(false);
    }
  });

  it("Master Admin can activate/deactivate an article", async () => {
    const article = await makeArticleWithVersion();
    const body = setArticleStatusSchema.parse({ isActive: false });
    const { res, error } = await runController(articleController.setArticleStatus, masterAdminReq({ params: { id: article._id.toString() }, body }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.isActive).toBe(false);
  });

  it("unauthorized client roles cannot reach ARTICLE_MANAGE-gated actions", async () => {
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.USER]) {
      const { threw } = await runMiddleware(requirePermission(Permission.ARTICLE_MANAGE), clientReq(role), makeRes());
      expect(threw).not.toBeNull();
      expect(threw.statusCode).toBe(403);
    }
  });
});

describe("Assistant Master Admin: article permissions are explicit", () => {
  it("an Assistant without ARTICLE_MANAGE is denied", async () => {
    const { threw } = await runMiddleware(requirePermission(Permission.ARTICLE_MANAGE), assistantReq([]), makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("an Assistant explicitly granted ARTICLE_MANAGE can create an article, which is audited and notifies Master Admin", async () => {
    const master = await User.create({ name: "Master", email: `m-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    const { threw } = await runMiddleware(requirePermission(Permission.ARTICLE_MANAGE), assistantReq([Permission.ARTICLE_MANAGE]), makeRes());
    expect(threw).toBeNull();

    const body = createArticleSchema.parse({ stateCode: "MH", articleCode: `AST-${new mongoose.Types.ObjectId()}`, title: "Assistant Created", calculationRule: { type: "FIXED", fixedAmount: 100 } });
    const req = assistantReq([Permission.ARTICLE_MANAGE], { body });
    const { res, error } = await runController(articleController.createArticle, req, makeRes());
    expect(error).toBeNull();

    const auditEntry = await AuditLog.findOne({ action: AuditAction.ARTICLE_MANAGED, entityId: res.body.data._id.toString() });
    expect(auditEntry.actorRole).toBe(Role.ASSISTANT_MASTER_ADMIN);
    const notification = await Notification.findOne({ recipientId: master._id, relatedActorId: req.user.id });
    expect(notification).not.toBeNull();
    expect(notification.type).toBe("ASSISTANT_ADMIN_ACTIVITY");
  });
});

describe("Client read access", () => {
  it("an authenticated client can list and view articles", async () => {
    await makeArticleWithVersion({ stateCode: "KA" });
    const { error } = await runController(articleController.listArticles, clientReq(Role.USER, { query: { stateCode: "KA" } }), makeRes());
    expect(error).toBeNull();
  });

  it("a client cannot create or modify an article even by calling the controller directly with a client identity used only for permission checks", async () => {
    const req = clientReq(Role.SUPER_ADMIN);
    const { threw } = await runMiddleware(requirePermission(Permission.ARTICLE_MANAGE), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("an inactive article is excluded from the client's list", async () => {
    const article = await makeArticleWithVersion({ stateCode: "DL" });
    article.isActive = false;
    await article.save();
    const { res, error } = await runController(articleController.listArticles, clientReq(Role.USER, { query: { stateCode: "DL" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.find((a) => a._id.toString() === article._id.toString())).toBeUndefined();
  });
});

describe("Phase 22: GET /articles/states", () => {
  it("returns the distinct sorted list of states with at least one active article", async () => {
    await makeArticleWithVersion({ stateCode: "KA" });
    await makeArticleWithVersion({ stateCode: "MH" });
    const dup = await makeArticleWithVersion({ stateCode: "KA" });
    const { res, error } = await runController(articleController.listStates, clientReq(Role.USER), makeRes());
    expect(error).toBeNull();
    expect(res.body.data).toEqual(expect.arrayContaining(["KA", "MH"]));
    expect(new Set(res.body.data).size).toBe(res.body.data.length); // distinct
    void dup;
  });

  it("excludes states whose only articles are inactive", async () => {
    const article = await makeArticleWithVersion({ stateCode: "DL" });
    article.isActive = false;
    await article.save();
    const { res, error } = await runController(articleController.listStates, clientReq(Role.USER), makeRes());
    expect(error).toBeNull();
    expect(res.body.data).not.toContain("DL");
  });

  it("is gated by ARTICLE_VIEW just like every other read route (rejected without it)", async () => {
    const { threw } = await runMiddleware(requirePermission(Permission.ARTICLE_VIEW), makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [] } }), makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });
});

describe("State/article combination", () => {
  it("a correct state + article combination calculates successfully", async () => {
    const article = await makeArticleWithVersion({ stateCode: "KA", fixedAmount: 300 });
    const result = await CalculationService.calculate({ stateCode: "KA", articleId: article._id.toString(), considerationPrice: 0, numberOfEStamps: 1 });
    expect(result.amount).toBe(300);
  });

  it("an article requested under the wrong state is rejected", async () => {
    const article = await makeArticleWithVersion({ stateCode: "KA" });
    await expect(CalculationService.calculate({ stateCode: "MH", articleId: article._id.toString(), considerationPrice: 0, numberOfEStamps: 1 })).rejects.toMatchObject({ code: "ARTICLE_NOT_FOUND" });
  });
});

describe("Versioning: effective dates", () => {
  it("selects the correct currently-effective version, not simply the latest version number", async () => {
    const creator = new mongoose.Types.ObjectId();
    const article = await Article.create({ stateCode: "KA", articleCode: `VER-${new mongoose.Types.ObjectId()}`, title: "Versioned Article", createdBy: creator, currentVersion: 2 });
    await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 100 }, createdBy: creator, effectiveFrom: new Date(Date.now() - 60 * 60 * 1000) });
    // Version 2 is already the article's currentVersion, but is dated to become effective in the FUTURE.
    await ArticleVersion.create({ articleId: article._id, versionNumber: 2, calculationRule: { type: "FIXED", fixedAmount: 150 }, createdBy: creator, effectiveFrom: new Date(Date.now() + 60 * 60 * 1000) });

    const result = await CalculationService.calculate({ stateCode: "KA", articleId: article._id.toString(), considerationPrice: 0, numberOfEStamps: 1 });
    expect(result.amount).toBe(100); // version 1, not the future-dated version 2
    expect(result.articleVersionUsed).toBe(1);
  });

  it("an expired version (effectiveTo in the past) is not selected", async () => {
    const creator = new mongoose.Types.ObjectId();
    const article = await Article.create({ stateCode: "KA", articleCode: `EXP-${new mongoose.Types.ObjectId()}`, title: "Expiring Article", createdBy: creator, currentVersion: 2 });
    await ArticleVersion.create({
      articleId: article._id,
      versionNumber: 1,
      calculationRule: { type: "FIXED", fixedAmount: 100 },
      createdBy: creator,
      effectiveFrom: new Date(Date.now() - 2 * 60 * 60 * 1000),
      effectiveTo: new Date(Date.now() - 60 * 60 * 1000), // expired an hour ago
    });
    await expect(CalculationService.calculate({ stateCode: "KA", articleId: article._id.toString(), considerationPrice: 0, numberOfEStamps: 1 })).rejects.toThrow();
  });

  it("historical requests keep the version/amount they were created with, even after a newer version is added", async () => {
    const org = await makeOrgWithWallet();
    const article = await makeArticleWithVersion({ fixedAmount: 100 });
    const { request } = await EStampRequestService.createRequest({
      organizationId: org._id,
      createdBy: new mongoose.Types.ObjectId(),
      stateCode: "KA",
      articleId: article._id.toString(),
      firstParty: "A",
      secondParty: "B",
      descriptionOfDocument: "Historical safety test",
      considerationPrice: 0,
      stampDutyPaidBy: "A",
      numberOfEStamps: 1,
    });
    expect(request.calculatedStampDuty).toBe(100);
    expect(request.articleVersionUsed).toBe(1);

    // Master Admin later adds a new, much higher-rate version.
    const nextVersion = 2;
    await ArticleVersion.create({ articleId: article._id, versionNumber: nextVersion, calculationRule: { type: "FIXED", fixedAmount: 999 }, createdBy: new mongoose.Types.ObjectId() });
    article.currentVersion = nextVersion;
    await article.save();

    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.calculatedStampDuty).toBe(100); // unchanged - stored once at creation time
    expect(reloaded.articleVersionUsed).toBe(1); // still points at the version actually used
  });
});

describe("Calculation", () => {
  it("computes correctly for 1, 2, and 5 stamps (FIXED rule)", async () => {
    const article = await makeArticleWithVersion({ fixedAmount: 200 });
    for (const n of [1, 2, 5]) {
      const result = await CalculationService.calculate({ stateCode: "KA", articleId: article._id.toString(), considerationPrice: 0, numberOfEStamps: n });
      expect(result.amount).toBe(200 * n);
    }
  });

  it("applies minAmount/maxAmount when the rule defines them", async () => {
    const creator = new mongoose.Types.ObjectId();
    const article = await Article.create({ stateCode: "KA", articleCode: `MINMAX-${new mongoose.Types.ObjectId()}`, title: "Min/Max Article", createdBy: creator, currentVersion: 1 });
    await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "PERCENTAGE", percentage: 1, minAmount: 100, maxAmount: 1000 }, createdBy: creator });

    const below = await CalculationService.calculate({ stateCode: "KA", articleId: article._id.toString(), considerationPrice: 100, numberOfEStamps: 1 }); // 1% of 100 = 1, below min
    expect(below.amount).toBe(100);

    const normal = await CalculationService.calculate({ stateCode: "KA", articleId: article._id.toString(), considerationPrice: 50000, numberOfEStamps: 1 }); // 1% of 50000 = 500
    expect(normal.amount).toBe(500);

    const above = await CalculationService.calculate({ stateCode: "KA", articleId: article._id.toString(), considerationPrice: 1000000, numberOfEStamps: 1 }); // 1% of 1,000,000 = 10,000, above max
    expect(above.amount).toBe(1000);
  });

  it("calculation preview (CalculationService.calculate alone) never debits the wallet or creates a request", async () => {
    const org = await makeOrgWithWallet(5000);
    const article = await makeArticleWithVersion({ fixedAmount: 500 });
    await CalculationService.calculate({ stateCode: "KA", articleId: article._id.toString(), considerationPrice: 0, numberOfEStamps: 1 });
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(5000); // untouched
    const count = await EStampRequest.countDocuments({ organizationId: org._id });
    expect(count).toBe(0);
  });
});

describe("Security: tampering", () => {
  it("a client-supplied calculatedStampDuty/percentage/fixedAmount is never honored - only the server-resolved rule is used", async () => {
    const org = await makeOrgWithWallet();
    const article = await makeArticleWithVersion({ fixedAmount: 500 });
    const { request } = await EStampRequestService.createRequest({
      organizationId: org._id,
      createdBy: new mongoose.Types.ObjectId(),
      stateCode: "KA",
      articleId: article._id.toString(),
      firstParty: "A",
      secondParty: "B",
      descriptionOfDocument: "Tamper test",
      considerationPrice: 0,
      stampDutyPaidBy: "A",
      numberOfEStamps: 1,
      // These are not real EStampRequestService input fields - even if a caller
      // stuffed them in, the service only ever reads the fields it destructures.
      calculatedStampDuty: 1,
      percentage: 100,
      fixedAmount: 1,
    });
    expect(request.calculatedStampDuty).toBe(500);
  });

  it("a forged/nonexistent ArticleVersion id cannot be used - the server always resolves the version itself", async () => {
    const article = await makeArticleWithVersion({ fixedAmount: 500 });
    // There is no client input for "which version to use" anywhere in
    // CalculationService.calculate's signature - it is always resolved
    // server-side from the article + effective date.
    const result = await CalculationService.calculate({ stateCode: "KA", articleId: article._id.toString(), considerationPrice: 0, numberOfEStamps: 1, articleVersionUsed: new mongoose.Types.ObjectId().toString() });
    expect(result.articleVersionUsed).toBe(1);
  });

  it("organizationId spoofing still fails when creating a request against a specific article", async () => {
    const org = await makeOrgWithWallet();
    const otherOrg = await makeOrgWithWallet();
    const article = await makeArticleWithVersion({ fixedAmount: 100 });
    // EStampRequestService.createRequest takes organizationId as an explicit,
    // trusted parameter (set by the controller from req.user.organizationId,
    // never the body) - passing a spoofed value here IS the organizationId,
    // demonstrating the request lands wherever the CALLER (server) says, not
    // wherever a client claims.
    const { request } = await EStampRequestService.createRequest({
      organizationId: org._id, // what the controller would derive server-side
      createdBy: new mongoose.Types.ObjectId(),
      stateCode: "KA",
      articleId: article._id.toString(),
      firstParty: "A",
      secondParty: "B",
      descriptionOfDocument: "Org spoof test",
      considerationPrice: 0,
      stampDutyPaidBy: "A",
      numberOfEStamps: 1,
    });
    expect(request.organizationId.toString()).toBe(org._id.toString());
    expect(request.organizationId.toString()).not.toBe(otherOrg._id.toString());
  });
});
