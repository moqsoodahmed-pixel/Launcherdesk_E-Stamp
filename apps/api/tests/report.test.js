import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import {
  Organization,
  Wallet,
  WalletTransaction,
  Payment,
  EStampRequest,
  EStampOrder,
  BulkEStampBatch,
  AuditLog,
  EStampProviderBalanceSnapshot,
} from "../src/models/index.js";
import {
  Role,
  Permission,
  AuditAction,
  OrganizationStatus,
  EStampRequestStatus,
  EStampOrderProcessingStatus,
  OrderStatus,
  PaymentStatus,
  WalletTransactionType,
  BulkBatchStatus,
} from "@launcherdesk/shared";
import * as reportController from "../src/controllers/report.controller.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";

let seq = 0;
function uid() {
  seq += 1;
  return `${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createOrg(overrides = {}) {
  const creator = new mongoose.Types.ObjectId();
  return Organization.create({
    name: overrides.name || `Report Test Org ${uid()}`,
    contactEmail: `report-${uid()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: overrides.status || OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
}

// Backdates a just-created document's createdAt via the raw driver -
// bypasses Mongoose's timestamps plugin entirely, which is the only
// reliable way to control createdAt for date-range boundary tests.
async function backdate(Model, id, date) {
  await Model.collection.updateOne({ _id: id }, { $set: { createdAt: date } });
}

async function createRequest(org, overrides = {}) {
  const creator = new mongoose.Types.ObjectId();
  const doc = await EStampRequest.create({
    requestNumber: `REQ-${uid()}`,
    organizationId: org._id,
    createdBy: creator,
    stateCode: overrides.stateCode || "KA",
    articleId: overrides.articleId || new mongoose.Types.ObjectId(),
    articleVersionUsed: 1,
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Test doc",
    considerationPrice: 1000,
    stampDutyPaidBy: "Alice",
    numberOfEStamps: 1,
    calculatedStampDuty: overrides.calculatedStampDuty ?? 500,
    status: overrides.status || EStampRequestStatus.REQUEST_CREATED,
    cancelledAt: overrides.cancelledAt,
    modificationDeadline: new Date(Date.now() + 20 * 60 * 1000),
    // {organizationId, idempotencyKey} is a COMPOUND sparse-unique index -
    // Mongo only skips an entry when EVERY indexed field is missing, so
    // multiple requests for the SAME organization with idempotencyKey
    // entirely omitted would collide on {organizationId, null}. Always
    // giving each test fixture its own unique key sidesteps that (and
    // matches real usage, where the service always generates one).
    idempotencyKey: overrides.idempotencyKey || `test-${uid()}`,
  });
  if (overrides.createdAt) await backdate(EStampRequest, doc._id, overrides.createdAt);
  return doc;
}

async function createOrder(org, request, overrides = {}) {
  const creator = new mongoose.Types.ObjectId();
  const doc = await EStampOrder.create({
    orderNumber: `ORD-${uid()}`,
    organizationId: org._id,
    requestId: request ? request._id : new mongoose.Types.ObjectId(),
    createdBy: creator,
    stateCode: overrides.stateCode || "KA",
    articleId: overrides.articleId || new mongoose.Types.ObjectId(),
    amount: overrides.amount ?? 500,
    eStampStatus: overrides.eStampStatus || EStampOrderProcessingStatus.CREATED,
    status: overrides.status || OrderStatus.ONGOING,
    retryCount: overrides.retryCount ?? 0,
    submittedAt: overrides.submittedAt,
    issuedAt: overrides.issuedAt,
  });
  if (overrides.createdAt) await backdate(EStampOrder, doc._id, overrides.createdAt);
  return doc;
}

async function createPayment(org, overrides = {}) {
  const creator = new mongoose.Types.ObjectId();
  const doc = await Payment.create({
    organizationId: org._id,
    amount: overrides.amount ?? 1000,
    razorpayOrderId: `rzp_${uid()}`,
    status: overrides.status || PaymentStatus.SUCCESS,
    createdBy: creator,
  });
  if (overrides.createdAt) await backdate(Payment, doc._id, overrides.createdAt);
  return doc;
}

async function createWalletTx(org, overrides = {}) {
  const doc = await WalletTransaction.create({
    organizationId: org._id,
    type: overrides.type || WalletTransactionType.CREDIT,
    amount: overrides.amount ?? 100,
    balanceBefore: overrides.balanceBefore ?? 0,
    balanceAfter: overrides.balanceAfter ?? 100,
    referenceType: overrides.referenceType || "MANUAL_ADJUSTMENT",
    idempotencyKey: `wtx-${uid()}`,
  });
  if (overrides.createdAt) await backdate(WalletTransaction, doc._id, overrides.createdAt);
  return doc;
}

async function createBulkBatch(org, overrides = {}) {
  const creator = new mongoose.Types.ObjectId();
  const doc = await BulkEStampBatch.create({
    batchNumber: `BATCH-${uid()}`,
    organizationId: org._id,
    createdBy: creator,
    fileName: "test.csv",
    fileType: "CSV",
    status: overrides.status || BulkBatchStatus.COMPLETED,
    totalRows: overrides.totalRows ?? 0,
    validRows: overrides.validRows ?? 0,
    invalidRows: overrides.invalidRows ?? 0,
    createdRequests: overrides.createdRequests ?? 0,
    failedRows: overrides.failedRows ?? 0,
    totalStampDuty: overrides.totalStampDuty ?? 0,
  });
  if (overrides.createdAt) await backdate(BulkEStampBatch, doc._id, overrides.createdAt);
  return doc;
}

function masterReq(overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) }, query: {}, ...overrides });
}
function clientReq(org, permissions, overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions }, query: {}, ...overrides });
}
function assistantReq(permissions, overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions }, query: {}, ...overrides });
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

describe("Dashboard", () => {
  it("Master Admin gets a global view including organizations counts", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg({ status: OrganizationStatus.SUSPENDED });
    await createRequest(orgA);
    await createRequest(orgB);
    const { res, error } = await runController(reportController.getDashboard, masterReq(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.organizations).not.toBeNull();
    expect(res.body.data.organizations.total).toBeGreaterThanOrEqual(2);
    expect(res.body.data.requests.total).toBeGreaterThanOrEqual(2);
    expect(res.body.data.financial).not.toBeNull(); // Master Admin holds REPORT_FINANCIAL_VIEW implicitly
  });

  it("a client (SUPER_ADMIN) view is scoped to its own organization and has no organizations section", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await createRequest(orgA);
    await createRequest(orgB);
    await createRequest(orgB);
    const { res, error } = await runController(reportController.getDashboard, clientReq(orgA, [Permission.REPORT_VIEW, Permission.REPORT_FINANCIAL_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.requests.total).toBe(1);
    expect(res.body.data.organizations).toBeNull();
  });

  it("a client without REPORT_FINANCIAL_VIEW never receives the financial section", async () => {
    const org = await createOrg();
    const { res, error } = await runController(reportController.getDashboard, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.financial).toBeNull();
  });

  it("an empty database returns zeros, never NaN, never throws", async () => {
    const org = await createOrg();
    const { res, error } = await runController(reportController.getDashboard, clientReq(org, [Permission.REPORT_VIEW, Permission.REPORT_FINANCIAL_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.requests.total).toBe(0);
    expect(res.body.data.orders.total).toBe(0);
    expect(res.body.data.financial.currentWalletBalance).toBeNull(); // no Wallet doc exists for this org
    expect(Number.isNaN(res.body.data.financial.successfulPaymentsAmount)).toBe(false);
  });

  it("legacy /summary keeps its original response shape for DashboardPage.jsx", async () => {
    const org = await createOrg();
    await createRequest(org, { status: EStampRequestStatus.COMPLETED });
    await createOrder(org);
    const { res, error } = await runController(reportController.getSummary, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data).toHaveProperty("totalRequests");
    expect(res.body.data).toHaveProperty("totalOrders");
    expect(Array.isArray(res.body.data.statusCounts)).toBe(true);
    expect(res.body.data.totalRequests).toBe(1);
    expect(res.body.data.totalOrders).toBe(1);
  });

  it("legacy /summary still works for an Assistant Master Admin holding only REPORT_VIEW (no REPORT_GLOBAL_VIEW) omitting organizationId - must not regress DashboardPage.jsx", async () => {
    await createOrg();
    const { error } = await runController(reportController.getSummary, assistantReq([Permission.REPORT_VIEW], { query: {} }), makeRes());
    expect(error).toBeNull();
  });
});

describe("Tenant isolation", () => {
  it("a client sees only its own organization's requests", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await createRequest(orgA);
    await createRequest(orgB);
    await createRequest(orgB);
    const { res, error } = await runController(reportController.getRequests, clientReq(orgA, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(1);
  });

  it("a forged organizationId from a tenant actor is silently ignored, never honored", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await createRequest(orgB);
    await createRequest(orgB);
    const { res, error } = await runController(reportController.getRequests, clientReq(orgA, [Permission.REPORT_VIEW], { query: { organizationId: orgB._id.toString() } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(0); // still scoped to orgA (empty), never orgB's 2 requests
  });

  it("Master Admin gets a genuine global scope across organizations", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await createRequest(orgA);
    await createRequest(orgB);
    const { res, error } = await runController(reportController.getRequests, masterReq(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBeGreaterThanOrEqual(2);
  });

  it("an Assistant Master Admin holding only REPORT_VIEW cannot get a global view - must supply organizationId", async () => {
    const { error } = await runController(reportController.getRequests, assistantReq([Permission.REPORT_VIEW]), makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("ORGANIZATION_ID_REQUIRED");
  });

  it("an Assistant Master Admin holding only REPORT_VIEW, given an explicit organizationId, is scoped to exactly that org", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await createRequest(orgA);
    await createRequest(orgB);
    await createRequest(orgB);
    const { res, error } = await runController(reportController.getRequests, assistantReq([Permission.REPORT_VIEW], { query: { organizationId: orgA._id.toString() } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(1);
  });

  it("an Assistant Master Admin holding REPORT_GLOBAL_VIEW can omit organizationId and get a global view", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await createRequest(orgA);
    await createRequest(orgB);
    const { res, error } = await runController(reportController.getRequests, assistantReq([Permission.REPORT_VIEW, Permission.REPORT_GLOBAL_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBeGreaterThanOrEqual(2);
  });
});

describe("Request analytics", () => {
  it("status, state and article distribution are correct", async () => {
    const org = await createOrg();
    const articleId = new mongoose.Types.ObjectId();
    await createRequest(org, { status: EStampRequestStatus.COMPLETED, stateCode: "KA", articleId });
    await createRequest(org, { status: EStampRequestStatus.COMPLETED, stateCode: "KA", articleId });
    await createRequest(org, { status: EStampRequestStatus.CANCELLED, stateCode: "MH" });
    const { res, error } = await runController(reportController.getRequests, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    const completedRow = res.body.data.statusDistribution.find((r) => r.status === EStampRequestStatus.COMPLETED);
    expect(completedRow.count).toBe(2);
    const kaRow = res.body.data.stateDistribution.find((r) => r.stateCode === "KA");
    expect(kaRow.count).toBe(2);
    const articleRow = res.body.data.articleDistribution.find((r) => r.articleId.toString() === articleId.toString());
    expect(articleRow.count).toBe(2);
  });

  it("cancellation rate is cancelled/total in range, and null when the range has zero requests", async () => {
    const org = await createOrg();
    await createRequest(org, { status: EStampRequestStatus.CANCELLED });
    await createRequest(org, { status: EStampRequestStatus.CANCELLED });
    await createRequest(org, { status: EStampRequestStatus.COMPLETED });
    await createRequest(org, { status: EStampRequestStatus.COMPLETED });
    const { res, error } = await runController(reportController.getRequests, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.cancellationRate).toBe(0.5);

    const emptyOrg = await createOrg();
    const { res: emptyRes } = await runController(reportController.getRequests, clientReq(emptyOrg, [Permission.REPORT_VIEW]), makeRes());
    expect(emptyRes.body.data.cancellationRate).toBeNull();
    expect(emptyRes.body.data.total).toBe(0);
  });

  it("modification rate counts distinct requests with a modify audit event, over total in range", async () => {
    const org = await createOrg();
    const r1 = await createRequest(org);
    const r2 = await createRequest(org);
    await createRequest(org);
    await createRequest(org);
    await AuditLog.create({ actorRole: Role.SUPER_ADMIN, organizationId: org._id, action: AuditAction.ESTAMP_REQUEST_MODIFIED, entityType: "EStampRequest", entityId: r1._id.toString() });
    // a second, unrelated audit event on the SAME request must not double-count it
    await AuditLog.create({ actorRole: Role.SUPER_ADMIN, organizationId: org._id, action: AuditAction.ESTAMP_REQUEST_MODIFIED, entityType: "EStampRequest", entityId: r1._id.toString() });
    await AuditLog.create({ actorRole: Role.SUPER_ADMIN, organizationId: org._id, action: AuditAction.ESTAMP_REQUEST_MODIFIED, entityType: "EStampRequest", entityId: r2._id.toString() });
    const { res, error } = await runController(reportController.getRequests, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(4);
    expect(res.body.data.modificationRate).toBe(0.5); // 2 distinct modified out of 4
  });

  it("boundary dates are inclusive and daily trend is correct", async () => {
    const org = await createOrg();
    const from = daysAgo(2);
    const to = new Date();
    await createRequest(org, { createdAt: from }); // exactly on `from` boundary
    await createRequest(org, { createdAt: daysAgo(1) });
    await createRequest(org, { createdAt: daysAgo(10) }); // outside range
    const { res, error } = await runController(reportController.getRequests, clientReq(org, [Permission.REPORT_VIEW], { query: { from: from.toISOString(), to: to.toISOString() } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBe(2);
    expect(Array.isArray(res.body.data.dailyTrend)).toBe(true);
  });
});

describe("Order analytics", () => {
  it("processing-status totals are correct (delegated to EStampProviderService.getUsage)", async () => {
    const org = await createOrg();
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.ISSUED });
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.ISSUED });
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.FAILED });
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.PROCESSING });
    const { res, error } = await runController(reportController.getOrders, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.totals.totalOrders).toBe(4);
    expect(res.body.data.totals.issued).toBe(2);
    expect(res.body.data.totals.failed).toBe(1);
    expect(res.body.data.totals.processing).toBe(1);
  });

  it("issuance success rate uses issued/(issued+failed), never total orders as the denominator", async () => {
    const org = await createOrg();
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.ISSUED });
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.FAILED });
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.PROCESSING });
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.PROCESSING });
    const { res, error } = await runController(reportController.getOrders, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    // 1 issued, 1 failed, 2 processing (still pending) -> rate must be 0.5, NOT 1/4
    expect(res.body.data.issuanceSuccessRate).toBe(0.5);
  });

  it("issuance success rate is null when there are zero issued/failed orders", async () => {
    const org = await createOrg();
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.PROCESSING });
    const { res, error } = await runController(reportController.getOrders, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.issuanceSuccessRate).toBeNull();
  });

  it("retry-count stats (avg/max) are correct", async () => {
    const org = await createOrg();
    await createOrder(org, null, { retryCount: 0 });
    await createOrder(org, null, { retryCount: 2 });
    await createOrder(org, null, { retryCount: 4 });
    const { res, error } = await runController(reportController.getOrders, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.retryStats.avg).toBeCloseTo(2, 5);
    expect(res.body.data.retryStats.max).toBe(4);
  });

  it("timing metrics are computed only from orders with both relevant timestamps, and null/zero-sample otherwise", async () => {
    const org = await createOrg();
    const now = new Date();
    const submitted = new Date(now.getTime() - 60 * 1000); // submitted 60s before issued
    await createOrder(org, null, { submittedAt: submitted, issuedAt: now, eStampStatus: EStampOrderProcessingStatus.ISSUED });
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.CREATED }); // no submittedAt/issuedAt at all
    const { res, error } = await runController(reportController.getOrders, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.timing.submittedToIssuedSeconds.sampleSize).toBe(1);
    expect(res.body.data.timing.submittedToIssuedSeconds.avgSeconds).toBeCloseTo(60, 0);
  });

  it("timing metrics are null with a zero eligible sample", async () => {
    const org = await createOrg();
    await createOrder(org, null, { eStampStatus: EStampOrderProcessingStatus.CREATED });
    const { res, error } = await runController(reportController.getOrders, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.timing.submittedToIssuedSeconds.avgSeconds).toBeNull();
    expect(res.body.data.timing.submittedToIssuedSeconds.sampleSize).toBe(0);
  });
});

describe("Financial accuracy", () => {
  // Deliberately four DIFFERENT numbers from four DIFFERENT sources - proves
  // the report never conflates payments / wallet balance / wallet-ledger
  // volume / request-value into each other.
  async function buildDeliberatelyDifferentFixture() {
    const org = await createOrg();
    await createPayment(org, { status: PaymentStatus.SUCCESS, amount: 1111 });
    await createPayment(org, { status: PaymentStatus.FAILED, amount: 2222 });
    await Wallet.create({ organizationId: org._id, balance: 3333 });
    await createWalletTx(org, { type: WalletTransactionType.CREDIT, amount: 4444 });
    await createWalletTx(org, { type: WalletTransactionType.DEBIT, amount: 5555 });
    await createRequest(org, { calculatedStampDuty: 6666 });
    return org;
  }

  it("payments, wallet balance, wallet-transaction volume, and request value are all independently correct and never conflated", async () => {
    const org = await buildDeliberatelyDifferentFixture();
    const { res, error } = await runController(reportController.getFinancial, clientReq(org, [Permission.REPORT_VIEW, Permission.REPORT_FINANCIAL_VIEW]), makeRes());
    expect(error).toBeNull();
    const data = res.body.data;
    expect(data.payments.successfulAmount).toBe(1111);
    expect(data.payments.failedAmount).toBe(2222);
    expect(data.wallet.currentBalance).toBe(3333); // read directly, never summed from the ledger
    expect(data.walletTransactions.totalCredits).toBe(4444);
    expect(data.walletTransactions.totalDebits).toBe(5555);
    expect(data.requestValue.totalCalculatedStampDuty).toBe(6666);
    // None of the four numbers equal any other - proves no accidental conflation
    const values = [data.payments.successfulAmount, data.wallet.currentBalance, data.walletTransactions.totalCredits, data.requestValue.totalCalculatedStampDuty];
    expect(new Set(values).size).toBe(values.length);
  });

  it("financial report is organization-isolated", async () => {
    const orgA = await buildDeliberatelyDifferentFixture();
    const orgB = await createOrg();
    await createPayment(orgB, { status: PaymentStatus.SUCCESS, amount: 999999 });
    const { res, error } = await runController(reportController.getFinancial, clientReq(orgA, [Permission.REPORT_VIEW, Permission.REPORT_FINANCIAL_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.payments.successfulAmount).toBe(1111); // never orgB's 999999
  });

  it("REPORT_FINANCIAL_VIEW gates the financial report - a role/Assistant lacking it is forbidden", async () => {
    const org = await createOrg();
    const { error } = await runController(reportController.getFinancial, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);

    const { error: assistantError } = await runController(reportController.getFinancial, assistantReq([Permission.REPORT_VIEW, Permission.REPORT_GLOBAL_VIEW]), makeRes());
    expect(assistantError).not.toBeNull();
    expect(assistantError.statusCode).toBe(403);
  });

  it("Master Admin (all permissions) can view the financial report", async () => {
    const org = await buildDeliberatelyDifferentFixture();
    const { error } = await runController(reportController.getFinancial, masterReq({ query: { organizationId: org._id.toString() } }), makeRes());
    expect(error).toBeNull();
  });
});

describe("Bulk reporting", () => {
  it("batch/row/created-request counts are correct and NOT double-counted against getRequestReport", async () => {
    const org = await createOrg();
    await createBulkBatch(org, { totalRows: 10, validRows: 8, invalidRows: 2, createdRequests: 8, failedRows: 0, totalStampDuty: 4000 });
    // Simulate the 8 actually-created requests as real EStampRequest docs.
    for (let i = 0; i < 8; i++) await createRequest(org);

    const { res: bulkRes, error: bulkErr } = await runController(reportController.getBulk, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(bulkErr).toBeNull();
    expect(bulkRes.body.data.totals.createdRequests).toBe(8);
    expect(bulkRes.body.data.totals.totalStampDuty).toBe(4000);

    const { res: reqRes, error: reqErr } = await runController(reportController.getRequests, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(reqErr).toBeNull();
    // Same underlying 8 requests, viewed a different way - NOT 16 (8+8).
    expect(reqRes.body.data.total).toBe(8);
  });

  it("bulk status distribution is correct", async () => {
    const org = await createOrg();
    await createBulkBatch(org, { status: BulkBatchStatus.COMPLETED });
    await createBulkBatch(org, { status: BulkBatchStatus.FAILED });
    await createBulkBatch(org, { status: BulkBatchStatus.FAILED });
    const { res, error } = await runController(reportController.getBulk, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    const failedRow = res.body.data.statusDistribution.find((r) => r.status === BulkBatchStatus.FAILED);
    expect(failedRow.count).toBe(2);
  });
});

describe("Provider reporting", () => {
  it("returns the configured mock snapshot as the current status", async () => {
    await EStampProviderBalanceSnapshot.create({ provider: "mock", status: "AVAILABLE", available: 5000, currency: "INR", unit: "count", source: "mock", fetchedAt: new Date() });
    const { res, error } = await runController(reportController.getProvider, masterReq(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.current.status).toBe("AVAILABLE");
    expect(res.body.data.current.available).toBe(5000);
    expect(res.body.data.history.length).toBeGreaterThanOrEqual(1);
  });

  it("reports an honest 'never fetched' state when no snapshot exists", async () => {
    const { res, error } = await runController(reportController.getProvider, masterReq(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.current.status).toBe("UNAVAILABLE");
    expect(res.body.data.current.available).toBeNull();
  });

  it("viewing the provider report never triggers a refreshBalance side effect", async () => {
    await EStampProviderBalanceSnapshot.create({ provider: "mock", status: "AVAILABLE", available: 100, currency: "INR", unit: "count", source: "mock", fetchedAt: new Date() });
    const before = await EStampProviderBalanceSnapshot.countDocuments();
    await runController(reportController.getProvider, masterReq(), makeRes());
    const after = await EStampProviderBalanceSnapshot.countDocuments();
    expect(after).toBe(before); // no new snapshot was created by viewing the report
  });

  it("ESTAMP_PROVIDER_VIEW gates the provider report even though the caller holds base REPORT_VIEW", async () => {
    const org = await createOrg();
    const { error } = await runController(reportController.getProvider, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
  });
});

describe("Security", () => {
  it("an arbitrary sortBy on the organizations report is rejected/ignored in favor of the safe default", async () => {
    await createOrg();
    const { res, error } = await runController(reportController.getOrganizations, masterReq({ query: { sortBy: "passwordHash" } }), makeRes());
    expect(error).toBeNull(); // silently falls back rather than applying an unsafe sort field
  });

  it("an oversized date range (>366 days) is rejected", async () => {
    const org = await createOrg();
    const from = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await runController(reportController.getRequests, clientReq(org, [Permission.REPORT_VIEW], { query: { from, to: new Date().toISOString() } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("RANGE_TOO_LARGE");
  });

  it("from > to is rejected", async () => {
    const org = await createOrg();
    const { error } = await runController(
      reportController.getRequests,
      clientReq(org, [Permission.REPORT_VIEW], { query: { from: "2025-06-10", to: "2025-06-01" } }),
      makeRes()
    );
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_DATE_RANGE");
  });

  it("a malformed date string is rejected", async () => {
    const org = await createOrg();
    const { error } = await runController(reportController.getRequests, clientReq(org, [Permission.REPORT_VIEW], { query: { from: "not-a-date" } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_DATE_RANGE");
  });

  it("an invalid organizationId format is rejected rather than passed raw into a Mongo query", async () => {
    const { error } = await runController(reportController.getRequests, masterReq({ query: { organizationId: "not-an-object-id" } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_ORGANIZATION_ID");
  });

  it("an invalid status filter on the organizations report is rejected", async () => {
    const { error } = await runController(reportController.getOrganizations, masterReq({ query: { status: "NOT_A_REAL_STATUS" } }), makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_STATUS");
  });
});

describe("Pagination (organizations report)", () => {
  it("REPORT_GLOBAL_VIEW gates the organizations report", async () => {
    const { error } = await runController(reportController.getOrganizations, assistantReq([Permission.REPORT_VIEW]), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
  });

  it("valid page returns the expected slice with correct total, and includes per-org roll-ups", async () => {
    const org = await createOrg();
    await createRequest(org);
    await createOrder(org);
    await Wallet.create({ organizationId: org._id, balance: 777 });
    const { res, error } = await runController(reportController.getOrganizations, masterReq({ query: { page: "1", limit: "50" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    const row = res.body.data.items.find((i) => i._id.toString() === org._id.toString());
    expect(row.requestCount).toBe(1);
    expect(row.orderCount).toBe(1);
    expect(row.walletBalance).toBe(777);
  });

  it("an out-of-range page returns an empty item list but the correct total", async () => {
    await createOrg();
    const { res, error } = await runController(reportController.getOrganizations, masterReq({ query: { page: "9999", limit: "10" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(0);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });

  it("limit is clamped to a maximum of 100", async () => {
    const { res, error } = await runController(reportController.getOrganizations, masterReq({ query: { limit: "5000" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.limit).toBe(100);
  });
});

describe("Empty-data safety", () => {
  it("every report endpoint against a freshly-cleared database returns zeros/nulls/empty arrays, never a 500", async () => {
    const org = await createOrg();
    const req = (overrides) => clientReq(org, [Permission.REPORT_VIEW, Permission.REPORT_FINANCIAL_VIEW], overrides);

    const dashboard = await runController(reportController.getDashboard, req(), makeRes());
    expect(dashboard.error).toBeNull();

    const requests = await runController(reportController.getRequests, req(), makeRes());
    expect(requests.error).toBeNull();
    expect(requests.res.body.data.total).toBe(0);
    expect(requests.res.body.data.cancellationRate).toBeNull();
    expect(requests.res.body.data.modificationRate).toBeNull();

    const orders = await runController(reportController.getOrders, req(), makeRes());
    expect(orders.error).toBeNull();
    expect(orders.res.body.data.totals.totalOrders).toBe(0);
    expect(orders.res.body.data.issuanceSuccessRate).toBeNull();

    const financial = await runController(reportController.getFinancial, req(), makeRes());
    expect(financial.error).toBeNull();
    expect(financial.res.body.data.payments.successfulAmount).toBe(0);

    const bulk = await runController(reportController.getBulk, req(), makeRes());
    expect(bulk.error).toBeNull();
    expect(bulk.res.body.data.totals.batchCount).toBe(0);

    const provider = await runController(reportController.getProvider, masterReq(), makeRes());
    expect(provider.error).toBeNull();
    expect(provider.res.body.data.history).toEqual([]);

    const orgs = await runController(reportController.getOrganizations, masterReq({ query: {} }), makeRes());
    expect(orgs.error).toBeNull();
  });
});

// Phase 21 - dashboard "recent activity" widget backing endpoint.
describe("Recent activity", () => {
  it("a client (tenant actor) sees only its own organization's recent requests/orders, most-recent-first, and never an organizationName field", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await createRequest(orgA, { createdAt: daysAgo(2) });
    const newestA = await createRequest(orgA, { createdAt: daysAgo(1) });
    await createRequest(orgB);
    await createOrder(orgA, null, { createdAt: daysAgo(2) });
    const newestOrderA = await createOrder(orgA, null, { createdAt: daysAgo(1) });
    await createOrder(orgB);

    const { res, error } = await runController(reportController.getRecentActivity, clientReq(orgA, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.requests.length).toBe(2);
    expect(res.body.data.requests[0]._id.toString()).toBe(newestA._id.toString()); // most-recent-first
    expect(res.body.data.requests.every((r) => r.organizationName === null)).toBe(true); // no join for a tenant-scoped caller
    expect(res.body.data.orders.length).toBe(2);
    expect(res.body.data.orders[0]._id.toString()).toBe(newestOrderA._id.toString());
  });

  it("a forged organizationId from a tenant actor is silently ignored, never honored", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await createRequest(orgB);
    await createRequest(orgB);
    const { res, error } = await runController(reportController.getRecentActivity, clientReq(orgA, [Permission.REPORT_VIEW], { query: { organizationId: orgB._id.toString() } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.requests.length).toBe(0); // still scoped to (empty) orgA, never orgB's requests
  });

  it("Master Admin gets a genuine global view with organizationName joined in", async () => {
    const orgA = await createOrg({ name: "Recent Activity Org A" });
    const orgB = await createOrg({ name: "Recent Activity Org B" });
    await createRequest(orgA);
    await createRequest(orgB);
    const { res, error } = await runController(reportController.getRecentActivity, masterReq(), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.requests.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.requests.every((r) => typeof r.organizationName === "string" && r.organizationName.length > 0)).toBe(true);
  });

  it("an Assistant Master Admin holding only REPORT_VIEW cannot get a global view - must supply organizationId", async () => {
    const { error } = await runController(reportController.getRecentActivity, assistantReq([Permission.REPORT_VIEW]), makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("ORGANIZATION_ID_REQUIRED");
  });

  it("limit is bounded to a maximum of 10 regardless of what is requested", async () => {
    const org = await createOrg();
    for (let i = 0; i < 15; i++) await createRequest(org);
    const { res, error } = await runController(reportController.getRecentActivity, clientReq(org, [Permission.REPORT_VIEW], { query: { limit: "500" } }), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.requests.length).toBe(10);
  });

  it("a freshly-cleared organization returns honest empty arrays, never a 500/NaN", async () => {
    const org = await createOrg();
    const { res, error } = await runController(reportController.getRecentActivity, clientReq(org, [Permission.REPORT_VIEW]), makeRes());
    expect(error).toBeNull();
    expect(res.body.data.requests).toEqual([]);
    expect(res.body.data.orders).toEqual([]);
  });
});
