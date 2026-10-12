import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Organization, Wallet, Payment, User, Notification } from "../src/models/index.js";
import { Role, OrganizationStatus, PaymentStatus, NotificationType } from "@launcherdesk/shared";
import { PaymentService } from "../src/services/payment.service.js";
import * as paymentController from "../src/controllers/payment.controller.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";

// This test exercises the reconciliation safety net: a payment that never
// reached SUCCESS through the normal checkout-verify or webhook paths (e.g.
// the browser tab closed right after paying, or the webhook never arrived),
// but that Razorpay's own API reports as genuinely captured. A fake provider
// is injected directly into PaymentService.reconcilePayment's (test-only)
// second parameter - it never calls real Razorpay, but exercises exactly the
// same amount-matching/notification/idempotency logic production would.
function fakeProviderReturning(capturedPaymentOrNull) {
  return {
    async fetchCapturedPayment() {
      return capturedPaymentOrNull;
    },
  };
}

async function setupOrgAndPayment(amount) {
  const masterAdmin = await User.create({
    name: "Master Admin",
    email: `master-${Date.now()}-${Math.random()}@launcherdesk.com`,
    passwordHash: "x",
    role: Role.MASTER_ADMIN,
    permissions: [],
  });
  const org = await Organization.create({
    name: "Reconcile Test Org",
    contactEmail: `contact-${Date.now()}@reconciletest.com`,
    contactPhone: "9999999999",
    createdBy: masterAdmin._id,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance: 0 });
  const superAdmin = await User.create({
    name: "Org Super Admin",
    email: `super-${Date.now()}-${Math.random()}@reconciletest.com`,
    passwordHash: "x",
    role: Role.SUPER_ADMIN,
    organizationId: org._id,
    permissions: [],
  });
  const payment = await Payment.create({
    organizationId: org._id,
    amount,
    razorpayOrderId: `order_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    status: PaymentStatus.CREATED,
    createdBy: superAdmin._id,
    plan: "Custom Top-up",
    stampsCount: 10,
  });
  return { masterAdmin, org, superAdmin, payment };
}

describe("PaymentService.reconcilePayment - recovering a captured-but-never-confirmed payment", () => {
  it("marks a stuck CREATED payment SUCCESS when the provider reports it captured with a matching amount, and notifies Master Admin", async () => {
    const { masterAdmin, payment } = await setupOrgAndPayment(1000);
    const provider = fakeProviderReturning({ razorpayPaymentId: "pay_test_captured_123", amount: 1000, status: "captured" });

    const result = await PaymentService.reconcilePayment(payment._id.toString(), provider);

    expect(result.reconciled).toBe(true);
    expect(result.reason).toBe("RECONCILED");
    expect(result.payment.status).toBe(PaymentStatus.SUCCESS);
    expect(result.payment.razorpayPaymentId).toBe("pay_test_captured_123");
    expect(result.payment.balanceStatus).toBe("PENDING_CREDIT");

    const masterNotification = await Notification.findOne({
      recipientId: masterAdmin._id,
      type: NotificationType.PAYMENT,
      entityId: payment._id,
    });
    expect(masterNotification).not.toBeNull();
  });

  it("reports NO_CAPTURED_PAYMENT_FOUND and leaves the payment untouched when the provider has nothing", async () => {
    const { payment } = await setupOrgAndPayment(500);
    const provider = fakeProviderReturning(null);

    const result = await PaymentService.reconcilePayment(payment._id.toString(), provider);

    expect(result.reconciled).toBe(false);
    expect(result.reason).toBe("NO_CAPTURED_PAYMENT_FOUND");
    const reloaded = await Payment.findById(payment._id);
    expect(reloaded.status).toBe(PaymentStatus.CREATED);
  });

  it("refuses to reconcile when the captured amount does not match the expected order amount", async () => {
    const { payment } = await setupOrgAndPayment(1000);
    const provider = fakeProviderReturning({ razorpayPaymentId: "pay_mismatch", amount: 1, status: "captured" });

    await expect(PaymentService.reconcilePayment(payment._id.toString(), provider)).rejects.toMatchObject({ statusCode: 409, code: "AMOUNT_MISMATCH" });

    const reloaded = await Payment.findById(payment._id);
    expect(reloaded.status).toBe(PaymentStatus.CREATED);
  });

  it("is idempotent - reconciling an already-SUCCESS payment is a no-op, never double-notifies", async () => {
    const { masterAdmin, payment } = await setupOrgAndPayment(750);
    const provider = fakeProviderReturning({ razorpayPaymentId: "pay_test_750", amount: 750, status: "captured" });

    const first = await PaymentService.reconcilePayment(payment._id.toString(), provider);
    expect(first.reconciled).toBe(true);

    const second = await PaymentService.reconcilePayment(payment._id.toString(), provider);
    expect(second.reconciled).toBe(false);
    expect(second.reason).toBe("ALREADY_SUCCESS");

    const notifications = await Notification.find({ recipientId: masterAdmin._id, entityId: payment._id, type: NotificationType.PAYMENT });
    expect(notifications.length).toBe(1);
  });
});

describe("POST /payments/:id/reconcile - controller wiring", () => {
  it("is reachable by Master Admin and safely reports no captured payment under the real (mock, in test env) provider", async () => {
    const { masterAdmin, payment } = await setupOrgAndPayment(200);
    const req = makeReq({
      user: { id: masterAdmin._id.toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: [] },
      params: { id: payment._id.toString() },
    });
    const { res, error } = await runController(paymentController.reconcilePayment, req, makeRes());

    expect(error).toBeNull();
    expect(res.body.data.reconciled).toBe(false);
    expect(res.body.data.reason).toBe("NO_CAPTURED_PAYMENT_FOUND");
  });
});
