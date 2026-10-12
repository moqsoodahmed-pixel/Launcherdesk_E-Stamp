import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Article } from "../src/models/index.js";
import { seedAndamanKarnatakaArticles } from "../src/scripts/seed-andaman-karnataka-articles.js";

describe("Andaman & Karnataka articles - sourced from StampMitra_eStamp_Articles_and_Prices.pdf", () => {
  it("seeds exactly 12 Andaman articles and 19 additional Karnataka articles, idempotently", async () => {
    const creator = new mongoose.Types.ObjectId();
    const first = await seedAndamanKarnatakaArticles(creator);
    expect(first.created).toBe(31);

    const second = await seedAndamanKarnatakaArticles(creator);
    expect(second.created).toBe(0);

    const anCount = await Article.countDocuments({ stateCode: "AN" });
    const kaCount = await Article.countDocuments({ stateCode: "KA" });
    expect(anCount).toBe(12);
    expect(kaCount).toBe(19);

    const poa = await Article.findOne({ stateCode: "KA", articleCode: "41(a)" });
    expect(poa.title).toContain("Power of Attorney");
  });

  it("never overwrites the already-seeded, rated Karnataka 41(e)/41(eb) articles", async () => {
    const creator = new mongoose.Types.ObjectId();
    const { Article: ArticleModel, ArticleVersion } = await import("../src/models/index.js");
    const existing = await ArticleModel.create({ stateCode: "KA", articleCode: "41(e)", title: "Power of Attorney, authorising sale of property", createdBy: creator, currentVersion: 1 });
    await ArticleVersion.create({ articleId: existing._id, versionNumber: 1, calculationRule: { type: "PERCENTAGE", percentage: 5 }, createdBy: creator });

    await seedAndamanKarnatakaArticles(creator);

    const stillThere = await ArticleModel.findById(existing._id);
    expect(stillThere).not.toBeNull();
    const version = await ArticleVersion.findOne({ articleId: existing._id });
    expect(version.calculationRule.type).toBe("PERCENTAGE");
  });
});
