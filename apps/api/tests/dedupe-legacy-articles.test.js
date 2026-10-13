// Andaman, Delhi and Karnataka each had leftover articles from before the
// StampMitra audit import, seeded under an older code scheme but naming the
// exact same legal instrument (same state, same title) as one of the
// audit-sourced codes. That inflated those three states' catalogs past the
// audit's own counts (12/98/113) and showed the same instrument twice in
// the New Request and bulk-template dropdowns. These tests pin the fix:
// the legacy duplicate is deactivated (never deleted), the audit-sourced
// one stays active, and re-running the script is a no-op.
import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Article } from "../src/models/index.js";
import { dedupeLegacyArticles } from "../src/scripts/dedupe-legacy-articles.js";

describe("dedupeLegacyArticles - removes leftover pre-audit duplicate articles", () => {
  it("deactivates the known legacy duplicate codes for AN, DL and KA, leaving the audit-sourced code active", async () => {
    const creator = new mongoose.Types.ObjectId();
    const cases = [
      { stateCode: "AN", legacyCode: "ADOPTION-DEED", auditCode: "AN-RG-2", title: "Adoption Deed" },
      { stateCode: "DL", legacyCode: "4", auditCode: "DL-RG-78", title: "4 - Affidavit" },
      { stateCode: "KA", legacyCode: "40(A)", auditCode: "40 (A)", title: "40 (A) - Partnership - Constitution of Partnership" },
      { stateCode: "AP", legacyCode: "6(A)", auditCode: "6(A)(i)", title: "Agreement Where the value does not exceed Rs.5,000" },
    ];
    for (const { stateCode, legacyCode, auditCode, title } of cases) {
      await Article.create({ stateCode, articleCode: legacyCode, title, isActive: true, currentVersion: 1, createdBy: creator });
      await Article.create({ stateCode, articleCode: auditCode, title, isActive: true, currentVersion: 1, createdBy: creator });
    }

    const result = await dedupeLegacyArticles();
    expect(result.deactivatedCount).toBeGreaterThanOrEqual(3);

    for (const { stateCode, legacyCode, auditCode } of cases) {
      const legacy = await Article.findOne({ stateCode, articleCode: legacyCode });
      const audited = await Article.findOne({ stateCode, articleCode: auditCode });
      expect(legacy.isActive).toBe(false);
      expect(audited.isActive).toBe(true);
    }
  });

  it("is idempotent - running it twice deactivates nothing new the second time", async () => {
    const creator = new mongoose.Types.ObjectId();
    await Article.create({ stateCode: "AN", articleCode: "OTHERS", title: "Others", isActive: true, currentVersion: 1, createdBy: creator });

    const first = await dedupeLegacyArticles();
    expect(first.deactivatedCount).toBeGreaterThanOrEqual(1);

    const second = await dedupeLegacyArticles();
    expect(second.deactivatedCount).toBe(0);
  });

  it("never touches an article whose code isn't in the known legacy list", async () => {
    const creator = new mongoose.Types.ObjectId();
    const real = await Article.create({ stateCode: "AN", articleCode: "AN-RG-6", title: "Power of Attorney", isActive: true, currentVersion: 1, createdBy: creator });

    await dedupeLegacyArticles();

    const unchanged = await Article.findById(real._id);
    expect(unchanged.isActive).toBe(true);
  });

  // 41(A)(b) and 41(C)(b) share an identical short display label in the
  // audit ("Partnership in any other case") but are two distinct
  // partnership sub-clauses under different parent articles - the audit's
  // F15 duplicate-label finding does not list this pair, unlike the other
  // AP pairs it does flag. Deactivating one would silently delete a real,
  // distinct legal instrument, so both must stay active.
  it("never deactivates 41(A)(b)/41(C)(b) even though they share a display label - they are distinct articles, not a duplicate", async () => {
    const creator = new mongoose.Types.ObjectId();
    await Article.create({ stateCode: "AP", articleCode: "41 (A) (b)", title: "Partnership in any other case", isActive: true, currentVersion: 1, createdBy: creator });
    await Article.create({ stateCode: "AP", articleCode: "41 (C) (b)", title: "Partnership in any other case", isActive: true, currentVersion: 1, createdBy: creator });

    await dedupeLegacyArticles();

    const first = await Article.findOne({ stateCode: "AP", articleCode: "41 (A) (b)" });
    const second = await Article.findOne({ stateCode: "AP", articleCode: "41 (C) (b)" });
    expect(first.isActive).toBe(true);
    expect(second.isActive).toBe(true);
  });
});
