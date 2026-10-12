import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Article, ArticleVersion } from "../src/models/index.js";
import { applyKarnatakaFixedRates } from "../src/scripts/apply-karnataka-fixed-rates.js";

async function makeArticle(articleCode, creator) {
  return Article.create({ stateCode: "KA", articleCode, title: "placeholder", createdBy: creator, currentVersion: 1 });
}

describe("applyKarnatakaFixedRates - real fixed duty amounts from the StampMitra audit", () => {
  it("sets a FIXED calculationRule for a known article with no prior rule", async () => {
    const creator = new mongoose.Types.ObjectId();
    const article = await makeArticle("41(a)", creator);
    // No ArticleVersion exists yet for this article (CUSTOM/no-rule placeholder, as our seed leaves it).

    const result = await applyKarnatakaFixedRates(creator);

    expect(result.applied).toContainEqual({ articleCode: "41(a)", fixedAmount: 500, versionNumber: 1 });
    const version = await ArticleVersion.findOne({ articleId: article._id });
    expect(version.calculationRule).toEqual({ type: "FIXED", fixedAmount: 500 });
    const reloaded = await Article.findById(article._id);
    expect(reloaded.currentVersion).toBe(1);
  });

  it("is idempotent - a second run reports the article as already current and creates no new version", async () => {
    const creator = new mongoose.Types.ObjectId();
    await makeArticle("33", creator);

    await applyKarnatakaFixedRates(creator);
    const second = await applyKarnatakaFixedRates(creator);

    expect(second.applied).toEqual([]);
    expect(second.alreadyCurrent).toContain("33");
  });

  it("reports articles not present in our Karnataka catalog instead of creating them", async () => {
    const creator = new mongoose.Types.ObjectId();

    const result = await applyKarnatakaFixedRates(creator);

    expect(result.notFound).toContain("41(a)");
    const count = await Article.countDocuments({ stateCode: "KA" });
    expect(count).toBe(0);
  });

  it("bumps the version and updates the rule when an existing rule differs from the verified fixed amount", async () => {
    const creator = new mongoose.Types.ObjectId();
    const article = await makeArticle("17", creator);
    await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "CUSTOM" }, createdBy: creator });

    const result = await applyKarnatakaFixedRates(creator);

    expect(result.applied).toContainEqual({ articleCode: "17", fixedAmount: 2000, versionNumber: 2 });
    const reloaded = await Article.findById(article._id);
    expect(reloaded.currentVersion).toBe(2);
  });
});
