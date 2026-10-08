import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import XLSX from "xlsx";
import {
  Organization,
  Wallet,
  Article,
  ArticleVersion,
  User,
  AuditLog,
  Notification,
  EStampRequest,
  EStampOrder,
  BulkEStampBatch,
  BulkEStampBatchItem,
} from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus, OrderStatus, getEffectivePermissions } from "@launcherdesk/shared";
import { BulkEStampService } from "../src/services/bulk-estamp.service.js";
import * as bulkController from "../src/controllers/bulk-estamp.controller.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { getWalletBalance } from "../src/services/wallet.service.js";
import { SettingsService } from "../src/services/settings.service.js";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

const HEADERS = [
  "stateCode",
  "articleId",
  "firstParty",
  "secondParty",
  "descriptionOfDocument",
  "propertyDescription",
  "considerationPrice",
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

function buildXlsx(rows, headers = HEADERS) {
  const wb = XLSX.utils.book_new();
  const aoa = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? null))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function rowFor(article, overrides = {}) {
  return {
    stateCode: "KA",
    articleId: article._id.toString(),
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Bulk agreement",
    propertyDescription: "Plot 1",
    considerationPrice: 0,
    stampDutyPaidBy: "Alice",
    numberOfEStamps: 1,
    ...overrides,
  };
}

async function makeOrgWithArticle({ balance = 100000, fixedAmount = 500, orgName = "Bulk Test Co" } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: orgName,
    contactEmail: `bulk-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `BULK-${new mongoose.Types.ObjectId()}`, title: "Bulk Test Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  const user = await User.create({ name: "Bulk User", email: `bulkuser-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.SUPER_ADMIN, organizationId: org._id });
  return { org, article, user, creator };
}

async function upload({ org, user, buffer, mimeType, fileName }) {
  return BulkEStampService.uploadBatch({
    organizationId: org._id,
    createdBy: user._id,
    actorRole: Role.SUPER_ADMIN,
    fileBuffer: buffer,
    mimeType,
    originalFileName: fileName,
  });
}

async function expectStructuralFailure(promise, code) {
  let caught;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  expect(caught.statusCode).toBe(400);
  if (code) expect(caught.code).toBe(code);
  return caught;
}

describe("Upload - file parsing", () => {
  it("a valid CSV upload creates the batch and one item per row", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(article, { considerationPrice: 1000 }), rowFor(article, { firstParty: "Carl", considerationPrice: 2000 })]);
    const { batch, items } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "batch.csv" });
    expect(batch.status).toBe("PREVIEW_READY");
    expect(batch.fileType).toBe("CSV");
    expect(items).toBe(2);
    expect(batch.totalRows).toBe(2);
    expect(batch.validRows).toBe(2);
    expect(batch.invalidRows).toBe(0);
    const stored = await BulkEStampBatchItem.find({ batchId: batch._id }).sort({ rowNumber: 1 });
    expect(stored.length).toBe(2);
    expect(stored[0].rowNumber).toBe(1);
    expect(stored[0].status).toBe("VALID");
    expect(stored[0].inputData.considerationPrice).toBe(1000);
  });

  it("a valid XLSX upload creates the batch and items", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const buffer = buildXlsx([rowFor(article, { considerationPrice: 1500 })]);
    const { batch, items } = await upload({
      org, user, buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: "batch.xlsx",
    });
    expect(batch.fileType).toBe("XLSX");
    expect(batch.status).toBe("PREVIEW_READY");
    expect(items).toBe(1);
  });

  it("a missing required header fails the whole batch structurally, but the batch record is still created", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const headers = HEADERS.filter((h) => h !== "considerationPrice");
    const buffer = buildCsv([rowFor(article)], headers);
    const err = await expectStructuralFailure(upload({ org, user, buffer, mimeType: "text/csv", fileName: "bad.csv" }), "BULK_BATCH_STRUCTURAL_FAILURE");
    expect(err.message).toMatch(/considerationPrice/);
    const batch = await BulkEStampBatch.findById(err.details.batchId);
    expect(batch.status).toBe("FAILED");
    expect(batch.errorSummary).toMatch(/considerationPrice/);
  });

  it("a duplicate header fails the whole batch structurally", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const headers = [...HEADERS, "stateCode"]; // stateCode appears twice
    const row = rowFor(article);
    const buffer = buildCsv([{ ...row }], headers);
    const err = await expectStructuralFailure(upload({ org, user, buffer, mimeType: "text/csv", fileName: "dup.csv" }), "BULK_BATCH_STRUCTURAL_FAILURE");
    expect(err.message).toMatch(/Duplicate column/);
    const batch = await BulkEStampBatch.findById(err.details.batchId);
    expect(batch.status).toBe("FAILED");
  });

  it("exceeding BULK_ESTAMP_MAX_ROWS rejects the whole upload (never silently truncated)", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const rows = Array.from({ length: 501 }, () => rowFor(article));
    const buffer = buildCsv(rows);
    const err = await expectStructuralFailure(upload({ org, user, buffer, mimeType: "text/csv", fileName: "big.csv" }), "BULK_BATCH_STRUCTURAL_FAILURE");
    expect(err.message).toMatch(/exceeding the maximum/);
    const batch = await BulkEStampBatch.findById(err.details.batchId);
    expect(batch.status).toBe("FAILED");
    expect(await BulkEStampBatchItem.countDocuments({ batchId: batch._id })).toBe(0);
  });

  // Phase 28 - BULK_ESTAMP_MAX_ROWS was registered/editable/auditable through
  // the Settings API but silently ignored at runtime (env-var only). Now
  // wired through SettingsService.getBulkEstampMaxRows(), same live-read
  // pattern as DOCUMENT_MAX_FILE_SIZE_MB/REPORT_MAX_DATE_RANGE_DAYS above.
  it("a changed BULK_ESTAMP_MAX_ROWS setting affects the live row-count boundary immediately, with no restart", async () => {
    const { org, user, article } = await makeOrgWithArticle();

    await SettingsService.updateSetting({ key: "BULK_ESTAMP_MAX_ROWS", value: 5, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });

    // 6 rows now exceeds the new, live 5-row limit even though it's well under the old 500-row default.
    const tooMany = Array.from({ length: 6 }, () => rowFor(article));
    const err = await expectStructuralFailure(upload({ org, user, buffer: buildCsv(tooMany), mimeType: "text/csv", fileName: "small-limit.csv" }), "BULK_BATCH_STRUCTURAL_FAILURE");
    expect(err.message).toMatch(/exceeding the maximum of 5 rows/);

    // The same row count passes once the limit is raised back above it.
    await SettingsService.updateSetting({ key: "BULK_ESTAMP_MAX_ROWS", value: 10, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });
    const { batch } = await upload({ org, user, buffer: buildCsv(tooMany), mimeType: "text/csv", fileName: "within-limit.csv" });
    expect(batch.status).toBe("PREVIEW_READY");
  });

  it("an invalid mimetype is rejected with 400 and never creates any batch", async () => {
    const { org, user } = await makeOrgWithArticle();
    const buffer = Buffer.from("hello", "utf8");
    await expectStructuralFailure(upload({ org, user, buffer, mimeType: "application/pdf", fileName: "file.pdf" }), "INVALID_FILE_TYPE");
    expect(await BulkEStampBatch.countDocuments({ organizationId: org._id })).toBe(0);
  });

  it("an unparseable file is rejected with 400, never a 500, and never creates a batch", async () => {
    const { org, user } = await makeOrgWithArticle();
    const buffer = Buffer.from([0x50, 0x4b, 0x00, 0x00, 0x01, 0x02, 0x03]); // looks like a zip header but is garbage
    await expectStructuralFailure(
      upload({ org, user, buffer, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName: "broken.xlsx" }),
      "INVALID_FILE"
    );
    expect(await BulkEStampBatch.countDocuments({ organizationId: org._id })).toBe(0);
  });

  it("a cell starting with '=' (formula-injection shape) is stored and treated as inert literal text, never evaluated", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(article, { descriptionOfDocument: "=1+1", propertyDescription: "../../etc/passwd" })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "formula.csv" });
    const item = await BulkEStampBatchItem.findOne({ batchId: batch._id, rowNumber: 1 });
    expect(item.inputData.descriptionOfDocument).toBe("=1+1"); // literal string, not evaluated to 2
    expect(item.inputData.propertyDescription).toBe("../../etc/passwd");
    expect(item.status).toBe("VALID");
  });
});

describe("Upload - per-row validation", () => {
  it("a negative considerationPrice marks the row INVALID with a validation error", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(article, { considerationPrice: -5 })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "neg.csv" });
    const item = await BulkEStampBatchItem.findOne({ batchId: batch._id, rowNumber: 1 });
    expect(item.status).toBe("INVALID");
    expect(item.validationErrors.length).toBeGreaterThan(0);
    expect(batch.invalidRows).toBe(1);
    expect(batch.validRows).toBe(0);
  });

  it("numberOfEStamps out of range (0 or 101) marks the row INVALID", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(article, { numberOfEStamps: 0 }), rowFor(article, { numberOfEStamps: 101 })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "qty.csv" });
    const items = await BulkEStampBatchItem.find({ batchId: batch._id }).sort({ rowNumber: 1 });
    expect(items[0].status).toBe("INVALID");
    expect(items[1].status).toBe("INVALID");
  });

  it("a missing required field marks the row INVALID", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(article, { firstParty: "" })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "missing.csv" });
    const item = await BulkEStampBatchItem.findOne({ batchId: batch._id, rowNumber: 1 });
    expect(item.status).toBe("INVALID");
    expect(item.validationErrors.some((e) => e.includes("firstParty"))).toBe(true);
  });

  it("duplicate rows (same stateCode/articleId/firstParty/secondParty/considerationPrice) are flagged, not rejected", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(article, { considerationPrice: 999 }), rowFor(article, { considerationPrice: 999 })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "dup-rows.csv" });
    const items = await BulkEStampBatchItem.find({ batchId: batch._id }).sort({ rowNumber: 1 });
    expect(items[0].isDuplicateSuspect).toBe(true);
    expect(items[1].isDuplicateSuspect).toBe(true);
    expect(items[0].status).toBe("VALID");
    expect(items[1].status).toBe("VALID");
    expect(batch.validRows).toBe(2);
  });
});

describe("Preview never creates financial side effects", () => {
  it("upload + preview never creates an EStampRequest or touches the wallet", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 5000, fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article, { considerationPrice: 100 })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "preview.csv" });
    await BulkEStampService.getBatchDetail(batch._id.toString(), org._id.toString(), Role.SUPER_ADMIN, {});
    expect(await EStampRequest.countDocuments({ organizationId: org._id })).toBe(0);
    expect(await getWalletBalance(org._id)).toBe(5000);
  });

  it("the preview shows a real calculated amount per valid row and a batch-level estimated total, computed at validate time", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 5000, fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article), rowFor(article, { firstParty: "Carl" })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "amounts.csv" });
    expect(batch.totalStampDuty).toBe(1000); // 500 + 500, estimate over valid rows
    const detail = await BulkEStampService.getBatchDetail(batch._id.toString(), org._id.toString(), Role.SUPER_ADMIN, {});
    expect(detail.items.every((i) => i.calculatedAmount === 500)).toBe(true);
    expect(detail.items.every((i) => i.articleVersionUsed === 1)).toBe(true);
  });
});

describe("Confirm - true reuse of EStampRequestService.createRequest", () => {
  it("creates an EStampRequest+EStampOrder per valid row with the deterministic bulk idempotencyKey, findable by that key", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 5000, fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article, { considerationPrice: 100 })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "confirm.csv" });
    const result = await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(result.batch.status).toBe("COMPLETED");
    expect(result.batch.createdRequests).toBe(1);
    const item = result.items[0];
    expect(item.status).toBe("CREATED");
    const expectedKey = `bulk:${batch._id.toString()}:row:1`;
    expect(item.idempotencyKey).toBe(expectedKey);
    const request = await EStampRequest.findOne({ organizationId: org._id, idempotencyKey: expectedKey });
    expect(request).not.toBeNull();
    expect(request._id.toString()).toBe(item.requestId.toString());
    const order = await EStampOrder.findById(item.orderId);
    // A freshly created order's eStampStatus mirrors request.status at
    // creation time (MODIFICATION_WINDOW) - identical to what the single-
    // request path produces (see estamp-request.service.js createRequest);
    // it only becomes EStampOrderProcessingStatus.CREATED once
    // lockExpiredRequests later closes the modification window. The point
    // here is that it is indistinguishable from a single-request order at
    // the same lifecycle point, not a specific literal value.
    expect(order.eStampStatus).toBe(request.status);
    expect(order.paymentStatus).toBe("PAID");
    expect(order.status).toBe(OrderStatus.ONGOING);
    expect(order.requestId.toString()).toBe(request._id.toString());
  });
});

describe("Confirm - wallet safety (upfront gate)", () => {
  it("insufficient total balance rejects the whole batch, creates zero requests, and debits nothing", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 800, fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article, { considerationPrice: 0 }), rowFor(article, { firstParty: "Carl", considerationPrice: 0 })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "insufficient.csv" });
    let err;
    try {
      await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("INSUFFICIENT_BALANCE");
    expect(await EStampRequest.countDocuments({ organizationId: org._id })).toBe(0);
    expect(await getWalletBalance(org._id)).toBe(800);
    const reloaded = await BulkEStampBatch.findById(batch._id);
    expect(reloaded.status).toBe("FAILED");
    expect(reloaded.createdRequests).toBe(0);
    const items = await BulkEStampBatchItem.find({ batchId: batch._id });
    expect(items.every((i) => i.status === "FAILED")).toBe(true);
  });

  it("sufficient balance succeeds and debits exactly the sum of the created rows", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 2000, fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article), rowFor(article, { firstParty: "Carl" })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "sufficient.csv" });
    const result = await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(result.batch.status).toBe("COMPLETED");
    expect(result.batch.createdRequests).toBe(2);
    expect(await getWalletBalance(org._id)).toBe(1000); // 2000 - (500+500)
    expect(await EStampRequest.countDocuments({ organizationId: org._id })).toBe(2);
  });

  it("a row that fails re-validation at confirm time (e.g. article deactivated) becomes FAILED without blocking other rows", async () => {
    const { org, user, article: articleA } = await makeOrgWithArticle({ balance: 5000, fixedAmount: 500 });
    const creator = new mongoose.Types.ObjectId();
    const articleB = await Article.create({ stateCode: "KA", articleCode: `BULK-B-${new mongoose.Types.ObjectId()}`, title: "Bulk Article B", createdBy: creator, currentVersion: 1 });
    await ArticleVersion.create({ articleId: articleB._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 500 }, createdBy: creator });
    const buffer = buildCsv([rowFor(articleA), rowFor(articleB, { firstParty: "Carl" })]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "partial.csv" });
    articleB.isActive = false;
    await articleB.save();
    const result = await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(result.batch.status).toBe("PARTIALLY_FAILED");
    expect(result.batch.createdRequests).toBe(1);
    expect(result.batch.failedRows).toBe(1);
    const failedItem = result.items.find((i) => i.rowNumber === 2);
    expect(failedItem.status).toBe("FAILED");
    expect(failedItem.failureReason).toBeTruthy();
  });
});

describe("Confirm - idempotency and concurrency", () => {
  it("confirming an already-confirmed batch again is a no-op (does not double-create or double-debit)", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 2000, fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article)]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "idem.csv" });
    const first = await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(first.batch.status).toBe("COMPLETED");
    const second = await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(second.alreadyProcessed).toBe(true);
    expect(await EStampRequest.countDocuments({ organizationId: org._id })).toBe(1);
    expect(await getWalletBalance(org._id)).toBe(1500);
  });

  it("two concurrent confirm calls result in exactly one creation pass (atomic claim)", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 2000, fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article)]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "race.csv" });
    const results = await Promise.allSettled([
      BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN),
      BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await EStampRequest.countDocuments({ organizationId: org._id })).toBe(1);
    expect(await getWalletBalance(org._id)).toBe(1500);
  });
});

describe("Cancel", () => {
  it("cancel succeeds before confirm", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(article)]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "cancel.csv" });
    const cancelled = await BulkEStampService.cancelBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("cancel is rejected once the batch has been confirmed", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 2000, fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article)]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "cancel2.csv" });
    await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    await expect(
      BulkEStampService.cancelBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("Tenant isolation", () => {
  it("organization A cannot view, confirm, or cancel organization B's batch (404, not 403)", async () => {
    const { org: orgA, user: userA } = await makeOrgWithArticle();
    const { org: orgB, article: articleB } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(articleB)]);
    const { batch } = await upload({ org: orgB, user: userA, buffer, mimeType: "text/csv", fileName: "tenant.csv" });

    await expect(
      BulkEStampService.getBatchDetail(batch._id.toString(), orgA._id.toString(), Role.SUPER_ADMIN, {})
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      BulkEStampService.confirmBatch(batch._id.toString(), orgA._id.toString(), userA._id.toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      BulkEStampService.cancelBatch(batch._id.toString(), orgA._id.toString(), userA._id.toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 404 });

    const reloaded = await BulkEStampBatch.findById(batch._id);
    expect(reloaded.status).toBe("PREVIEW_READY"); // untouched
  });

  it("Master Admin can view a batch belonging to any organization", async () => {
    const { org, article } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(article)]);
    const anyUser = await User.create({ name: "MA", email: `ma-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    const { batch } = await upload({ org, user: anyUser, buffer, mimeType: "text/csv", fileName: "master.csv" });
    const detail = await BulkEStampService.getBatchDetail(batch._id.toString(), undefined, Role.MASTER_ADMIN, {});
    expect(detail.batch._id.toString()).toBe(batch._id.toString());
  });
});

describe("Permission gating", () => {
  it("SUPER_ADMIN and ADMIN have ESTAMP_BULK_CREATE by default; USER and ASSISTANT_MASTER_ADMIN do not", () => {
    expect(getEffectivePermissions(Role.SUPER_ADMIN, [])).toContain(Permission.ESTAMP_BULK_CREATE);
    expect(getEffectivePermissions(Role.ADMIN, [])).toContain(Permission.ESTAMP_BULK_CREATE);
    expect(getEffectivePermissions(Role.USER, [])).not.toContain(Permission.ESTAMP_BULK_CREATE);
    expect(getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [])).not.toContain(Permission.ESTAMP_BULK_CREATE);
    expect(getEffectivePermissions(Role.MASTER_ADMIN, [])).toContain(Permission.ESTAMP_BULK_CREATE); // implicit all-permissions
  });

  it("a role without ESTAMP_BULK_CREATE is denied by the route guard", async () => {
    const permissions = getEffectivePermissions(Role.USER, []);
    const req = makeReq({ user: { id: "u", role: Role.USER, organizationId: "org-1", permissions } });
    const { threw } = await runMiddleware(requirePermission(Permission.ESTAMP_BULK_CREATE), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("an Assistant Master Admin explicitly granted the permission passes the route guard", async () => {
    const permissions = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [Permission.ESTAMP_BULK_CREATE]);
    const req = makeReq({ user: { id: "u", role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions } });
    const { threw } = await runMiddleware(requirePermission(Permission.ESTAMP_BULK_CREATE), req, makeRes());
    expect(threw).toBeNull();
  });
});

describe("Controller - organizationId is never taken from a tenant actor's body", () => {
  it("upload always uses req.user.organizationId for a tenant actor, ignoring any spoofed body value", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const { org: otherOrg } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(article)]);
    const req = makeReq({
      user: { id: user._id.toString(), role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions: [Permission.ESTAMP_BULK_CREATE] },
      body: { organizationId: otherOrg._id.toString() },
      file: { buffer, mimetype: "text/csv", originalname: "spoof.csv" },
    });
    const { res, error } = await runController(bulkController.uploadBatch, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.batch.organizationId.toString()).toBe(org._id.toString());
  });
});

describe("Audit trail", () => {
  it("records upload, validate, confirm, and completion audit entries", async () => {
    const { org, user, article } = await makeOrgWithArticle({ balance: 2000, fixedAmount: 500 });
    const buffer = buildCsv([rowFor(article)]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "audit.csv" });
    expect(await AuditLog.findOne({ action: AuditAction.BULK_BATCH_UPLOADED, entityId: batch._id.toString() })).not.toBeNull();
    expect(await AuditLog.findOne({ action: AuditAction.BULK_BATCH_VALIDATED, entityId: batch._id.toString() })).not.toBeNull();
    await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(await AuditLog.findOne({ action: AuditAction.BULK_BATCH_CONFIRMED, entityId: batch._id.toString() })).not.toBeNull();
    expect(await AuditLog.findOne({ action: AuditAction.BULK_BATCH_COMPLETED, entityId: batch._id.toString() })).not.toBeNull();
  });

  it("records a cancellation audit entry", async () => {
    const { org, user, article } = await makeOrgWithArticle();
    const buffer = buildCsv([rowFor(article)]);
    const { batch } = await upload({ org, user, buffer, mimeType: "text/csv", fileName: "audit2.csv" });
    await BulkEStampService.cancelBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(await AuditLog.findOne({ action: AuditAction.BULK_BATCH_CANCELLED, entityId: batch._id.toString() })).not.toBeNull();
  });
});

describe("Assistant Master Admin oversight", () => {
  it("Assistant Master Admin confirming a batch on behalf of a client notifies all Master Admins", async () => {
    const { org, article } = await makeOrgWithArticle({ balance: 2000, fixedAmount: 500 });
    const master = await User.create({ name: "Master", email: `m-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    const assistantId = new mongoose.Types.ObjectId();
    const buffer = buildCsv([rowFor(article)]);
    const { batch } = await BulkEStampService.uploadBatch({
      organizationId: org._id, createdBy: assistantId, actorRole: Role.ASSISTANT_MASTER_ADMIN,
      fileBuffer: buffer, mimeType: "text/csv", originalFileName: "assistant.csv",
    });
    await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), assistantId.toString(), Role.ASSISTANT_MASTER_ADMIN);
    const notification = await Notification.findOne({ recipientId: master._id, relatedActorId: assistantId.toString() });
    expect(notification).not.toBeNull();
    expect(notification.type).toBe("ASSISTANT_ADMIN_ACTIVITY");
  });
});
