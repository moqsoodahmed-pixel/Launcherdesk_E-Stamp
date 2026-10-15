import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Organization, Wallet, Article, ArticleVersion, User, BulkEStampBatchItem, EStampRequest } from "../src/models/index.js";
import { Role, OrganizationStatus } from "@launcherdesk/shared";
import { BulkEStampService } from "../src/services/bulk-estamp.service.js";
import { CalculationService } from "../src/services/calculation.service.js";

const HEADERS = [
  "stateCode",
  "articleId",
  "firstParty",
  "secondParty",
  "descriptionOfDocument",
  "propertyDescription",
  "stampDuty",
  "additionalAmount",
  "stampDutyPaidBy",
  "numberOfEStamps",
];

function csvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function buildCsv(rows, headers = HEADERS) {
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))];
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}
function rowFor(article, overrides = {}) {
  const merged = {
    stateCode: "KA",
    articleId: article._id.toString(),
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Bulk manual duty agreement",
    propertyDescription: "Plot 1",
    stampDuty: 0,
    additionalAmount: 0,
    numberOfEStamps: 1,
    ...overrides,
  };
  if (merged.stampDutyPaidBy === undefined) merged.stampDutyPaidBy = merged.firstParty;
  return merged;
}
async function makeOrgWithArticle({ balance = 100000, ruleType = "FIXED", fixedAmount = 500, percentage, orgName = "Manual Duty Co" } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: orgName,
    contactEmail: `manual-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `MD-${new mongoose.Types.ObjectId()}`, title: "Manual Duty Article", createdBy: creator, currentVersion: 1 });
  const rule = ruleType === "PERCENTAGE" ? { type: "PERCENTAGE", percentage } : { type: "FIXED", fixedAmount };
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: rule, createdBy: creator });
  const user = await User.create({ name: "Manual Duty User", email: `manualuser-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.SUPER_ADMIN, organizationId: org._id });
  return { org, article, user, creator };
}
async function upload({ org, user, buffer }) {
  return BulkEStampService.uploadBatch({
    organizationId: org._id,
    createdBy: user._id,
    actorRole: Role.SUPER_ADMIN,
    fileBuffer: buffer,
    mimeType: "text/csv",
    originalFileName: "manual.csv",
  });
}

describe("CalculationService.calculate - manualStampDuty / additionalAmount (bulk only)", () => {
  it("a FIXED-rule article always uses its real fixed amount, ignoring any manualStampDuty typed for it", async () => {
    const { article } = await makeOrgWithArticle({ ruleType: "FIXED", fixedAmount: 500 });
    const result = await CalculationService.calculate({
      stateCode: "KA",
      articleId: article._id.toString(),
      manualStampDuty: 999999, // attempted override - must be ignored
      numberOfEStamps: 1,
    });
    expect(result.amount).toBe(500);
  });

  it("additionalAmount tops up a FIXED-rule article's duty beyond its locked base amount", async () => {
    const { article } = await makeOrgWithArticle({ ruleType: "FIXED", fixedAmount: 500 });
    const result = await CalculationService.calculate({
      stateCode: "KA",
      articleId: article._id.toString(),
      manualStampDuty: 999999,
      additionalAmount: 250,
      numberOfEStamps: 1,
    });
    expect(result.amount).toBe(750);
  });

  it("a PERCENTAGE-rule article uses manualStampDuty directly, bypassing the % formula entirely", async () => {
    const { article } = await makeOrgWithArticle({ ruleType: "PERCENTAGE", percentage: 10 });
    const result = await CalculationService.calculate({
      stateCode: "KA",
      articleId: article._id.toString(),
      manualStampDuty: 1234,
      numberOfEStamps: 1,
    });
    expect(result.amount).toBe(1234);
  });

  it("without manualStampDuty, a PERCENTAGE-rule article still computes from considerationPrice exactly as before (default behavior unaffected)", async () => {
    const { article } = await makeOrgWithArticle({ ruleType: "PERCENTAGE", percentage: 10 });
    const result = await CalculationService.calculate({
      stateCode: "KA",
      articleId: article._id.toString(),
      considerationPrice: 10000,
      numberOfEStamps: 1,
    });
    expect(result.amount).toBe(1000);
  });
});

describe("Bulk upload - manual Stamp Duty column end to end", () => {
  it("for a FIXED article, confirmBatch charges the real fixed amount regardless of what was typed in the Stamp Duty column", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 5000, ruleType: "FIXED", fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article, { stampDuty: 1 })]); // tries to lowball a fixed-rate article
    const { batch } = await upload({ org, user, buffer });
    const result = await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(result.batch.status).toBe("COMPLETED");
    const request = await EStampRequest.findOne({ organizationId: org._id });
    expect(request.calculatedStampDuty).toBe(500);
  });

  it("additionalAmount lets a filer pay more than a FIXED article's base duty", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 5000, ruleType: "FIXED", fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article, { additionalAmount: 300 })]);
    const { batch } = await upload({ org, user, buffer });
    const result = await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(result.batch.status).toBe("COMPLETED");
    const request = await EStampRequest.findOne({ organizationId: org._id });
    expect(request.calculatedStampDuty).toBe(800);
  });

  it("for a non-FIXED article, the typed Stamp Duty value IS the duty charged", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 5000, ruleType: "PERCENTAGE", percentage: 10 });
    const buffer = buildCsv([rowFor(article, { stampDuty: 777 })]);
    const { batch } = await upload({ org, user, buffer });
    const result = await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(result.batch.status).toBe("COMPLETED");
    const request = await EStampRequest.findOne({ organizationId: org._id });
    expect(request.calculatedStampDuty).toBe(777);
  });

  it("the preview-stage estimate already reflects the fixed-amount override (never the typed lowball value)", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 5000, ruleType: "FIXED", fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article, { stampDuty: 1 })]);
    const { batch } = await upload({ org, user, buffer });
    const item = await BulkEStampBatchItem.findOne({ batchId: batch._id, rowNumber: 1 });
    expect(item.status).toBe("VALID");
    expect(item.calculatedAmount).toBe(500);
  });
});
