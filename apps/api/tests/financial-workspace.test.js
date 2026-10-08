import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import crypto from "crypto";
import { Organization, Wallet, Payment } from "../src/models/index.js";
import { Role, Permission, OrganizationStatus } from "@launcherdesk/shared";
import * as paymentController from "../src/controllers/payment.controller.js";
import * as walletController from "../src/controllers/wallet.controller.js";
import * as reportController from "../src/controllers/report.controller.js";
import { PaymentService } from "../src/services/payment.service.js";
import { requirePermission, requireRole } from "../src/middleware/authorize.js";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

// Phase 25 - financial workspace backend contract.

const sig = (o, p) => crypto.createHmac("sha256", "mock_secret_dev_only").update(`${o}|${p}`).digest("hex");
const uid = () => new mongoose.Types.ObjectId();

async function makeOrg(balance, name = "Fin Co") {
  const org = await Organization.create({ name: `${name} ${uid()}`, contactEmail: `f-${uid()}@example.com`, contactPhone: "9999999999", createdBy: uid(), status: OrganizationStatus.ACTIVE });
  await Wallet.create({ organizationId: org._id, balance });
  return org;
}
const tenant = (org, permissions, role = Role.SUPER_ADMIN, o = {}) => makeReq({ user: { id: uid().toString(), role, organizationId: org._id.toString(), permissions }, ...o });
const master = (o = {}) => makeReq({ user: { id: uid().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) }, ...o });
const assistant = (permissions, o = {}) => makeReq({ user: { id: uid().toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions }, ...o });
const FIN = [Permission.PAYMENT_VIEW, Permission.PAYMENT_MANAGE, Permission.WALLET_VIEW, Permission.REPORT_VIEW, Permission.REPORT_FINANCIAL_VIEW];

async function paidPayment(org, amount = 500) {
  const o = await PaymentService.createOrder({ organizationId: org._id, userId: uid(), amount });
  const pid = `pay_${uid()}`;
  await PaymentService.confirmPayment({ razorpayOrderId: o.razorpayOrderId, razorpayPaymentId: pid, razorpaySignature: sig(o.razorpayOrderId, pid), userId: uid() });
  return { ...o, razorpayPaymentId: pid };
}

describe("Org A (10000) vs Org B (5000) isolation", () => {
  it("B cannot reach the balance, ledger, payments, payment detail or financial report of A via organizationId", async () => {
    const A = await makeOrg(10000);
    const B = await makeOrg(5000);
    const pa = await paidPayment(A, 700);
    const spoof = { params: { organizationId: A._id.toString() }, query: { organizationId: A._id.toString() } };

    const bal = await runController(walletController.getBalance, tenant(B, FIN, Role.SUPER_ADMIN, spoof), makeRes());
    expect(bal.res.body.data.balance).toBe(5000);
    const tx = await runController(walletController.listTransactions, tenant(B, FIN, Role.SUPER_ADMIN, spoof), makeRes());
    expect(tx.res.body.data.items).toHaveLength(0);

    const list = await runController(paymentController.listPayments, tenant(B, FIN, Role.SUPER_ADMIN, { query: { organizationId: A._id.toString() } }), makeRes());
    expect(list.res.body.data.items).toHaveLength(0);
    const detail = await runController(paymentController.getPayment, tenant(B, FIN, Role.SUPER_ADMIN, { params: { id: pa.paymentId.toString() } }), makeRes());
    expect(detail.error.statusCode).toBe(404);

    const rep = await runController(reportController.getFinancial, tenant(B, FIN, Role.SUPER_ADMIN, { query: { organizationId: A._id.toString() } }), makeRes());
    expect(rep.res.body.data.wallet.currentBalance).toBe(5000);
    expect(rep.res.body.data.payments.successfulCount).toBe(0);

    const ver = await runController(paymentController.verifyRazorpayPayment, tenant(B, FIN, Role.SUPER_ADMIN, { body: { razorpay_order_id: pa.razorpayOrderId, razorpay_payment_id: "x", razorpay_signature: "y" } }), makeRes());
    expect(ver.error.statusCode).toBe(404);
    expect((await Wallet.findOne({ organizationId: A._id })).balance).toBe(10700);
  });
});

describe("wallet permissions and scoping", () => {
  it("internal actor without an organizationId gets 400, not an auto-created wallet", async () => {
    const before = await Wallet.countDocuments();
    const r = await runController(walletController.getBalance, master({ params: {} }), makeRes());
    expect(r.error.statusCode).toBe(400);
    expect(await Wallet.countDocuments()).toBe(before);
  });

  it("internal actor with an invalid organizationId gets 400", async () => {
    const r = await runController(walletController.getBalance, master({ params: { organizationId: "nope" } }), makeRes());
    expect(r.error.statusCode).toBe(400);
  });

  it("the ledger route gate requires WALLET_VIEW (ADMIN/USER defaults lack it)", async () => {
    const r = await runMiddleware(requirePermission(Permission.WALLET_VIEW), tenant(await makeOrg(0), [Permission.ORDER_VIEW], Role.ADMIN), makeRes());
    expect(r.threw.statusCode).toBe(403);
  });

  it("an Assistant without WALLET_VIEW / PAYMENT_VIEW / REPORT_FINANCIAL_VIEW is refused", async () => {
    const a = assistant([Permission.ORDER_VIEW]);
    expect((await runMiddleware(requirePermission(Permission.WALLET_VIEW), a, makeRes())).threw.statusCode).toBe(403);
    expect((await runMiddleware(requirePermission(Permission.PAYMENT_VIEW), a, makeRes())).threw.statusCode).toBe(403);
    const rep = await runController(reportController.getFinancial, assistant([Permission.REPORT_VIEW], { query: { organizationId: uid().toString() } }), makeRes());
    expect(rep.error.statusCode).toBe(403);
  });

  it("client roles cannot use the internal per-organization wallet routes", async () => {
    const r = await runMiddleware(requireRole(Role.MASTER_ADMIN, Role.ASSISTANT_MASTER_ADMIN), tenant(await makeOrg(0), FIN), makeRes());
    expect(r.threw.statusCode).toBe(403);
  });

  it("transactions response reports page and limit, capped", async () => {
    const org = await makeOrg(0);
    await paidPayment(org, 100);
    const r = await runController(walletController.listTransactions, tenant(org, FIN, Role.SUPER_ADMIN, { query: { limit: "5000" } }), makeRes());
    expect(r.res.body.data.limit).toBe(100);
    expect(r.res.body.data.page).toBe(1);
    expect(r.res.body.data.items).toHaveLength(1);
  });
});

describe("payment list filters", () => {
  it("validates status and organizationId, and filters by status", async () => {
    const org = await makeOrg(0);
    await paidPayment(org, 300);
    await PaymentService.createOrder({ organizationId: org._id, userId: uid(), amount: 50 });
    expect((await runController(paymentController.listPayments, master({ query: { status: "BOGUS" } }), makeRes())).error.statusCode).toBe(400);
    expect((await runController(paymentController.listPayments, master({ query: { organizationId: "bad" } }), makeRes())).error.statusCode).toBe(400);
    const ok = await runController(paymentController.listPayments, tenant(org, FIN, Role.SUPER_ADMIN, { query: { status: "SUCCESS" } }), makeRes());
    expect(ok.res.body.data.items).toHaveLength(1);
    expect(ok.res.body.data.items[0].status).toBe("SUCCESS");
  });

  it("searches provider order/payment IDs literally and supports a date range", async () => {
    const org = await makeOrg(0);
    const p = await paidPayment(org, 120);
    const q = (query) => runController(paymentController.listPayments, tenant(org, FIN, Role.SUPER_ADMIN, { query }), makeRes());
    expect((await q({ search: p.razorpayOrderId })).res.body.data.items).toHaveLength(1);
    expect((await q({ search: p.razorpayPaymentId })).res.body.data.items).toHaveLength(1);
    expect((await q({ search: ".*" })).res.body.data.items).toHaveLength(0);
    expect((await q({ dateFrom: "2999-01-01" })).res.body.data.items).toHaveLength(0);
    expect((await q({ dateFrom: "2030-01-02", dateTo: "2030-01-01" })).error.statusCode).toBe(400);
  });

  it("organizationName is added for internal actors only; limit is capped", async () => {
    const org = await makeOrg(0);
    await paidPayment(org, 90);
    const internal = await runController(paymentController.listPayments, master({ query: { organizationId: org._id.toString(), limit: "9999" } }), makeRes());
    expect(internal.res.body.data.limit).toBe(100);
    expect(internal.res.body.data.items[0].organizationName).toBe(org.name);
    const own = await runController(paymentController.listPayments, tenant(org, FIN), makeRes());
    expect(own.res.body.data.items[0]).not.toHaveProperty("organizationName");
  });
});

describe("payment detail walletEffect", () => {
  it("reports the real ledger credit for a successful payment, and none for a CREATED one", async () => {
    const org = await makeOrg(0);
    const paid = await paidPayment(org, 640);
    const open = await PaymentService.createOrder({ organizationId: org._id, userId: uid(), amount: 75 });
    const d1 = await runController(paymentController.getPayment, tenant(org, FIN, Role.SUPER_ADMIN, { params: { id: paid.paymentId.toString() } }), makeRes());
    expect(d1.res.body.data.walletEffect).toMatchObject({ type: "CREDIT", amount: 640, balanceAfter: 640 });
    const d2 = await runController(paymentController.getPayment, tenant(org, FIN, Role.SUPER_ADMIN, { params: { id: open.paymentId.toString() } }), makeRes());
    expect(d2.res.body.data.walletEffect).toEqual({ credited: false });
  });

  it("walletEffect is null without WALLET_VIEW; signature is never returned", async () => {
    const org = await makeOrg(0);
    const paid = await paidPayment(org, 10);
    const d = await runController(paymentController.getPayment, tenant(org, [Permission.PAYMENT_VIEW], Role.ADMIN, { params: { id: paid.paymentId.toString() } }), makeRes());
    expect(d.res.body.data.walletEffect).toBeNull();
    expect(JSON.stringify(d.res.body.data)).not.toContain("razorpaySignature");
  });

  it("repeated verify of the same payment credits the wallet once", async () => {
    const org = await makeOrg(0);
    const p = await paidPayment(org, 200);
    await PaymentService.confirmPayment({ razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: p.razorpayPaymentId, razorpaySignature: sig(p.razorpayOrderId, p.razorpayPaymentId), userId: uid() });
    expect((await Wallet.findOne({ organizationId: org._id })).balance).toBe(200);
    expect(await Payment.countDocuments({ organizationId: org._id })).toBe(1);
  });
});
