import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import crypto from "crypto";
import { Organization, Wallet, Payment, User, AuditLog, Notification, WalletTransaction } from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus, PaymentStatus } from "@launcherdesk/shared";
import * as paymentController from "../src/controllers/payment.controller.js";
import { PaymentService } from "../src/services/payment.service.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { createRazorpayOrderSchema, verifyRazorpayPaymentSchema } from "@launcherdesk/validation";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

const MOCK_CHECKOUT_SECRET = "mock_secret_dev_only";
const MOCK_WEBHOOK_SECRET = "mock_webhook_secret_dev_only";

function mockCheckoutSignature(orderId, paymentId) {
  return crypto.createHmac("sha256", MOCK_CHECKOUT_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
}
function mockWebhookSignature(rawBody) {
  return crypto.createHmac("sha256", MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");
}

async function makeOrgWithWallet(balance = 0) {
  const org = await Organization.create({
    name: "Payment Test Co",
    contactEmail: `pay-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: new mongoose.Types.ObjectId(),
    status: OrganizationStatus.ACTIVE,
  });
  await Wallet.create({ organizationId: org._id, balance });
  return org;
}

function reqAsTenant(role, organizationId, overrides = {}) {
  return makeReq({ user: { id: new mongoose.Types.ObjectId().toString(), role, organizationId: organizationId.toString(), permissions: [] }, ...overrides });
}

describe("Payment order creation", () => {
  it("an authorized Super Admin can create a payment order", async () => {
    const org = await makeOrgWithWallet();
    const body = createRazorpayOrderSchema.parse({ amount: 500 });
    const req = reqAsTenant(Role.SUPER_ADMIN, org._id, { body });
    const { res, error } = await runController(paymentController.createRazorpayOrder, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.razorpayOrderId).toBeDefined();
    const payment = await Payment.findById(res.body.data.paymentId);
    expect(payment.organizationId.toString()).toBe(org._id.toString());
    expect(payment.status).toBe(PaymentStatus.CREATED);
  });

  it("ADMIN/USER are rejected by the PAYMENT_MANAGE permission gate unless explicitly granted", async () => {
    for (const role of [Role.ADMIN, Role.USER]) {
      const req = reqAsTenant(role, new mongoose.Types.ObjectId());
      const { threw } = await runMiddleware(requirePermission(Permission.PAYMENT_MANAGE), req, makeRes());
      expect(threw).not.toBeNull();
      expect(threw.statusCode).toBe(403);
    }
  });

  it("rejects zero, negative, non-finite, and over-precision amounts at the schema layer", () => {
    for (const amount of [0, -100, NaN, Infinity, 10.999]) {
      expect(createRazorpayOrderSchema.safeParse({ amount }).success).toBe(false);
    }
  });

  it("rejects an amount above the configured maximum", () => {
    expect(createRazorpayOrderSchema.safeParse({ amount: 5000000 }).success).toBe(false);
  });

  it("organization is derived from the authenticated user - a spoofed organizationId in the body is ignored for tenant actors", async () => {
    const org = await makeOrgWithWallet();
    const otherOrg = await makeOrgWithWallet();
    const body = { ...createRazorpayOrderSchema.parse({ amount: 200 }), organizationId: otherOrg._id.toString() };
    const req = reqAsTenant(Role.SUPER_ADMIN, org._id, { body });
    const { res, error } = await runController(paymentController.createRazorpayOrder, req, makeRes());
    expect(error).toBeNull();
    const payment = await Payment.findById(res.body.data.paymentId);
    expect(payment.organizationId.toString()).toBe(org._id.toString());
  });
});

describe("Signature verification", () => {
  it("a valid signature succeeds and credits the wallet exactly once", async () => {
    const org = await makeOrgWithWallet(0);
    const orderResult = await PaymentService.createOrder({ organizationId: org._id, userId: new mongoose.Types.ObjectId(), amount: 1000 });
    const razorpayPaymentId = `pay_${new mongoose.Types.ObjectId()}`;
    const signature = mockCheckoutSignature(orderResult.razorpayOrderId, razorpayPaymentId);

    const payment = await PaymentService.confirmPayment({
      razorpayOrderId: orderResult.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: signature,
      userId: new mongoose.Types.ObjectId(),
    });
    expect(payment.status).toBe(PaymentStatus.SUCCESS);
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(1000);
  });

  it("an invalid signature fails, marks the payment FAILED, and never credits the wallet", async () => {
    const org = await makeOrgWithWallet(0);
    const orderResult = await PaymentService.createOrder({ organizationId: org._id, userId: new mongoose.Types.ObjectId(), amount: 1000 });
    await expect(
      PaymentService.confirmPayment({
        razorpayOrderId: orderResult.razorpayOrderId,
        razorpayPaymentId: "pay_forged",
        razorpaySignature: "totally-forged-signature",
        userId: new mongoose.Types.ObjectId(),
      })
    ).rejects.toMatchObject({ code: "PAYMENT_VERIFICATION_FAILED" });
    const payment = await Payment.findOne({ razorpayOrderId: orderResult.razorpayOrderId });
    expect(payment.status).toBe(PaymentStatus.FAILED);
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(0);
  });

  it("a forged amount cannot be introduced at verification time - verify only ever takes order/payment/signature, never an amount", async () => {
    // The verifyRazorpayPaymentSchema has no `amount` field at all - the
    // amount was fixed at order-creation time and is never renegotiable here.
    expect(verifyRazorpayPaymentSchema.safeParse({ razorpay_order_id: "x", razorpay_payment_id: "y", razorpay_signature: "z", amount: 1 }).success).toBe(false);
  });

  it("repeated verification of an already-successful payment is idempotent (no double credit)", async () => {
    const org = await makeOrgWithWallet(0);
    const orderResult = await PaymentService.createOrder({ organizationId: org._id, userId: new mongoose.Types.ObjectId(), amount: 300 });
    const razorpayPaymentId = `pay_${new mongoose.Types.ObjectId()}`;
    const signature = mockCheckoutSignature(orderResult.razorpayOrderId, razorpayPaymentId);
    const params = { razorpayOrderId: orderResult.razorpayOrderId, razorpayPaymentId, razorpaySignature: signature, userId: new mongoose.Types.ObjectId() };
    await PaymentService.confirmPayment(params);
    await PaymentService.confirmPayment(params); // second call, same order id
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(300);
    const txCount = await WalletTransaction.countDocuments({ organizationId: org._id, referenceType: "PAYMENT" });
    expect(txCount).toBe(1);
  });
});

describe("Webhook", () => {
  async function makeCreatedPayment(amount = 750) {
    const org = await makeOrgWithWallet(0);
    const orderResult = await PaymentService.createOrder({ organizationId: org._id, userId: new mongoose.Types.ObjectId(), amount });
    return { org, orderResult };
  }

  it("a valid webhook (payment.captured) credits the wallet", async () => {
    const { org, orderResult } = await makeCreatedPayment(750);
    const razorpayPaymentId = `pay_${new mongoose.Types.ObjectId()}`;
    const body = { event: "payment.captured", payload: { payment: { entity: { id: razorpayPaymentId, order_id: orderResult.razorpayOrderId, status: "captured" } } } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = mockWebhookSignature(rawBody);
    const result = await PaymentService.handleWebhook(rawBody, signature);
    expect(result.handled).toBe(true);
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(750);
  });

  it("an invalid webhook signature is rejected and never touches the wallet", async () => {
    const { org, orderResult } = await makeCreatedPayment(750);
    const razorpayPaymentId = `pay_${new mongoose.Types.ObjectId()}`;
    const body = { event: "payment.captured", payload: { payment: { entity: { id: razorpayPaymentId, order_id: orderResult.razorpayOrderId, status: "captured" } } } };
    const rawBody = Buffer.from(JSON.stringify(body));
    await expect(PaymentService.handleWebhook(rawBody, "forged-signature")).rejects.toMatchObject({ statusCode: 401 });
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(0);
  });

  it("a duplicate webhook delivery for an already-processed payment does not double-credit", async () => {
    const { org, orderResult } = await makeCreatedPayment(400);
    const razorpayPaymentId = `pay_${new mongoose.Types.ObjectId()}`;
    const body = { event: "payment.captured", payload: { payment: { entity: { id: razorpayPaymentId, order_id: orderResult.razorpayOrderId, status: "captured" } } } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = mockWebhookSignature(rawBody);
    await PaymentService.handleWebhook(rawBody, signature);
    const second = await PaymentService.handleWebhook(rawBody, signature);
    expect(second.alreadyProcessed).toBe(true);
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(400);
  });

  it("a webhook for an unknown/foreign order id is handled safely without throwing", async () => {
    const body = { event: "payment.captured", payload: { payment: { entity: { id: "pay_unknown", order_id: "order_does_not_exist", status: "captured" } } } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = mockWebhookSignature(rawBody);
    const result = await PaymentService.handleWebhook(rawBody, signature);
    expect(result.handled).toBe(false);
    expect(result.reason).toBe("unknown_payment");
  });

  it("a failed-payment webhook event marks the payment FAILED and never credits the wallet", async () => {
    const { org, orderResult } = await makeCreatedPayment(600);
    const body = { event: "payment.captured", payload: { payment: { entity: { id: "pay_failed", order_id: orderResult.razorpayOrderId, status: "failed" } } } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = mockWebhookSignature(rawBody);
    const result = await PaymentService.handleWebhook(rawBody, signature);
    expect(result.status).toBe(PaymentStatus.FAILED);
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(0);
  });

  it("an irrelevant event type is acknowledged but ignored", async () => {
    const body = { event: "refund.processed", payload: {} };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = mockWebhookSignature(rawBody);
    const result = await PaymentService.handleWebhook(rawBody, signature);
    expect(result.handled).toBe(false);
    expect(result.reason).toBe("ignored_event_type");
  });
});

describe("Wallet crediting via payment: concurrency", () => {
  it("two concurrent confirmations of the same order cannot double-credit", async () => {
    const org = await makeOrgWithWallet(0);
    const orderResult = await PaymentService.createOrder({ organizationId: org._id, userId: new mongoose.Types.ObjectId(), amount: 1000 });
    const razorpayPaymentId = `pay_${new mongoose.Types.ObjectId()}`;
    const signature = mockCheckoutSignature(orderResult.razorpayOrderId, razorpayPaymentId);
    const params = { razorpayOrderId: orderResult.razorpayOrderId, razorpayPaymentId, razorpaySignature: signature, userId: new mongoose.Types.ObjectId() };
    await Promise.allSettled([PaymentService.confirmPayment(params), PaymentService.confirmPayment(params)]);
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(1000); // exactly once, not 2000
  });
});

describe("Tenant isolation", () => {
  it("Organization A cannot view Organization B's payments", async () => {
    const orgA = await makeOrgWithWallet();
    const orgB = await makeOrgWithWallet();
    const orderB = await PaymentService.createOrder({ organizationId: orgB._id, userId: new mongoose.Types.ObjectId(), amount: 250 });

    const { error: getErr } = await runController(paymentController.getPayment, reqAsTenant(Role.SUPER_ADMIN, orgA._id, { params: { id: orderB.paymentId.toString() } }), makeRes());
    expect(getErr).not.toBeNull();
    expect(getErr.statusCode).toBe(404);

    const { res: listRes, error: listErr } = await runController(paymentController.listPayments, reqAsTenant(Role.SUPER_ADMIN, orgA._id, { query: {} }), makeRes());
    expect(listErr).toBeNull();
    expect(listRes.body.data.items.find((p) => p._id.toString() === orderB.paymentId.toString())).toBeUndefined();
  });

  it("Organization A cannot verify/complete Organization B's payment order even with a legitimately-valid signature for it", async () => {
    const orgA = await makeOrgWithWallet(0);
    const orgB = await makeOrgWithWallet(0);
    const orderB = await PaymentService.createOrder({ organizationId: orgB._id, userId: new mongoose.Types.ObjectId(), amount: 900 });
    const razorpayPaymentId = `pay_${new mongoose.Types.ObjectId()}`;
    const signature = mockCheckoutSignature(orderB.razorpayOrderId, razorpayPaymentId);
    const body = verifyRazorpayPaymentSchema.parse({ razorpay_order_id: orderB.razorpayOrderId, razorpay_payment_id: razorpayPaymentId, razorpay_signature: signature });

    const req = reqAsTenant(Role.SUPER_ADMIN, orgA._id, { body });
    const { error } = await runController(paymentController.verifyRazorpayPayment, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
    const walletB = await Wallet.findOne({ organizationId: orgB._id });
    expect(walletB.balance).toBe(0); // never credited via the wrong org's session
  });

  it("Master Admin can view payments across organizations", async () => {
    const org = await makeOrgWithWallet();
    const orderResult = await PaymentService.createOrder({ organizationId: org._id, userId: new mongoose.Types.ObjectId(), amount: 150 });
    const req = makeReq({ user: { id: "m", role: Role.MASTER_ADMIN, organizationId: null, permissions: [] }, params: { id: orderResult.paymentId.toString() } });
    const { error } = await runController(paymentController.getPayment, req, makeRes());
    expect(error).toBeNull();
  });
});

describe("Assistant Master Admin oversight", () => {
  it("an Assistant without PAYMENT_MANAGE is denied", async () => {
    const req = makeReq({ user: { id: "x", role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [] } });
    const { threw } = await runMiddleware(requirePermission(Permission.PAYMENT_MANAGE), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("an Assistant explicitly granted PAYMENT_MANAGE can create an order on behalf of a client organization, audited and notifying Master Admin", async () => {
    const org = await makeOrgWithWallet();
    const master = await User.create({ name: "Master", email: `m-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null });
    const assistantId = new mongoose.Types.ObjectId().toString();
    const body = { ...createRazorpayOrderSchema.parse({ amount: 500 }), organizationId: org._id.toString() };
    const req = makeReq({ user: { id: assistantId, role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [Permission.PAYMENT_MANAGE] }, body });

    const { res, error } = await runController(paymentController.createRazorpayOrder, req, makeRes());
    expect(error).toBeNull();

    const auditEntry = await AuditLog.findOne({ actorId: assistantId, action: AuditAction.PAYMENT_VIEWED });
    expect(auditEntry).not.toBeNull();
    const notification = await Notification.findOne({ recipientId: master._id, relatedActorId: assistantId });
    expect(notification).not.toBeNull();
    expect(notification.type).toBe("ASSISTANT_ADMIN_ACTIVITY");
    expect(res.body.data.paymentId).toBeDefined();
  });
});
