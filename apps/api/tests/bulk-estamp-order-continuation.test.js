// Phase 20 - Final QA: bulk-created request -> normal order pipeline continuity.
//
// bulk-estamp.test.js already proves confirmBatch reuses
// EStampRequestService.createRequest and produces a request/order
// indistinguishable from the single-request path AT CREATION TIME, and
// estamp-request-lifecycle-hardening.test.js separately proves a bulk-created
// request can be modified/cancelled through the same hardened path as a
// single-created one. Neither test, nor any other in this suite, continues a
// bulk-confirmed request all the way through lockExpiredRequests -> order
// processing -> provider issuance -> certificate attachment -> download - the
// rest of Phase 11's "bulk reuses the single-request path" claim. This test
// closes that specific gap: if bulk ever diverged from the single path
// anywhere past creation (e.g. a bulk-only field the order-processing code
// didn't expect), this is the test that would catch it.
import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import {
  Organization,
  Wallet,
  Article,
  ArticleVersion,
  User,
  EStampRequest,
  EStampOrder,
} from "../src/models/index.js";
import { Role, Permission, OrganizationStatus, EStampRequestStatus, EStampOrderProcessingStatus } from "@launcherdesk/shared";
import { BulkEStampService } from "../src/services/bulk-estamp.service.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import * as orderController from "../src/controllers/order.controller.js";
import * as fileController from "../src/controllers/file.controller.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";

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

function rowFor(article, overrides = {}) {
  return {
    stateCode: "KA",
    articleId: article._id.toString(),
    firstParty: "Bulk Continuation Alice",
    secondParty: "Bulk Continuation Bob",
    descriptionOfDocument: "Bulk-to-order continuation agreement",
    propertyDescription: "Plot 9",
    considerationPrice: 0,
    stampDutyPaidBy: "Bulk Continuation Alice",
    numberOfEStamps: 1,
    ...overrides,
  };
}

function masterReq(overrides = {}) {
  return makeReq({
    user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) },
    ...overrides,
  });
}

describe("Bulk -> normal order pipeline continuation", () => {
  it("a bulk-confirmed request locks, processes, issues, and its certificate attaches/downloads exactly like a single-created request", async () => {
    const creator = new mongoose.Types.ObjectId();
    const org = await Organization.create({
      name: "Bulk Continuation Co",
      contactEmail: `bulk-continuation-${new mongoose.Types.ObjectId()}@example.com`,
      contactPhone: "9999999999",
      createdBy: creator,
      status: OrganizationStatus.ACTIVE,
      isEstampServiceEnabled: true,
    });
    await Wallet.create({ organizationId: org._id, balance: 5000 });
    const article = await Article.create({ stateCode: "KA", articleCode: `BULKCONT-${new mongoose.Types.ObjectId()}`, title: "Bulk Continuation Article", createdBy: creator, currentVersion: 1 });
    await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 500 }, createdBy: creator });
    const user = await User.create({ name: "Bulk Continuation User", email: `bulkcont-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.SUPER_ADMIN, organizationId: org._id });

    // Upload + confirm a one-row batch - the exact same BulkEStampService
    // entry points bulk-estamp.test.js already exercises.
    const buffer = buildCsv([rowFor(article)]);
    const { batch } = await BulkEStampService.uploadBatch({
      organizationId: org._id,
      createdBy: user._id,
      actorRole: Role.SUPER_ADMIN,
      fileBuffer: buffer,
      mimeType: "text/csv",
      originalFileName: "continuation.csv",
    });
    const confirmResult = await BulkEStampService.confirmBatch(batch._id.toString(), org._id.toString(), user._id.toString(), Role.SUPER_ADMIN);
    expect(confirmResult.batch.status).toBe("COMPLETED");
    const item = confirmResult.items[0];
    const bulkRequest = await EStampRequest.findById(item.requestId);
    const bulkOrder = await EStampOrder.findById(item.orderId);
    expect(bulkRequest.status).toBe(EStampRequestStatus.MODIFICATION_WINDOW);

    // Force the modification window to have expired and run the REAL cron
    // job function - identical mechanism a single-created request goes
    // through, proving bulk-created requests are picked up the same way.
    await EStampRequest.updateOne({ _id: bulkRequest._id }, { $set: { modificationDeadline: new Date(Date.now() - 1000) } });
    const lockedCount = await EStampRequestService.lockExpiredRequests();
    expect(lockedCount).toBeGreaterThanOrEqual(1);
    const lockedRequest = await EStampRequest.findById(bulkRequest._id);
    expect(lockedRequest.status).toBe(EStampRequestStatus.LOCKED);

    // Process + sync through the real order controller, exactly as an
    // internal ops actor would for any order regardless of its origin.
    const processResult = await runController(
      orderController.processOrder,
      masterReq({ params: { id: bulkOrder._id.toString() }, query: { organizationId: org._id.toString() } }),
      makeRes()
    );
    expect(processResult.error).toBeNull();
    const syncResult = await runController(
      orderController.syncOrder,
      masterReq({ params: { id: bulkOrder._id.toString() }, query: { organizationId: org._id.toString() } }),
      makeRes()
    );
    expect(syncResult.error).toBeNull();
    const issuedOrder = await EStampOrder.findById(bulkOrder._id);
    expect(issuedOrder.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);

    // Attach + download the certificate - the same file.controller entry
    // points as any non-bulk order.
    const attachResult = await runController(
      fileController.uploadFile,
      masterReq({
        body: { organizationId: org._id.toString(), orderId: bulkOrder._id.toString(), fileType: "ESTAMP_DOCUMENT" },
        file: { buffer: Buffer.from("bulk-continuation-fake-pdf"), originalname: "stamp.pdf", mimetype: "application/pdf" },
      }),
      makeRes()
    );
    expect(attachResult.error).toBeNull();

    const downloadResult = await runController(
      fileController.downloadEStamp,
      masterReq({ params: { orderId: bulkOrder._id.toString() } }),
      makeRes()
    );
    expect(downloadResult.error).toBeNull();
    expect(downloadResult.res.body.data.url).toBeTruthy();

    // The batch's own aggregate bookkeeping is untouched by any of this
    // downstream activity - it only ever reflects confirm-time outcomes,
    // matching the existing modify/cancel continuation test's assertion.
    const { BulkEStampBatch } = await import("../src/models/index.js");
    const reloadedBatch = await BulkEStampBatch.findById(batch._id);
    expect(reloadedBatch.createdRequests).toBe(1);
  });
});
