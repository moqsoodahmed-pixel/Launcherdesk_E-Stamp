// Balance-ledger flow: Razorpay payments wait for an admin to credit them,
// requests RESERVE at submit and are CHARGED (one DEBIT) when the window
// closes, and Assistant Master Admins only reach organizations assigned to
// them. Endpoints run over real HTTP so authenticate/authorize/validation
// run exactly as wired; reserve/charge mechanics are exercised directly.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup";
import crypto from "crypto";
import mongoose from "mongoose";
import { Organization, Wallet, WalletTransaction, Payment, User, Article, ArticleVersion, EStampRequest, EStampOrder, AuditLog, Notification } from "../src/models/index.js";
import { Role, Permission, OrganizationStatus, PaymentStatus, EStampRequestStatus, AuditAction } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import { PaymentService } from "../src/services/payment.service.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { reserveFunds } from "../src/services/wallet.service.js";
import { migrateBalanceLedger } from "../src/scripts/migrate-balance-ledger.js";
import { createApp } from "../src/app.js";

const uid = () => new mongoose.Types.ObjectId();
const checkoutSig = (o, p) => crypto.createHmac("sha256", "mock_secret_dev_only").update(`${o}|${p}`).digest("hex");
const webhookSig = (raw) => crypto.createHmac("sha256", "mock_webhook_secret_dev_only").update(raw).digest("hex");

let server;
let base;
beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());

function call(method, path, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

async function makeUser(role, overrides = {}) {
  const user = await User.create({
    name: `${role} user`,
    email: `${role.toLowerCase()}-${uid()}@ld.local`,
    passwordHash: await AuthService.hashPassword("ChangeMe!User1"),
    role,
    lastOtpVerifiedAt: new Date(),
    ...overrides,
  });
  const { accessToken } = await AuthService.issueTokens(user);
  return { user, token: accessToken };
}
const ASSISTANT_PERMS = [Permission.CLIENT_VIEW, Permission.WALLET_VIEW, Permission.WALLET_MANAGE, Permission.PAYMENT_VIEW, Permission.ORDER_VIEW, Permission.ESTAMP_VIEW];
const makeAssistant = (overrides = {}) => makeUser(Role.ASSISTANT_MASTER_ADMIN, { permissions: ASSISTANT_PERMS, ...overrides });

async function makeOrg({ balance = 0, assignedAssistantId = null, fixedAmount = 500 } = {}) {
  const creator = uid();
  const org = await Organization.create({
    name: `Ledger Co ${uid()}`,
    contactEmail: `ledger-${uid()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
    assignedAssistantId,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `LED-${uid()}`, title: "Ledger Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  return { org, article };
}

function createRequest(org, article, overrides = {}) {
  return EStampRequestService.createRequest({
    organizationId: org._id,
    createdBy: uid(),
    stateCode: "KA",
    articleId: article._id.toString(),
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Ledger test",
    considerationPrice: 0,
    stampDutyPaidBy: "Alice",
    numberOfEStamps: 1,
    // Real clients (New Request page, bulk) always send one per submission.
    idempotencyKey: `ledger-${uid()}`,
    ...overrides,
  });
}

async function verifiedPayment(org, amount = 1000) {
  const o = await PaymentService.createOrder({ organizationId: org._id, userId: uid(), amount });
  const pid = `pay_${uid()}`;
  await PaymentService.confirmPayment({ razorpayOrderId: o.razorpayOrderId, razorpayPaymentId: pid, razorpaySignature: checkoutSig(o.razorpayOrderId, pid), userId: uid() });
  return { ...o, razorpayPaymentId: pid };
}

const wallet = (org) => Wallet.findOne({ organizationId: org._id });
const expire = (request) => EStampRequest.updateOne({ _id: request._id }, { $set: { modificationDeadline: new Date(Date.now() - 1000) } });

describe("Razorpay payment -> pending credit -> credited by the assigned assistant", () => {
  it("verify marks SUCCESS + PENDING_CREDIT, does not credit, and notifies the assigned assistant", async () => {
    const { user: assistant } = await makeAssistant();
    const { org } = await makeOrg({ assignedAssistantId: assistant._id });
    const p = await verifiedPayment(org, 1200);
    const payment = await Payment.findById(p.paymentId);
    expect(payment.status).toBe(PaymentStatus.SUCCESS);
    expect(payment.balanceStatus).toBe("PENDING_CREDIT");
    expect((await wallet(org)).balance).toBe(0);
    const note = await Notification.findOne({ recipientId: assistant._id, entityId: payment._id });
    expect(note).not.toBeNull();
    expect(note.title).toMatch(/waiting to be credited/i);
  });

  it("with no assigned assistant, every Master Admin is notified instead", async () => {
    const { user: master } = await makeUser(Role.MASTER_ADMIN);
    const { org } = await makeOrg();
    const p = await verifiedPayment(org, 300);
    expect(await Notification.findOne({ recipientId: master._id, entityId: p.paymentId })).not.toBeNull();
  });

  it("the assigned assistant credits exactly once: second call 409, ledger + audit + client notification written", async () => {
    const { user: assistant, token } = await makeAssistant();
    const { org } = await makeOrg({ balance: 100, assignedAssistantId: assistant._id });
    const { user: superAdmin } = await makeUser(Role.SUPER_ADMIN, { organizationId: org._id });
    const p = await verifiedPayment(org, 1000);

    const first = await call("POST", `/payments/${p.paymentId}/credit-balance`, token);
    expect(first.status).toBe(200);
    expect(first.body.data.payment.balanceStatus).toBe("CREDITED");
    expect(first.body.data.balance).toBe(1100);
    const tx = await WalletTransaction.findOne({ idempotencyKey: `payment:${p.paymentId}` });
    expect(tx.type).toBe("CREDIT");
    expect(tx.amount).toBe(1000);
    expect(tx.description).toBe(`Balance added, payment ${p.razorpayPaymentId}`);

    const second = await call("POST", `/payments/${p.paymentId}/credit-balance`, token);
    expect(second.status).toBe(409);
    expect(second.body.code || second.body.error?.code).toBeDefined();
    expect((await wallet(org)).balance).toBe(1100);
    expect(await WalletTransaction.countDocuments({ organizationId: org._id })).toBe(1);

    const audit = await AuditLog.findOne({ action: AuditAction.BALANCE_CHANGED, entityId: p.paymentId.toString() });
    expect(audit.actorId.toString()).toBe(assistant._id.toString());
    expect(await Notification.findOne({ recipientId: superAdmin._id, title: "Balance updated" })).not.toBeNull();
  });

  it("webhook + verify + concurrent credits never credit more than once", async () => {
    const { user: master, token } = await makeUser(Role.MASTER_ADMIN);
    const { org } = await makeOrg();
    const o = await PaymentService.createOrder({ organizationId: org._id, userId: uid(), amount: 800 });
    const pid = `pay_${uid()}`;
    const raw = Buffer.from(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: pid, order_id: o.razorpayOrderId, status: "captured" } } } }));
    await Promise.all([
      PaymentService.handleWebhook(raw, webhookSig(raw)),
      PaymentService.confirmPayment({ razorpayOrderId: o.razorpayOrderId, razorpayPaymentId: pid, razorpaySignature: checkoutSig(o.razorpayOrderId, pid), userId: uid() }),
    ]);
    const results = await Promise.all([1, 2, 3].map(() => call("POST", `/payments/${o.paymentId}/credit-balance`, token)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await wallet(org)).balance).toBe(800);
    expect(await WalletTransaction.countDocuments({ organizationId: org._id })).toBe(1);
    expect(master).toBeDefined();
  });

  it("an unassigned assistant gets 403, a client gets 403, and an unpaid payment cannot be credited", async () => {
    const { user: assigned } = await makeAssistant();
    const { token: otherAssistant } = await makeAssistant();
    const { org } = await makeOrg({ assignedAssistantId: assigned._id });
    const { token: client } = await makeUser(Role.SUPER_ADMIN, { organizationId: org._id });
    const p = await verifiedPayment(org, 500);
    expect((await call("POST", `/payments/${p.paymentId}/credit-balance`, otherAssistant)).status).toBe(403);
    expect((await call("POST", `/payments/${p.paymentId}/credit-balance`, client)).status).toBe(403);
    expect((await wallet(org)).balance).toBe(0);

    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const unpaid = await PaymentService.createOrder({ organizationId: org._id, userId: uid(), amount: 50 });
    expect((await call("POST", `/payments/${unpaid.paymentId}/credit-balance`, master)).status).toBe(409);
  });

  it("an assistant without WALLET_MANAGE is refused even for an assigned organization", async () => {
    const { user, token } = await makeAssistant({ permissions: [Permission.PAYMENT_VIEW, Permission.WALLET_VIEW] });
    const { org } = await makeOrg({ assignedAssistantId: user._id });
    const p = await verifiedPayment(org, 500);
    expect((await call("POST", `/payments/${p.paymentId}/credit-balance`, token)).status).toBe(403);
  });
});

describe("Assistant scoping (tenant isolation for internal staff)", () => {
  it("lists, details and wallets only cover assigned organizations; none assigned = none visible", async () => {
    const { user: a, token: tokenA } = await makeAssistant();
    const { token: idle } = await makeAssistant();
    const { org: mine } = await makeOrg({ balance: 700, assignedAssistantId: a._id });
    const { org: theirs } = await makeOrg({ balance: 900 });
    await verifiedPayment(mine, 111);
    await verifiedPayment(theirs, 222);

    const orgs = await call("GET", "/organizations", tokenA);
    expect(orgs.body.data.items.map((o) => o._id)).toEqual([mine._id.toString()]);
    expect((await call("GET", "/organizations", idle)).body.data.items).toHaveLength(0);
    expect((await call("GET", `/organizations/${theirs._id}`, tokenA)).status).toBe(403);
    expect((await call("GET", `/organizations/${mine._id}`, tokenA)).status).toBe(200);

    const queue = await call("GET", "/payments?balanceStatus=PENDING_CREDIT", tokenA);
    expect(queue.body.data.items.map((p) => p.amount)).toEqual([111]);
    const spoof = await call("GET", `/payments?organizationId=${theirs._id}`, tokenA);
    expect(spoof.body.data.items).toHaveLength(0);
    expect((await call("GET", "/payments", idle)).body.data.items).toHaveLength(0);

    expect((await call("GET", `/wallet/${theirs._id}/balance`, tokenA)).status).toBe(403);
    expect((await call("GET", `/wallet/${theirs._id}/transactions`, tokenA)).status).toBe(403);
    const bal = await call("GET", `/wallet/${mine._id}/balance`, tokenA);
    expect(bal.body.data).toMatchObject({ balance: 700, reservedBalance: 0, availableBalance: 700 });

    const summary = await call("GET", "/payments/credit-summary", tokenA);
    expect(summary.body.data).toMatchObject({ totalReceived: 111, pendingAmount: 111, pendingCount: 1, totalCredited: 0 });
  });

  it("manual credit is scoped and requires a written reason", async () => {
    const { user: a, token } = await makeAssistant();
    const { org: mine } = await makeOrg({ assignedAssistantId: a._id });
    const { org: theirs } = await makeOrg();
    expect((await call("POST", `/wallet/${theirs._id}/credit`, token, { amount: 100, description: "Bank transfer ref 1" })).status).toBe(403);
    expect((await call("POST", `/wallet/${mine._id}/credit`, token, { amount: 100 })).status).toBe(400);
    expect((await call("POST", `/wallet/${mine._id}/credit`, token, { amount: 100, description: "  " })).status).toBe(400);
    const ok = await call("POST", `/wallet/${mine._id}/credit`, token, { amount: 100, description: "NEFT UTR 12345" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.balance).toBe(100);
    expect((await wallet(theirs)).balance).toBe(0);
  });

  it("orders and requests listings for an assistant only include assigned organizations", async () => {
    const { user: a, token } = await makeAssistant();
    const { org: mine, article: artMine } = await makeOrg({ balance: 5000, assignedAssistantId: a._id });
    const { org: theirs, article: artTheirs } = await makeOrg({ balance: 5000 });
    const { order: orderMine } = await createRequest(mine, artMine);
    const { request: reqTheirs, order: orderTheirs } = await createRequest(theirs, artTheirs);
    const orders = await call("GET", "/orders", token);
    expect(orders.body.data.items.map((o) => o._id)).toEqual([orderMine._id.toString()]);
    const requests = await call("GET", "/estamps", token);
    expect(requests.body.data.items.every((r) => r.organizationId === mine._id.toString())).toBe(true);
    expect((await call("GET", `/orders/${orderTheirs._id}`, token)).status).toBe(404);
    expect((await call("GET", `/estamps/${reqTheirs._id}`, token)).status).toBe(404);
  });

  it("assignment: Master Admin only, target must be an active assistant, audited and notified", async () => {
    const { token: master, user: masterUser } = await makeUser(Role.MASTER_ADMIN);
    const { user: assistant, token: assistantToken } = await makeAssistant();
    const { user: inactive } = await makeAssistant({ isActive: false });
    const { user: notAssistant } = await makeUser(Role.MASTER_ADMIN);
    const { org } = await makeOrg();

    expect((await call("PATCH", `/organizations/${org._id}/assigned-assistant`, assistantToken, { assistantId: assistant._id })).status).toBe(403);
    expect((await call("PATCH", `/organizations/${org._id}/assigned-assistant`, master, { assistantId: inactive._id })).status).toBe(400);
    expect((await call("PATCH", `/organizations/${org._id}/assigned-assistant`, master, { assistantId: notAssistant._id })).status).toBe(400);
    expect((await call("PATCH", `/organizations/${org._id}/assigned-assistant`, master, {})).status).toBe(400);

    const ok = await call("PATCH", `/organizations/${org._id}/assigned-assistant`, master, { assistantId: assistant._id });
    expect(ok.status).toBe(200);
    expect(ok.body.data.assignedAssistant.email).toBe(assistant.email);
    expect((await Organization.findById(org._id)).assignedAssistantId.toString()).toBe(assistant._id.toString());
    const audit = await AuditLog.findOne({ action: AuditAction.ORG_MODIFIED, entityId: org._id.toString(), actorId: masterUser._id });
    expect(audit.metadata.assignedAssistantId).toBe(assistant._id.toString());
    expect(await Notification.findOne({ recipientId: assistant._id, title: "Client assigned to you" })).not.toBeNull();
    const detail = await call("GET", `/organizations/${org._id}`, master);
    expect(detail.body.data.assignedAssistant._id).toBe(assistant._id.toString());

    const cleared = await call("PATCH", `/organizations/${org._id}/assigned-assistant`, master, { assistantId: null });
    expect(cleared.status).toBe(200);
    expect((await Organization.findById(org._id)).assignedAssistantId).toBeNull();
  });

  it("Master Admin can assign at creation; an assistant creating a client is assigned to it", async () => {
    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const { user: assistant, token: assistantToken } = await makeAssistant({ permissions: [...ASSISTANT_PERMS, Permission.CLIENT_MANAGE] });
    const body = (n) => ({ name: `Created ${n}`, contactEmail: `c-${uid()}@example.com`, contactPhone: "9999999999", superAdminName: "Client Owner" });
    const byMaster = await call("POST", "/organizations", master, { ...body(1), assignedAssistantId: assistant._id.toString() });
    expect(byMaster.status).toBe(201);
    expect(byMaster.body.data.organization.assignedAssistantId).toBe(assistant._id.toString());
    const byAssistant = await call("POST", "/organizations", assistantToken, body(2));
    expect(byAssistant.body.data.organization.assignedAssistantId).toBe(assistant._id.toString());
  });
});

describe("Reservations at submit", () => {
  it("blocks overspend, including many concurrent submits", async () => {
    const { org, article } = await makeOrg({ balance: 1000, fixedAmount: 300 });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => createRequest(org, article)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3); // 3 x 300 <= 1000
    expect(results.filter((r) => r.status === "rejected").every((r) => r.reason.code === "INSUFFICIENT_BALANCE")).toBe(true);
    const w = await wallet(org);
    expect(w.balance).toBe(1000);
    expect(w.reservedBalance).toBe(900);
    expect(await EStampRequest.countDocuments({ organizationId: org._id })).toBe(3);
  });

  it("rejects when available (balance - reserved) is too low even though balance alone would cover it", async () => {
    const { org, article } = await makeOrg({ balance: 600, fixedAmount: 500 });
    await createRequest(org, article);
    await expect(createRequest(org, article)).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("cancel inside the window releases the reservation and leaves the balance untouched", async () => {
    const { org, article } = await makeOrg({ balance: 1000 });
    const { request } = await createRequest(org, article);
    const cancelled = await EStampRequestService.cancelRequest(request._id.toString(), org._id, uid().toString(), Role.SUPER_ADMIN);
    expect(cancelled.chargeStatus).toBe("RELEASED");
    const w = await wallet(org);
    expect(w.balance).toBe(1000);
    expect(w.reservedBalance).toBe(0);
    // A repeat cancel is a no-op and never releases twice.
    await EStampRequestService.cancelRequest(request._id.toString(), org._id, uid().toString(), Role.SUPER_ADMIN);
    expect((await wallet(org)).reservedBalance).toBe(0);
    expect(await WalletTransaction.countDocuments({ organizationId: org._id })).toBe(0);
  });

  it("modify adjusts the reservation up and down, and an unaffordable increase changes nothing", async () => {
    const creator = uid();
    const org = await Organization.create({ name: "Pct Co", contactEmail: `pct-${uid()}@example.com`, contactPhone: "1", createdBy: creator, status: OrganizationStatus.ACTIVE, isEstampServiceEnabled: true });
    await Wallet.create({ organizationId: org._id, balance: 1000 });
    const article = await Article.create({ stateCode: "KA", articleCode: `PCT-${uid()}`, title: "Per stamp", createdBy: creator, currentVersion: 1 });
    await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 200 }, createdBy: creator });
    const { request } = await createRequest(org, article); // 200
    expect((await wallet(org)).reservedBalance).toBe(200);

    const up = await EStampRequestService.modifyRequest(request._id.toString(), org._id, uid().toString(), Role.SUPER_ADMIN, { numberOfEStamps: 3 });
    expect(up.reservedAmount).toBe(600);
    expect(up.calculatedStampDuty).toBe(600);
    expect((await wallet(org)).reservedBalance).toBe(600);
    expect((await EStampOrder.findOne({ requestId: request._id })).amount).toBe(600);

    await expect(
      EStampRequestService.modifyRequest(request._id.toString(), org._id, uid().toString(), Role.SUPER_ADMIN, { numberOfEStamps: 10 })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect((await wallet(org)).reservedBalance).toBe(600);
    expect((await EStampRequest.findById(request._id)).numberOfEStamps).toBe(3);

    const down = await EStampRequestService.modifyRequest(request._id.toString(), org._id, uid().toString(), Role.SUPER_ADMIN, { numberOfEStamps: 1 });
    expect(down.reservedAmount).toBe(200);
    const w = await wallet(org);
    expect(w.reservedBalance).toBe(200);
    expect(w.balance).toBe(1000);
  });
});

describe("Charge at lock", () => {
  it("lock converts the reservation into exactly one DEBIT, and the job is idempotent", async () => {
    const { org, article } = await makeOrg({ balance: 1000 });
    const { request } = await createRequest(org, article);
    await expire(request);
    await EStampRequestService.lockExpiredRequests();
    await EStampRequestService.lockExpiredRequests();
    await EStampRequestService.sweepReservations();
    const locked = await EStampRequest.findById(request._id);
    expect(locked.status).toBe(EStampRequestStatus.LOCKED);
    expect(locked.chargeStatus).toBe("CHARGED");
    const w = await wallet(org);
    expect(w.balance).toBe(500);
    expect(w.reservedBalance).toBe(0);
    const debits = await WalletTransaction.find({ organizationId: org._id, type: "DEBIT" });
    expect(debits).toHaveLength(1);
    expect(debits[0].idempotencyKey).toBe(`estamp-charge:${request._id}`);
    expect(debits[0].description).toBe(`E-Stamp request ${request.requestNumber}`);
    expect((await EStampOrder.findOne({ requestId: request._id })).paymentStatus).toBe("PAID");
  });

  it("the sweep charges a request left LOCKED + RESERVED by a crash between lock and charge", async () => {
    const { org, article } = await makeOrg({ balance: 1000 });
    const { request } = await createRequest(org, article);
    // Simulate: the lock flip committed, then the process died before charging.
    await EStampRequest.updateOne({ _id: request._id }, { $set: { status: EStampRequestStatus.LOCKED, lockedAt: new Date() } });
    expect(await EStampRequestService.lockExpiredRequests()).toBe(0); // nothing new to lock...
    const fixed = await EStampRequest.findById(request._id);
    expect(fixed.chargeStatus).toBe("CHARGED"); // ...but the sweep charged it
    expect((await wallet(org)).balance).toBe(500);
    expect(await WalletTransaction.countDocuments({ organizationId: org._id, type: "DEBIT" })).toBe(1);
  });

  it("SHORTFALL: an uncovered charge holds the request, notifies the assistant once, and charges after a top-up", async () => {
    const { user: assistant } = await makeAssistant();
    const { org, article } = await makeOrg({ balance: 500, assignedAssistantId: assistant._id });
    const { request, order } = await createRequest(org, article);
    // An admin correction lowered the balance below what is reserved.
    await Wallet.updateOne({ organizationId: org._id }, { $set: { balance: 200 } });
    await expire(request);
    await EStampRequestService.lockExpiredRequests();
    await EStampRequestService.lockExpiredRequests();
    const held = await EStampRequest.findById(request._id);
    expect(held.chargeStatus).toBe("SHORTFALL");
    expect((await wallet(org)).balance).toBe(200);
    expect(await WalletTransaction.countDocuments({ organizationId: org._id })).toBe(0);
    expect(await Notification.countDocuments({ recipientId: assistant._id, title: "E-Stamp charge shortfall" })).toBe(1);
    await expect(
      EStampRequestService.processOrder(order._id.toString(), org._id.toString(), uid().toString(), Role.MASTER_ADMIN)
    ).rejects.toMatchObject({ code: "CHARGE_PENDING" });

    await Wallet.updateOne({ organizationId: org._id }, { $inc: { balance: 400 } });
    await EStampRequestService.sweepReservations();
    expect((await EStampRequest.findById(request._id)).chargeStatus).toBe("CHARGED");
    const w = await wallet(org);
    expect(w.balance).toBe(100);
    expect(w.reservedBalance).toBe(0);
  });

  it("cannot cancel after lock, and nothing is refunded", async () => {
    const { org, article } = await makeOrg({ balance: 1000 });
    const { request } = await createRequest(org, article);
    await expire(request);
    await EStampRequestService.lockExpiredRequests();
    await expect(
      EStampRequestService.cancelRequest(request._id.toString(), org._id, uid().toString(), Role.SUPER_ADMIN)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await wallet(org)).balance).toBe(500);
    expect(await WalletTransaction.countDocuments({ organizationId: org._id, type: "CREDIT" })).toBe(0);
  });

  it("bulk requests take the same reserve-then-charge path", async () => {
    const { org, article } = await makeOrg({ balance: 1000 });
    const a = await createRequest(org, article, { idempotencyKey: `bulk:x:row:1` });
    const b = await createRequest(org, article, { idempotencyKey: `bulk:x:row:2` });
    expect((await wallet(org)).reservedBalance).toBe(1000);
    await expire(a.request);
    await expire(b.request);
    await EStampRequestService.lockExpiredRequests();
    const w = await wallet(org);
    expect(w.balance).toBe(0);
    expect(w.reservedBalance).toBe(0);
  });
});

describe("Legacy data is never processed twice", () => {
  it("legacy requests (no chargeStatus) are never charged; legacy SUCCESS payments read as credited", async () => {
    const { org, article } = await makeOrg({ balance: 1000 });
    const { request } = await createRequest(org, article);
    // Shape of a pre-change request: already debited at submit, no chargeStatus.
    await EStampRequest.updateOne({ _id: request._id }, { $set: { status: EStampRequestStatus.LOCKED }, $unset: { chargeStatus: "", reservedAmount: "" } });
    await Wallet.updateOne({ organizationId: org._id }, { $set: { reservedBalance: 0 } });
    await EStampRequestService.lockExpiredRequests();
    expect(await WalletTransaction.countDocuments({ organizationId: org._id })).toBe(0);
    expect((await wallet(org)).balance).toBe(1000);

    const { token: master } = await makeUser(Role.MASTER_ADMIN);
    const legacy = await Payment.create({ organizationId: org._id, amount: 400, razorpayOrderId: `order_${uid()}`, razorpayPaymentId: `pay_${uid()}`, status: PaymentStatus.SUCCESS, createdBy: uid() });
    expect((await call("POST", `/payments/${legacy._id}/credit-balance`, master)).status).toBe(409);
    const credited = await call("GET", `/payments?balanceStatus=CREDITED&organizationId=${org._id}`, master);
    expect(credited.body.data.items.map((p) => p._id)).toContain(legacy._id.toString());
  });

  it("the migration is idempotent and never touches balances or the ledger", async () => {
    const { org } = await makeOrg({ balance: 900 });
    await Wallet.collection.updateOne({ organizationId: org._id }, { $unset: { reservedBalance: "" } });
    const legacyCredited = await Payment.create({ organizationId: org._id, amount: 300, razorpayOrderId: `order_${uid()}`, razorpayPaymentId: `pay_${uid()}`, status: PaymentStatus.SUCCESS, createdBy: uid() });
    await WalletTransaction.create({ organizationId: org._id, type: "CREDIT", amount: 300, balanceBefore: 600, balanceAfter: 900, referenceType: "PAYMENT", referenceId: legacyCredited._id, idempotencyKey: `payment:${legacyCredited._id}` });
    const legacyUncredited = await Payment.create({ organizationId: org._id, amount: 50, razorpayOrderId: `order_${uid()}`, razorpayPaymentId: `pay_${uid()}`, status: PaymentStatus.SUCCESS, createdBy: uid() });
    const legacyRequest = await EStampRequest.collection.insertOne({
      requestNumber: `LDE-REQ-LEGACY-${uid()}`, organizationId: org._id, createdBy: uid(), stateCode: "KA", articleId: uid(), articleVersionUsed: 1,
      firstParty: "A", secondParty: "B", descriptionOfDocument: "D", considerationPrice: 0, stampDutyPaidBy: "A", numberOfEStamps: 1,
      calculatedStampDuty: 100, status: "LOCKED", modificationDeadline: new Date(Date.now() - 60000),
    });

    await migrateBalanceLedger();
    const second = await migrateBalanceLedger();
    expect(second).toMatchObject({ requestsMarkedCharged: 0, walletsInitialized: 0, paymentsMarkedCredited: 0, paymentsMarkedPendingCredit: 0 });

    expect((await Payment.findById(legacyCredited._id)).balanceStatus).toBe("CREDITED");
    expect((await Payment.findById(legacyUncredited._id)).balanceStatus).toBe("PENDING_CREDIT");
    expect((await EStampRequest.findById(legacyRequest.insertedId)).chargeStatus).toBe("CHARGED");
    const w = await Wallet.collection.findOne({ organizationId: org._id });
    expect(w.balance).toBe(900);
    expect(w.reservedBalance).toBe(0);
    expect(await WalletTransaction.countDocuments({ organizationId: org._id })).toBe(1);
  });
});

describe("wallet primitives", () => {
  it("reserveFunds treats a wallet without reservedBalance as 0 reserved", async () => {
    const { org } = await makeOrg({ balance: 100 });
    await Wallet.collection.updateOne({ organizationId: org._id }, { $unset: { reservedBalance: "" } });
    expect((await reserveFunds({ organizationId: org._id, amount: 100 })).success).toBe(true);
    expect((await reserveFunds({ organizationId: org._id, amount: 1 })).success).toBe(false);
  });
});
