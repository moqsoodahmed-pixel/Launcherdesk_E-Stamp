import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Article, ArticleVersion } from "../src/models/index.js";
import { Role } from "@launcherdesk/shared";
import * as paymentController from "../src/controllers/payment.controller.js";
import { SettingsService } from "../src/services/settings.service.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";

function reqAsTenant(overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: new mongoose.Types.ObjectId().toString(), permissions: [] }, ...overrides });
}

async function makeFixedArticle(stateCode, articleCode, title, fixedAmount) {
  const creator = new mongoose.Types.ObjectId();
  const article = await Article.create({ stateCode, articleCode, title, createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  return article;
}

describe("GET /payments/topup-config", () => {
  it("defaults to the registry minimum with no reference articles configured", async () => {
    const { res, error } = await runController(paymentController.getTopupConfig, reqAsTenant(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.minAmount).toBe(1117);
    expect(res.body.data.referenceArticles).toEqual([]);
  });

  it("reflects a Master-Admin-lowered minimum immediately", async () => {
    await SettingsService.updateSetting({ key: "MIN_WALLET_TOPUP", value: 500, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });
    const { res, error } = await runController(paymentController.getTopupConfig, reqAsTenant(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.minAmount).toBe(500);
  });

  it("includes a configured FIXED-rule reference article with its real duty amount and state name", async () => {
    const article = await makeFixedArticle("KA", "30(1)(i)", "Lease of Immovable Property", 500);
    await SettingsService.updateSetting({ key: "WALLET_TOPUP_REFERENCE_ARTICLE_IDS", value: article._id.toString(), actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });

    const { res, error } = await runController(paymentController.getTopupConfig, reqAsTenant(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.referenceArticles).toHaveLength(1);
    const ref = res.body.data.referenceArticles[0];
    expect(ref.articleCode).toBe("30(1)(i)");
    expect(ref.title).toBe("Lease of Immovable Property");
    expect(ref.stateCode).toBe("KA");
    expect(ref.stateName).toBe("Karnataka");
    expect(ref.dutyAmount).toBe(500);
  });

  it("supports multiple reference articles, in the configured order, and skips a deactivated one", async () => {
    const articleA = await makeFixedArticle("KA", "30(1)(i)", "Lease A", 500);
    const articleB = await makeFixedArticle("MH", "5(A)", "Agreement B", 300);
    const deactivated = await makeFixedArticle("DL", "99", "Deactivated Article", 100);
    deactivated.isActive = false;
    await deactivated.save();

    await SettingsService.updateSetting({
      key: "WALLET_TOPUP_REFERENCE_ARTICLE_IDS",
      value: `${articleB._id},${articleA._id},${deactivated._id}`,
      actorId: new mongoose.Types.ObjectId(),
      actorRole: Role.MASTER_ADMIN,
    });

    const { res, error } = await runController(paymentController.getTopupConfig, reqAsTenant(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.referenceArticles).toHaveLength(2);
    expect(res.body.data.referenceArticles[0].articleCode).toBe("5(A)");
    expect(res.body.data.referenceArticles[1].articleCode).toBe("30(1)(i)");
  });

  it("a non-FIXED-rule reference article reports a null duty amount, never a guess", async () => {
    const creator = new mongoose.Types.ObjectId();
    const article = await Article.create({ stateCode: "MH", articleCode: "5(A)", title: "Agreement", createdBy: creator, currentVersion: 1 });
    await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "PERCENTAGE", percentage: 1 }, createdBy: creator });
    await SettingsService.updateSetting({ key: "WALLET_TOPUP_REFERENCE_ARTICLE_IDS", value: article._id.toString(), actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });

    const { res, error } = await runController(paymentController.getTopupConfig, reqAsTenant(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.referenceArticles[0].dutyAmount).toBeNull();
  });
});
