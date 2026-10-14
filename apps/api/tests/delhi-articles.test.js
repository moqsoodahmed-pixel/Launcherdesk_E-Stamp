import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Article } from "../src/models/index.js";
import { CalculationService } from "../src/services/calculation.service.js";
import { seedDelhiArticles } from "../src/scripts/seed-delhi-articles.js";

describe("Delhi article catalog - sourced from the audit PDFs, nothing invented", () => {
  it("seeds exactly 8 Delhi articles and is idempotent on re-run", async () => {
    const creator = new mongoose.Types.ObjectId();
    const first = await seedDelhiArticles(creator);
    expect(first.created).toBe(8);

    const second = await seedDelhiArticles(creator);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(8);

    const count = await Article.countDocuments({ stateCode: "DL" });
    expect(count).toBe(8);
  });

  it("23-A Sale Agreement calculates to its stated Rs.1 minimum - closing the gap the LauncherDesk audit flagged as missing", async () => {
    const creator = new mongoose.Types.ObjectId();
    await seedDelhiArticles(creator);
    const article = await Article.findOne({ stateCode: "DL", articleCode: "23-A" });
    expect(article).not.toBeNull();
    expect(article.title).toBe("Sale Agreement");

    const result = await CalculationService.calculate({
      stateCode: "DL",
      articleId: article._id.toString(),
      considerationPrice: 0,
      numberOfEStamps: 1,
    });
    expect(result.amount).toBe(1);
  });

  it("Affidavit and Declaration both resolve to the stated Rs.10 fixed rate", async () => {
    const creator = new mongoose.Types.ObjectId();
    await seedDelhiArticles(creator);
    const affidavit = await Article.findOne({ stateCode: "DL", articleCode: "4" });
    const declaration = await Article.findOne({ stateCode: "DL", articleCode: "4-DECL" });

    for (const article of [affidavit, declaration]) {
      const result = await CalculationService.calculate({
        stateCode: "DL",
        articleId: article._id.toString(),
        considerationPrice: 0,
        numberOfEStamps: 1,
      });
      expect(result.amount).toBe(10);
    }
  });

  it("General Agreement and Lease<1yr have no official rate - the filer's own entered amount becomes the duty, never a system guess", async () => {
    const creator = new mongoose.Types.ObjectId();
    await seedDelhiArticles(creator);
    for (const code of ["5", "35(c)(i)"]) {
      const article = await Article.findOne({ stateCode: "DL", articleCode: code });
      // Nothing entered yet (0) means "not yet determinable" - still 0, not
      // a guessed figure.
      const blank = await CalculationService.calculate({
        stateCode: "DL",
        articleId: article._id.toString(),
        considerationPrice: 0,
        numberOfEStamps: 1,
      });
      expect(blank.amount).toBe(0);
      // Whatever the filer enters (frontend labels this "Stamp Duty" for a
      // CUSTOM article, not "Consideration Price") IS the duty - the system
      // never computes or overrides it, it's their own declared figure.
      const entered = await CalculationService.calculate({
        stateCode: "DL",
        articleId: article._id.toString(),
        considerationPrice: 100000,
        numberOfEStamps: 1,
      });
      expect(entered.amount).toBe(100000);
    }
  });
});
