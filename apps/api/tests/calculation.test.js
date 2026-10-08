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
});
