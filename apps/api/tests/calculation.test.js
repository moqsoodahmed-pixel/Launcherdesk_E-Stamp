import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Article, ArticleVersion } from "../src/models/index.js";
import { CalculationService } from "../src/services/calculation.service.js";

describe("Stamp duty calculation service", () => {
  it("computes a FIXED rule amount correctly, multiplied by number of e-stamps", async () => {
    const creator = new mongoose.Types.ObjectId();
    const article = await Article.create({
      stateCode: "KA",
      articleCode: "2(B)",
      title: "Administration Bond",
      createdBy: creator,
      currentVersion: 1,
    });
    await ArticleVersion.create({
      articleId: article._id,
      versionNumber: 1,
      calculationRule: { type: "FIXED", fixedAmount: 100 },
      createdBy: creator,
    });

    const result = await CalculationService.calculate({
      stateCode: "KA",
      articleId: article._id.toString(),
      considerationPrice: 0,
      numberOfEStamps: 3,
    });

    expect(result.amount).toBe(300);
  });

  it("computes a PERCENTAGE rule based on consideration price", async () => {
    const creator = new mongoose.Types.ObjectId();
    const article = await Article.create({
      stateCode: "MH",
      articleCode: "5(A)",
      title: "Agreement",
      createdBy: creator,
      currentVersion: 1,
    });
    await ArticleVersion.create({
      articleId: article._id,
      versionNumber: 1,
      calculationRule: { type: "PERCENTAGE", percentage: 1, minAmount: 100 },
      createdBy: creator,
    });

    const result = await CalculationService.calculate({
      stateCode: "MH",
      articleId: article._id.toString(),
      considerationPrice: 500000,
      numberOfEStamps: 1,
    });

    expect(result.amount).toBe(5000);
  });

  it("a CUSTOM rule (no official formula configured) uses the filer's own entered amount as the duty - never a guess, never silently 0 when they entered something", async () => {
    const creator = new mongoose.Types.ObjectId();
    const article = await Article.create({
      stateCode: "KA",
      articleCode: "30(1)(i)",
      title: "Lease of Immovable Property",
      createdBy: creator,
      currentVersion: 1,
    });
    await ArticleVersion.create({
      articleId: article._id,
      versionNumber: 1,
      calculationRule: { type: "CUSTOM" },
      createdBy: creator,
    });

    // The frontend labels this input "Stamp Duty" (not "Consideration
    // Price") for a CUSTOM article - whatever the filer enters there IS
    // the duty, multiplied by the number of e-stamps like any other rule.
    const entered = await CalculationService.calculate({
      stateCode: "KA",
      articleId: article._id.toString(),
      considerationPrice: 100,
      numberOfEStamps: 2,
    });
    expect(entered.amount).toBe(200);

    // Nothing entered yet (0) still means "not yet determinable" - the
    // preview/review screens already treat this as "At Actuals", not free.
    const blank = await CalculationService.calculate({
      stateCode: "KA",
      articleId: article._id.toString(),
      considerationPrice: 0,
      numberOfEStamps: 1,
    });
    expect(blank.amount).toBe(0);
  });
});
