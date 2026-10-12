import { describe, it, expect } from "vitest";
import "./setup";
import { Organization, Wallet, Payment, User, Notification, EstampPackage } from "../src/models/index.js";
import { Role, Permission, OrganizationStatus, PaymentStatus, NotificationType } from "@launcherdesk/shared";
import * as paymentController from "../src/controllers/payment.controller.js";
import * as estampPackageController from "../src/controllers/estamp-package.controller.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";
import crypto from "crypto";

const MOCK_CHECKOUT_SECRET = "mock_secret_dev_only";
function mockCheckoutSignature(orderId, paymentId) {
  return crypto.createHmac("sha256", MOCK_CHECKOUT_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
}

async function setupOrgWithSuperAdminAndAdmin() {
  const masterAdmin = await User.create({
    name: "Master Admin",
    email: `master-${Date.now()}@launcherdesk.com`,
    passwordHash: "dummyHash123",
    role: Role.MASTER_ADMIN,
    permissions: Object.values(Permission),
  });
  const org = await Organization.create({
    name: "Catalog Test Org",
    contactEmail: "contact@catalogtest.com",
    contactPhone: "9876500000",
    createdBy: masterAdmin._id,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance: 0 });
  const superAdmin = await User.create({
    name: "Org Super Admin",
    email: `super-${Date.now()}@catalogtest.com`,
    passwordHash: "hash123",
    role: Role.SUPER_ADMIN,
    organizationId: org._id,
    permissions: [Permission.PAYMENT_MANAGE, Permission.PAYMENT_VIEW],
  });
  const admin = await User.create({
    name: "Org Admin",
    email: `admin-${Date.now()}@catalogtest.com`,
    passwordHash: "hash123",
    role: Role.ADMIN,
    organizationId: org._id,
    permissions: [],
  });
  return { masterAdmin, org, superAdmin, admin };
}

function reqAsSuperAdmin(superAdmin, org, body) {
  return makeReq({
    user: {
      id: superAdmin._id.toString(),
      role: Role.SUPER_ADMIN,
      organizationId: org._id.toString(),
      permissions: superAdmin.permissions,
    },
    body,
  });
}

describe("E-Stamp package catalog - server-side pricing and admin notifications", () => {
  it("resolves price/stampsCount from the server-side catalog, ignoring a client-supplied amount", async () => {
    const { org, superAdmin } = await setupOrgWithSuperAdminAndAdmin();
    await EstampPackage.create({
      key: "test-pro",
      name: "Test Pro Bundle",
      stampsCount: 100,
      price: 1500,
      isActive: true,
    });

    // Tampered client: claims packageKey "test-pro" but sends a much lower
    // amount and a wildly inflated stampsCount - the server must ignore both.
    const tamperedReq = reqAsSuperAdmin(superAdmin, org, {
      packageKey: "test-pro",
      amount: 1,
      stampsCount: 999999,
    });
    const { res, error } = await runController(paymentController.createRazorpayOrder, tamperedReq, makeRes());
    expect(error).toBeNull();

    const payment = await Payment.findById(res.body.data.paymentId);
    expect(payment.amount).toBe(1500);
    expect(payment.stampsCount).toBe(100);
    expect(payment.packageKey).toBe("test-pro");
  });

  it("rejects an unknown or disabled packageKey", async () => {
    const { org, superAdmin } = await setupOrgWithSuperAdminAndAdmin();
    await EstampPackage.create({
      key: "disabled-pack",
      name: "Disabled Bundle",
      stampsCount: 50,
      price: 800,
      isActive: false,
    });

    const req = reqAsSuperAdmin(superAdmin, org, { packageKey: "disabled-pack" });
    const { error } = await runController(paymentController.createRazorpayOrder, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
  });

  it("notifies an Admin-role user in the same organization on purchase, alongside Master Admin, with no duplicates", async () => {
    const { masterAdmin, org, superAdmin, admin } = await setupOrgWithSuperAdminAndAdmin();

    const orderReq = reqAsSuperAdmin(superAdmin, org, { amount: 1000, plan: "Custom Top-up", stampsCount: 60 });
    const { res: orderRes } = await runController(paymentController.createRazorpayOrder, orderReq, makeRes());
    const { razorpayOrderId, paymentId } = orderRes.body.data;

    const fakePaymentId = `pay_test_${Date.now()}`;
    const signature = mockCheckoutSignature(razorpayOrderId, fakePaymentId);
    const verifyReq = reqAsSuperAdmin(superAdmin, org, {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: fakePaymentId,
      razorpay_signature: signature,
    });
    const { error: verifyErr } = await runController(paymentController.verifyRazorpayPayment, verifyReq, makeRes());
    expect(verifyErr).toBeNull();

    const payment = await Payment.findById(paymentId);

    const masterNotification = await Notification.findOne({
      recipientId: masterAdmin._id,
      type: NotificationType.PAYMENT,
      entityId: payment._id,
    });
    expect(masterNotification).not.toBeNull();

    const adminNotifications = await Notification.find({
      recipientId: admin._id,
      type: NotificationType.PAYMENT,
      entityId: payment._id,
    });
    expect(adminNotifications.length).toBe(1);
    expect(adminNotifications[0].metadata.organizationName).toBe("Catalog Test Org");
    expect(adminNotifications[0].metadata.amount).toBe(1000);

    // A retried webhook/verify for the same payment must never double-notify
    // the Admin (idempotent via eventKey's per-recipient suffix).
    const { PaymentService } = await import("../src/services/payment.service.js");
    const secondVerify = await PaymentService.confirmPayment({
      razorpayOrderId,
      razorpayPaymentId: fakePaymentId,
      razorpaySignature: signature,
      userId: superAdmin._id.toString(),
    });
    expect(secondVerify.status).toBe(PaymentStatus.SUCCESS);
    const adminNotificationsAfterRetry = await Notification.find({
      recipientId: admin._id,
      type: NotificationType.PAYMENT,
      entityId: payment._id,
    });
    expect(adminNotificationsAfterRetry.length).toBe(1);
  });
});
