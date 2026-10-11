import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import {
  Organization,
  Wallet,
  Payment,
  User,
  Notification,
  AuditLog,
} from "../src/models/index.js";
import {
  Role,
  Permission,
  OrganizationStatus,
  PaymentStatus,
  NotificationType,
} from "@launcherdesk/shared";
import * as paymentController from "../src/controllers/payment.controller.js";
import * as authController from "../src/controllers/auth.controller.js";
import * as reportController from "../src/controllers/report.controller.js";
import { PaymentService } from "../src/services/payment.service.js";
import { OtpService } from "../src/services/otp.service.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";
import crypto from "crypto";

const MOCK_CHECKOUT_SECRET = "mock_secret_dev_only";

function mockCheckoutSignature(orderId, paymentId) {
  return crypto.createHmac("sha256", MOCK_CHECKOUT_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
}

describe("Task 10 - End-to-End E-Stamp Package Purchase & Customer Flow", () => {
  it("executes the full 20-step lifecycle accurately", async () => {
    // Setup Master Admin
    const masterAdmin = await User.create({
      name: "Master Admin",
      email: "master@launcherdesk.com",
      passwordHash: "dummyHash123",
      role: Role.MASTER_ADMIN,
      permissions: Object.values(Permission),
    });

    // Setup Organization & Super Admin
    const org = await Organization.create({
      name: "ABC Technologies",
      contactEmail: "contact@abctech.com",
      contactPhone: "9876543210",
      createdBy: masterAdmin._id,
      status: OrganizationStatus.ACTIVE,
      isEstampServiceEnabled: true,
    });
    await Wallet.create({ organizationId: org._id, balance: 0 });

    const superAdmin = await User.create({
      name: "Chandu BG",
      email: "chandu@abctech.com",
      passwordHash: "initialPasswordHash123",
      role: Role.SUPER_ADMIN,
      organizationId: org._id,
      permissions: [Permission.PAYMENT_MANAGE, Permission.PAYMENT_VIEW, Permission.REPORT_VIEW, Permission.REPORT_FINANCIAL_VIEW],
    });

    // Step 1: Super Admin Authenticated Request
    const superAdminReq = (body = {}, overrides = {}) =>
      makeReq({
        user: {
          id: superAdmin._id.toString(),
          role: Role.SUPER_ADMIN,
          organizationId: org._id.toString(),
          permissions: superAdmin.permissions,
        },
        body,
        ...overrides,
      });

    // Step 2: Super Admin purchases an E-Stamp bundle (Pro Business Bundle: 100 stamps, ₹1500)
    const createOrderReq = superAdminReq({
      amount: 1500,
      plan: "Pro Business Bundle",
      stampsCount: 100,
    });
    const { res: orderRes, error: orderErr } = await runController(
      paymentController.createRazorpayOrder,
      createOrderReq,
      makeRes()
    );
    expect(orderErr).toBeNull();
    const { razorpayOrderId, paymentId } = orderRes.body.data;
    expect(razorpayOrderId).toBeDefined();
    expect(paymentId).toBeDefined();

    // Step 3 & 4: Payment completes and stores in database correctly
    const fakePaymentId = `pay_rzp_${Date.now()}`;
    const validSignature = mockCheckoutSignature(razorpayOrderId, fakePaymentId);

    const verifyReq = superAdminReq({
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: fakePaymentId,
      razorpay_signature: validSignature,
    });
    const { res: verifyRes, error: verifyErr } = await runController(
      paymentController.verifyRazorpayPayment,
      verifyReq,
      makeRes()
    );
    expect(verifyErr).toBeNull();

    const storedPayment = await Payment.findById(paymentId);
    expect(storedPayment.status).toBe(PaymentStatus.SUCCESS);
    expect(storedPayment.amount).toBe(1500);
    expect(storedPayment.plan).toBe("Pro Business Bundle");
    expect(storedPayment.stampsCount).toBe(100);
    expect(storedPayment.razorpayPaymentId).toBe(fakePaymentId);

    // Step 5: Invoice is generated
    expect(storedPayment.invoiceNumber).toBeDefined();
    expect(storedPayment.invoiceNumber).toMatch(/^INV-\d{4}-/);

    // Step 6 & 7: Super Admin notification / email payload confirmation
    const buyerNotification = await Notification.findOne({
      recipientId: superAdmin._id,
      type: NotificationType.PAYMENT,
      entityId: storedPayment._id,
    });
    expect(buyerNotification).not.toBeNull();
    expect(buyerNotification.title).toBe("Payment successful");
    expect(buyerNotification.message).toContain("Pro Business Bundle");
    expect(buyerNotification.message).toContain(storedPayment.invoiceNumber);

    // Step 8: Direct Reset Token was issued for Super Admin
    const directToken = await OtpService.issueDirectResetToken(
      superAdmin._id.toString(),
      superAdmin.email,
      superAdmin.role
    );
    expect(directToken).toBeDefined();
    expect(directToken.length).toBe(64); // 32 bytes hex

    // Step 9: Password updates successfully using direct token without code
    const resetReq = makeReq({
      body: {
        resetToken: directToken,
        newPassword: "BrandNewPassword#2026",
      },
    });
    const { res: resetRes, error: resetErr } = await runController(
      authController.resetPassword,
      resetReq,
      makeRes()
    );
    expect(resetErr).toBeNull();
    expect(resetRes.body.data.message).toMatch(/Password reset successful/i);

    // Verify password updated
    const reloadedSuperAdmin = await User.findById(superAdmin._id);
    expect(reloadedSuperAdmin.passwordHash).not.toBe("initialPasswordHash123");

    // Step 10: Reset token becomes invalid immediately after single use
    const replayResetReq = makeReq({
      body: {
        resetToken: directToken,
        newPassword: "AnotherPassword#2026",
      },
    });
    const { error: replayErr } = await runController(
      authController.resetPassword,
      replayResetReq,
      makeRes()
    );
    expect(replayErr).not.toBeNull();
    expect(replayErr.statusCode).toBe(400);

    // Step 16 & 17: Master Admin receives rich notification & recent activity
    const masterNotification = await Notification.findOne({
      recipientId: masterAdmin._id,
      type: NotificationType.PAYMENT,
      entityId: storedPayment._id,
    });
    expect(masterNotification).not.toBeNull();
    // Verify notification message format:
    // "ABC Technologies has successfully purchased the Pro Business Bundle (100 E-Stamps) for ₹1,500. Transaction ID: ..."
    expect(masterNotification.message).toContain("ABC Technologies has successfully purchased the Pro Business Bundle (100 E-Stamps) for ₹1,500");
    expect(masterNotification.message).toContain(fakePaymentId);
    expect(masterNotification.metadata.superAdminName).toBe("Chandu BG");
    expect(masterNotification.metadata.organizationName).toBe("ABC Technologies");
    expect(masterNotification.metadata.amount).toBe(1500);

    // Master Admin Dashboard Recent Activity
    const masterActivityReq = makeReq({
      user: {
        id: masterAdmin._id.toString(),
        role: Role.MASTER_ADMIN,
        permissions: masterAdmin.permissions,
      },
      query: { limit: "10" },
    });
    const { res: actRes, error: actErr } = await runController(
      reportController.getRecentActivity,
      masterActivityReq,
      makeRes()
    );
    expect(actErr).toBeNull();
    const paymentsActivity = actRes.body.data.payments;
    expect(paymentsActivity.length).toBeGreaterThan(0);
    const recentTx = paymentsActivity.find((p) => p.razorpayPaymentId === fakePaymentId);
    expect(recentTx).toBeDefined();
    expect(recentTx.organizationName).toBe("ABC Technologies");
    expect(recentTx.createdByName).toBe("Chandu BG");
    expect(recentTx.plan).toBe("Pro Business Bundle");
    expect(recentTx.amount).toBe(1500);
    expect(recentTx.stampsCount).toBe(100);

    // Step 18 & 19: Security & Tenant Isolation checks
    // Super Admin cannot access Master Admin recent activity globally
    const tenantActivityReq = superAdminReq({}, { query: { limit: "10" } });
    const { res: tenantActRes } = await runController(
      reportController.getRecentActivity,
      tenantActivityReq,
      makeRes()
    );
    expect(tenantActRes.body.data.payments.every((p) => p.organizationId.toString() === org._id.toString())).toBe(true);

    // Super Admin cannot verify payments belonging to another organization
    const otherOrg = await Organization.create({
      name: "Other Org",
      contactEmail: "other@org.com",
      contactPhone: "9000000000",
      createdBy: masterAdmin._id,
      status: OrganizationStatus.ACTIVE,
    });
    const otherPayment = await Payment.create({
      organizationId: otherOrg._id,
      amount: 500,
      razorpayOrderId: "order_other_123",
      status: PaymentStatus.CREATED,
      createdBy: masterAdmin._id,
    });
    const crossTenantVerifyReq = superAdminReq({
      razorpay_order_id: "order_other_123",
      razorpay_payment_id: "pay_other_123",
      razorpay_signature: "mock_signature_dev_only",
    });
    const { error: crossTenantErr } = await runController(
      paymentController.verifyRazorpayPayment,
      crossTenantVerifyReq,
      makeRes()
    );
    expect(crossTenantErr).not.toBeNull();
    expect(crossTenantErr.statusCode).toBe(404);
  });
});
