// This script previously ignored the source data's `isFixed` flag and wrote
// EVERY article as a FIXED rule using whatever generic state-wide minimum
// the row carried - e.g. all 94 Andhra Pradesh articles (Adoption Deed,
// Divorce, Power of Attorney, Conveyance...) got an identical fabricated
// Rs.100 duty. Only Karnataka's `isFixed: true` rows are a genuinely
// verified, article-specific amount. These tests pin the fix: isFixed
// decides FIXED vs CUSTOM, never the presence of a `price` value alone.
import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import fs from "fs";
import os from "os";
import path from "path";
import { Article, ArticleVersion, User } from "../src/models/index.js";
import { Role } from "@launcherdesk/shared";

async function withSeedData(rows, run) {
  // The script loads its fixture from a fixed path next to itself
  // (seed-data-all-articles.json) - swap it out for the duration of the
  // test and restore it, rather than editing the real 1,119-row file.
  const realPath = path.resolve("src/scripts/seed-data-all-articles.json");
  const backupPath = path.join(os.tmpdir(), `seed-data-backup-${Date.now()}.json`);
  fs.copyFileSync(realPath, backupPath);
  fs.writeFileSync(realPath, JSON.stringify(rows));
  try {
    delete require.cache[require.resolve("../src/scripts/seed-all-articles.js")];
    const { seedAllStatesAndArticles } = require("../src/scripts/seed-all-articles.js");
    return await run(seedAllStatesAndArticles);
  } finally {
    fs.copyFileSync(backupPath, realPath);
    fs.unlinkSync(backupPath);
  }
}

describe("seedAllStatesAndArticles - never fabricates a per-article duty from a state-wide minimum", () => {
  it("an isFixed:false row (a generic floor) is seeded as CUSTOM, not FIXED at that amount", async () => {
    const creator = await User.create({ name: "Seeder", email: `seeder-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN });
    const rows = [
      { stateCode: "ZZ", stateName: "Test State", articleCode: "1", title: "Adoption Deed", price: 100, isFixed: false },
      { stateCode: "ZZ", stateName: "Test State", articleCode: "2", title: "Divorce Deed", price: 100, isFixed: false },
    ];

    await withSeedData(rows, (seed) => seed(creator._id));

    for (const code of ["1", "2"]) {
      const article = await Article.findOne({ stateCode: "ZZ", articleCode: code });
      const version = await ArticleVersion.findOne({ articleId: article._id }).sort({ versionNumber: -1 });
      expect(version.calculationRule).toEqual({ type: "CUSTOM" });
      expect(article.description).toMatch(/not yet configured/);
    }
  });

  it("an isFixed:true row (a genuinely verified amount) is seeded as FIXED at that exact amount", async () => {
    const creator = await User.create({ name: "Seeder2", email: `seeder-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN });
    const rows = [{ stateCode: "ZZ", stateName: "Test State", articleCode: "41(a)", title: "Power of Attorney", price: 500, isFixed: true }];

    await withSeedData(rows, (seed) => seed(creator._id));

    const article = await Article.findOne({ stateCode: "ZZ", articleCode: "41(a)" });
    const version = await ArticleVersion.findOne({ articleId: article._id }).sort({ versionNumber: -1 });
    expect(version.calculationRule).toEqual({ type: "FIXED", fixedAmount: 500 });
    expect(article.description).toMatch(/Fixed Government Stamp Duty: Rs\.500/);
  });

  it("re-running corrects a previously-fabricated FIXED rule back to CUSTOM", async () => {
    const creator = await User.create({ name: "Seeder3", email: `seeder-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN });
    const article = await Article.create({ stateCode: "ZZ", articleCode: "9", title: "Conveyance", createdBy: creator._id, currentVersion: 1 });
    // Simulate the old buggy behaviour's leftover data.
    await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 100 }, createdBy: creator._id });

    const rows = [{ stateCode: "ZZ", stateName: "Test State", articleCode: "9", title: "Conveyance", price: 100, isFixed: false }];
    await withSeedData(rows, (seed) => seed(creator._id));

    const version = await ArticleVersion.findOne({ articleId: article._id }).sort({ versionNumber: -1 });
    expect(version.calculationRule).toEqual({ type: "CUSTOM" });
  });
});
