// Follow-up hardening for the balance-ledger flow:
//  1. the new API running BEFORE the migration never charges/credits twice
//  2. ledger-first writes survive a crash between "ledger insert" and
//     "wallet update" (and between "wallet update" and "finalize")
//  3. /users scoped for Assistant Master Admins (reports: report.test.js)
//  4. partial unique idempotency index + its migration
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Organization, Wallet, WalletTransaction, Payment, User, Article, ArticleVersion, EStampRequest, IDEMPOTENCY_INDEX_NAME } from "../src/models/index.js";
import { Role, Permission, OrganizationStatus, PaymentStatus, EStampRequestStatus } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import { PaymentService } from "../src/services/payment.service.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { creditWallet, chargeReservation, reserveFunds, reconcileWallets } from "../src/services/wallet.service.js";
import { migrateIdempotencyIndex } from "../src/scripts/migrate-idempotency-index.js";
import { createApp } from "../src/app.js";

const uid = () => new mongoose.Types.ObjectId();
let server;
let base;
beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());
const call = (method, path, token, body) =>
  fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));

async function makeUser(role, overrides = {}) {
  const user = await User.create({ name: `${role} u`, email: `${role.toLowerCase()}-${uid()}@ld.local`, passwordHash: await AuthService.hashPassword("ChangeMe!User1"), role, lastOtpVerifiedAt: new Date(), ...overrides });
  return { user, token: (await AuthService.issueTokens(user)).accessToken };
}
async function makeOrg(balance = 0, extra = {}) {
  const org = await Organization.create({ name: `Safe ${uid()}`, contactEmail: `s-${uid()}@example.com`, contactPhone: "1", createdBy: uid(), status: OrganizationStatus.ACTIVE, isEstampServiceEnabled: true, ...extra });
  await Wallet.create({ organizationId: org._id, balance });
  return org;
}
async function makeArticle(fixedAmount = 500) {
  const article = await Article.create({ stateCode: "KA", articleCode: `SAFE-${uid()}`, title: "Safe", createdBy: uid(), currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: uid() });
  return article;
}
const newRequest = (org, article, extra = {}) =>
  EStampRequestService.createRequest({ organizationId: org._id, createdBy: uid(), stateCode: "KA", articleId: article._id.toString(), firstParty: "A", secondParty: "B", descriptionOfDocument: "D", considerationPrice: 0, stampDutyPaidBy: "A", numberOfEStamps: 1, ...extra });
// A request exactly as the OLD code stored it: debited at submit, no
// chargeStatus/reservedAmount. Inserted raw so no schema logic runs.
async function legacyRequest(org, status, extra = {}) {
  const { insertedId } = await EStampRequest.collection.insertOne({
    requestNumber: `LDE-REQ-OLD-${uid()}`, organizationId: org._id, createdBy: uid(), stateCode: "KA", articleId: uid(), articleVersionUsed: 1,
    firstParty: "A", secondParty: "B", descriptionOfDocument: "D", considerationPrice: 0, stampDutyPaidBy: "A", numberOfEStamps: 1,
    calculatedStampDuty: 500, status, modificationDeadline: new Date(Date.now() - 60000), createdAt: new Date(), updatedAt: new Date(), ...extra,
  });
  return insertedId;
}

describe("1. New API before the migration (legacy rows untouched)", () => {
  it("lock job, sweep, cancel, credit and queue never touch legacy requests or payments", async () => {
    const org = await makeOrg(1000);
    // An old wallet document has no reservedBalance field at all.
    await Wallet.collection.updateOne({ organizationId: org._id }, { $unset: { reservedBalance: "" } });
    const lockedOld = await legacyRequest(org, EStampRequestStatus.LOCKED);
    const windowOld = await legacyRequest(org, EStampRequestStatus.MODIFICATION_WINDOW); // deadline already passed
    const openOld = await legacyRequest(org, EStampRequestStatus.MODIFICATION_WINDOW, { modificationDeadline: new Date(Date.now() + 600000) });
    const oldPayment = await Payment.collection.insertOne({ organizationId: org._id, amount: 700, currency: "INR", razorpayOrderId: `order_${uid()}`, razorpayPaymentId: `pay_${uid()}`, status: PaymentStatus.SUCCESS, createdBy: uid(), createdAt: new Date() });

    for (let i = 0; i < 3; i++) {
      await EStampRequestService.lockExpiredRequests();
      await EStampRequestService.sweepReservations();
    }
    // The in-window legacy request is cancelled under the new code.
    await EStampRequestService.cancelRequest(openOld.toString(), org._id, uid().toString(), Role.SUPER_ADMIN);
    await EStampRequestService.sweepReservations();

    await expect(PaymentService.creditPaymentToBalance(oldPayment.insertedId, { id: uid().toString() })).rejects.toMatchObject({ code: "ALREADY_CREDITED" });
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const queue = await call("GET", `/payments?balanceStatus=PENDING_CREDIT&organizationId=${org._id}`, master);
    expect(queue.body.data.items).toHaveLength(0);
    expect((await call("POST", `/payments/${oldPayment.insertedId}/credit-balance`, master)).status).toBe(409);

    // Nothing moved: no ledger entries, balance and (absent) reservation unchanged.
    expect(await WalletTransaction.countDocuments({ organizationId: org._id })).toBe(0);
    const w = await Wallet.collection.findOne({ organizationId: org._id });
    expect(w.balance).toBe(1000);
    expect(w.reservedBalance ?? 0).toBe(0);
    for (const id of [lockedOld, windowOld, openOld]) {
      const r = await EStampRequest.collection.findOne({ _id: id });
      expect(r.chargeStatus).toBeUndefined();
    }
    // The legacy expired request still locked normally (lifecycle unaffected).
    expect((await EStampRequest.collection.findOne({ _id: windowOld })).status).toBe(EStampRequestStatus.LOCKED);
    expect((await EStampRequest.collection.findOne({ _id: openOld })).status).toBe(EStampRequestStatus.CANCELLED);
  });

  it("a legacy request's amount cannot be changed and it is not held from processing", async () => {
    const org = await makeOrg(1000);
    const id = await legacyRequest(org, EStampRequestStatus.MODIFICATION_WINDOW, { modificationDeadline: new Date(Date.now() + 600000) });
    await expect(EStampRequestService.modifyRequest(id.toString(), org._id, uid().toString(), Role.SUPER_ADMIN, { numberOfEStamps: 2 })).rejects.toMatchObject({ code: "AMOUNT_LOCKED" });
    expect((await Wallet.findOne({ organizationId: org._id })).reservedBalance).toBe(0);
  });
});

describe("2. Ledger-first writes are crash-safe", () => {
  it("crash AFTER the ledger insert, BEFORE the wallet update: the retry credits exactly once", async () => {
    const org = await makeOrg(100);
    const payment = await Payment.create({ organizationId: org._id, amount: 400, razorpayOrderId: `order_${uid()}`, razorpayPaymentId: `pay_${uid()}`, status: PaymentStatus.SUCCESS, balanceStatus: "PENDING_CREDIT", createdBy: uid() });
    // What the first (crashed) attempt left behind: only the pending entry.
    await WalletTransaction.create({ organizationId: org._id, type: "CREDIT", amount: 400, balanceBefore: 0, balanceAfter: 0, referenceType: "PAYMENT", referenceId: payment._id, idempotencyKey: `payment:${payment._id}`, pending: true });
    const before = await reconcileWallets({ organizationId: org._id });
    expect(before[0].pendingEntries).toBe(1);
    // Pending entries are not part of the visible ledger.
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    expect((await call("GET", `/wallet/${org._id}/transactions`, master)).body.data.items).toHaveLength(0);

    await PaymentService.creditPaymentToBalance(payment._id, { id: uid().toString() });
    await creditWallet({ organizationId: org._id, amount: 400, referenceType: "PAYMENT", idempotencyKey: `payment:${payment._id}` }); // another retry
    const w = await Wallet.findOne({ organizationId: org._id });
    expect(w.balance).toBe(500);
    const entries = await WalletTransaction.find({ organizationId: org._id });
    expect(entries).toHaveLength(1);
    expect(entries[0].pending).toBeUndefined();
    expect(entries[0].balanceBefore).toBe(100);
    expect(entries[0].balanceAfter).toBe(500);
    expect((await Payment.findById(payment._id)).balanceStatus).toBe("CREDITED");
  });

  it("crash AFTER the wallet update, BEFORE finalizing: the retry does not move the balance again", async () => {
    const org = await makeOrg(100);
    const key = `manual:${uid()}`;
    const entry = await WalletTransaction.create({ organizationId: org._id, type: "CREDIT", amount: 250, balanceBefore: 0, balanceAfter: 0, referenceType: "MANUAL_ADJUSTMENT", idempotencyKey: key, pending: true });
    await Wallet.updateOne({ organizationId: org._id }, { $inc: { balance: 250 }, $push: { appliedTxIds: entry._id } });

    const tx = await creditWallet({ organizationId: org._id, amount: 250, referenceType: "MANUAL_ADJUSTMENT", idempotencyKey: key });
    expect((await Wallet.findOne({ organizationId: org._id })).balance).toBe(350);
    expect(tx.pending).toBeUndefined();
    expect(tx.balanceBefore).toBe(100);
    expect(tx.balanceAfter).toBe(350);
    expect(await reconcileWallets({ organizationId: org._id, includeAll: true })).toMatchObject([{ balanceDifference: 100, pendingEntries: 0 }]); // 100 = opening balance with no ledger
  });

  it("charge: a crash between ledger insert and wallet update is completed by the lock-job sweep, exactly one DEBIT", async () => {
    const org = await makeOrg(1000);
    const article = await makeArticle(500);
    const { request } = await newRequest(org, article, { idempotencyKey: `safe-${uid()}` });
    await EStampRequest.updateOne({ _id: request._id }, { $set: { status: EStampRequestStatus.LOCKED } });
    await WalletTransaction.create({ organizationId: org._id, type: "DEBIT", amount: 500, balanceBefore: 0, balanceAfter: 0, referenceType: "ESTAMP_REQUEST", referenceId: request._id, idempotencyKey: `estamp-charge:${request._id}`, pending: true });

    await EStampRequestService.lockExpiredRequests();
    await EStampRequestService.sweepReservations();
    const w = await Wallet.findOne({ organizationId: org._id });
    expect(w.balance).toBe(500);
    expect(w.reservedBalance).toBe(0);
    expect(await WalletTransaction.countDocuments({ organizationId: org._id, type: "DEBIT" })).toBe(1);
    expect((await EStampRequest.findById(request._id)).chargeStatus).toBe("CHARGED");
    expect(await reconcileWallets({ organizationId: org._id })).toEqual([
      expect.objectContaining({ balanceDifference: 1000, reservedDifference: 0, pendingEntries: 0 }), // only the un-ledgered opening 1000
    ]);
  });

  it("a SHORTFALL removes the pending entry it inserted, so nothing is left half-written", async () => {
    const org = await makeOrg(100);
    await Wallet.updateOne({ organizationId: org._id }, { $set: { reservedBalance: 300 } });
    const result = await chargeReservation({ organizationId: org._id, amount: 300, referenceType: "ESTAMP_REQUEST", idempotencyKey: `estamp-charge:${uid()}` });
    expect(result).toMatchObject({ success: false, reason: "SHORTFALL" });
    expect(await WalletTransaction.countDocuments({ organizationId: org._id })).toBe(0);
    const w = await Wallet.findOne({ organizationId: org._id });
    expect(w.balance).toBe(100);
    expect(w.reservedBalance).toBe(300);
  });

  it("many concurrent credits with one key move the balance once", async () => {
    const org = await makeOrg(0);
    const key = `payment:${uid()}`;
    await Promise.all(Array.from({ length: 8 }, () => creditWallet({ organizationId: org._id, amount: 50, referenceType: "PAYMENT", idempotencyKey: key })));
    expect((await Wallet.findOne({ organizationId: org._id })).balance).toBe(50);
    expect(await WalletTransaction.countDocuments({ idempotencyKey: key })).toBe(1);
  });

  it("reconcile reports a wallet changed outside the ledger and a reservation that matches no request", async () => {
    const clean = await makeOrg(0);
    await creditWallet({ organizationId: clean._id, amount: 300, referenceType: "MANUAL_ADJUSTMENT", idempotencyKey: `m:${uid()}` });
    const drifted = await makeOrg(0);
    await creditWallet({ organizationId: drifted._id, amount: 300, referenceType: "MANUAL_ADJUSTMENT", idempotencyKey: `m:${uid()}` });
    await Wallet.updateOne({ organizationId: drifted._id }, { $inc: { balance: 40 } }); // out-of-band change
    await reserveFunds({ organizationId: drifted._id, amount: 10 }); // no request holds it
    const report = await reconcileWallets();
    const ids = report.map((r) => r.organizationId);
    expect(ids).toContain(drifted._id.toString());
    expect(ids).not.toContain(clean._id.toString());
    expect(report.find((r) => r.organizationId === drifted._id.toString())).toMatchObject({ balance: 340, ledgerSum: 300, balanceDifference: 40, reservedDifference: 10 });
  });
});

describe("3. /users scoped for Assistant Master Admins", () => {
  it("lists and opens only users of assigned organizations", async () => {
    const { user: assistant, token } = await makeUser(Role.ASSISTANT_MASTER_ADMIN, { permissions: [Permission.USER_VIEW, Permission.USER_MANAGE] });
    const mine = await makeOrg(0, { assignedAssistantId: assistant._id });
    const theirs = await makeOrg(0);
    const { user: myUser } = await makeUser(Role.USER, { organizationId: mine._id });
    const { user: theirUser } = await makeUser(Role.USER, { organizationId: theirs._id });
    const { user: master } = await makeUser(Role.MASTER_ADMIN);

    const list = await call("GET", "/users", token);
    expect(list.body.data.items.map((u) => u._id)).toEqual([myUser._id.toString()]);
    expect((await call("GET", `/users?organizationId=${theirs._id}`, token)).body.data.items).toHaveLength(0);
    expect((await call("GET", `/users/${myUser._id}`, token)).status).toBe(200);
    expect((await call("GET", `/users/${theirUser._id}`, token)).status).toBe(404);
    expect((await call("GET", `/users/${master._id}`, token)).status).toBe(404);
    expect((await call("PATCH", `/users/${theirUser._id}/status`, token, { isActive: false })).status).toBe(404);
    expect((await User.findById(theirUser._id)).isActive).not.toBe(false);
  });
});

describe("4. Partial unique idempotency index", () => {
  it("two key-less requests in one organization both succeed; the same key still dedups", async () => {
    const org = await makeOrg(5000);
    const article = await makeArticle(100);
    await newRequest(org, article);
    await newRequest(org, article);
    const key = `dup-${uid()}`;
    const a = await newRequest(org, article, { idempotencyKey: key });
    const b = await newRequest(org, article, { idempotencyKey: key });
    expect(b.request._id.toString()).toBe(a.request._id.toString());
    expect(await EStampRequest.countDocuments({ organizationId: org._id })).toBe(3);
    expect((await Wallet.findOne({ organizationId: org._id })).reservedBalance).toBe(300);
  });

  it("the migration replaces the old sparse index, is idempotent, and refuses to run over real duplicates", async () => {
    const coll = EStampRequest.collection;
    await coll.dropIndex(IDEMPOTENCY_INDEX_NAME);
    await coll.createIndex({ organizationId: 1, idempotencyKey: 1 }, { unique: true, sparse: true, name: "organizationId_1_idempotencyKey_1" });

    const first = await migrateIdempotencyIndex();
    expect(first.status).toBe("MIGRATED");
    const names = (await coll.indexes()).map((i) => i.name);
    expect(names).toContain(IDEMPOTENCY_INDEX_NAME);
    expect(names).not.toContain("organizationId_1_idempotencyKey_1");
    expect((await migrateIdempotencyIndex()).status).toBe("ALREADY_MIGRATED");

    // Duplicates (only possible without any unique index) block the migration.
    await coll.dropIndex(IDEMPOTENCY_INDEX_NAME);
    const org = uid();
    await coll.insertMany([
      { requestNumber: `X-${uid()}`, organizationId: org, idempotencyKey: "same" },
      { requestNumber: `X-${uid()}`, organizationId: org, idempotencyKey: "same" },
    ]);
    const blocked = await migrateIdempotencyIndex();
    expect(blocked.status).toBe("BLOCKED_DUPLICATES");
    expect(blocked.duplicates[0].requestIds).toHaveLength(2);
    expect((await coll.indexes()).map((i) => i.name)).not.toContain(IDEMPOTENCY_INDEX_NAME);
    await EStampRequest.deleteMany({ organizationId: org });
    await migrateIdempotencyIndex(); // leave the collection as the app expects
  });
});
