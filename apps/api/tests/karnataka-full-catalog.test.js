import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Article } from "../src/models/index.js";
import { seedKarnatakaFullCatalog } from "../src/scripts/seed-karnataka-full-catalog.js";

describe("Karnataka full article catalog - sourced from the user's row-aligned export", () => {
  it("adds exactly 88 new articles without duplicating or overwriting the 22 already seeded", async () => {
    const creator = new mongoose.Types.ObjectId();
    // Simulate the 22 articles already present from earlier seeds.
    const existingCodes = ["2(B)", "39(a)(1)", "39(a)(2)", "39(b)", "39(c)", "39(d)", "40(A)", "40(B)(b)", "40(C)", "40(C)(b)", "40A(a)", "40A(b)", "40B", "41(a)", "41(b)", "41(c)", "41(d)", "41(e)", "41(eb)", "41(f)", "41(g)", "41(h)"];
    for (const code of existingCodes) {
      await Article.create({ stateCode: "KA", articleCode: code, title: "placeholder", createdBy: creator, currentVersion: 1 });
    }

    const result = await seedKarnatakaFullCatalog(creator);
    expect(result.created).toBe(88);
    expect(result.skipped).toBe(0);

    const total = await Article.countDocuments({ stateCode: "KA" });
    expect(total).toBe(110);

    // Re-running never duplicates.
    const second = await seedKarnatakaFullCatalog(creator);
    expect(second.created).toBe(0);
    const totalAfterRerun = await Article.countDocuments({ stateCode: "KA" });
    expect(totalAfterRerun).toBe(110);
  });
});
