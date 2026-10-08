import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import crypto from "crypto";
import { createRequire } from "node:module";
import {
  Organization,
  Wallet,
  Article,
  ArticleVersion,
  User,
  Notification,
  EmailLog,
  EStampOrder,
  EStampRequest,
} from "../src/models/index.js";
import { Role, NotificationType, OrganizationStatus, EStampOrderProcessingStatus, PaymentStatus } from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { PaymentService } from "../src/services/payment.service.js";
import * as notificationController from "../src/controllers/notification.controller.js";
import * as fileController from "../src/controllers/file.controller.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";

const require = createRequire(import.meta.url);
const { notify, notifyUser } = require("../src/services/notification.service.js");
const { env } = require("../src/config/env.js");

function mockCheckoutSignature(orderId, paymentId) {
  return crypto.createHmac("sha256", "mock_secret_dev_only").update(`${orderId}|${paymentId}`).digest("hex");
}

async function makeUser(role = Role.SUPER_ADMIN, organizationId = null) {
  return User.create({ name: "Test User", email: `u-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role, organizationId });
}

async function makeLockedOrder({ balance = 100000, fixedAmount = 500 } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: "Notif Test Co",
    contactEmail: `notif-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `NT-${new mongoose.Types.ObjectId()}`, title: "Notif Test Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  const requester = await User.create({ name: "Requester", email: `req-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.USER, organizationId: org._id });
  const { request, order } = await EStampRequestService.createRequest({
    organizationId: org._id,
    createdBy: requester._id,
    stateCode: "KA",
    articleId: article._id.toString(),
    firstParty: "A",
    secondParty: "B",
    descriptionOfDocument: "Notification test",
    considerationPrice: 0,
    stampDutyPaidBy: "A",
    numberOfEStamps: 1,
  });
  request.status = "LOCKED";
  await request.save();
  order.eStampStatus = EStampOrderProcessingStatus.CREATED;
  await order.save();
  return { org, article, request, order, requester };
}

describe("Notification service", () => {
  it("a notification can be created and reaches the correct recipient", async () => {
    const user = await makeUser();
    const n = await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "Hi", message: "Hello" });
    expect(n.recipientId.toString()).toBe(user._id.toString());
  });

  it("organization scope is preserved on the notification record", async () => {
    const org = await Organization.create({ name: "Scope Co", contactEmail: `scope-${new mongoose.Types.ObjectId()}@x.com`, contactPhone: "1", createdBy: new mongoose.Types.ObjectId(), status: OrganizationStatus.ACTIVE });
    const user = await makeUser(Role.SUPER_ADMIN, org._id);
    const n = await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "Hi", message: "Hello", organizationId: org._id.toString() });
    expect(n.organizationId.toString()).toBe(org._id.toString());
  });

  it("sensitive data (OTP, tokens, secrets) is never stored in a notification or email log", async () => {
    const user = await makeUser();
    await require("../src/services/otp.service.js").OtpService.issue(user._id.toString(), "LOGIN", user.email, user.role);
    const logs = await EmailLog.find({ to: user.email });
    for (const log of logs) {
      expect(log.subject).not.toMatch(/\d{6}/); // no 6-digit OTP code leaked into the subject
      expect(JSON.stringify(log.toObject())).not.toMatch(/codeHash|challengeToken/);
    }
    const notifications = await Notification.find({ recipientId: user._id });
    for (const n of notifications) {
      expect(JSON.stringify(n.toObject())).not.toMatch(/\d{6}/);
    }
  });
});

describe("Notification listing", () => {
  it("a user sees only their own notifications", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await notify({ recipientId: userA._id.toString(), recipientRole: userA.role, type: NotificationType.GENERAL, title: "A's", message: "for A" });
    await notify({ recipientId: userB._id.toString(), recipientRole: userB.role, type: NotificationType.GENERAL, title: "B's", message: "for B" });
    const req = makeReq({ user: { id: userA._id.toString(), role: userA.role, organizationId: null, permissions: [] }, query: {} });
    const { res, error } = await runController(notificationController.listMyNotifications, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].title).toBe("A's");
  });

  it("pagination works", async () => {
    const user = await makeUser();
    for (let i = 0; i < 3; i++) {
      await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: `N${i}`, message: "x" });
    }
    const req = makeReq({ user: { id: user._id.toString(), role: user.role, organizationId: null, permissions: [] }, query: { page: "1", limit: "2" } });
    const { res } = await runController(notificationController.listMyNotifications, req, makeRes());
    expect(res.body.data.items.length).toBe(2);
    expect(res.body.data.total).toBe(3);
  });

  it("unread filter works", async () => {
    const user = await makeUser();
    const n1 = await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "Read", message: "x" });
    await Notification.updateOne({ _id: n1._id }, { isRead: true });
    await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "Unread", message: "x" });
    const req = makeReq({ user: { id: user._id.toString(), role: user.role, organizationId: null, permissions: [] }, query: { unreadOnly: "true" } });
    const { res } = await runController(notificationController.listMyNotifications, req, makeRes());
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].title).toBe("Unread");
  });

  it("type filter works", async () => {
    const user = await makeUser();
    await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.PAYMENT, title: "Pay", message: "x" });
    await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "Gen", message: "x" });
    const req = makeReq({ user: { id: user._id.toString(), role: user.role, organizationId: null, permissions: [] }, query: { type: NotificationType.PAYMENT } });
    const { res, error } = await runController(notificationController.listMyNotifications, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].type).toBe(NotificationType.PAYMENT);
  });

  it("an invalid type filter is rejected", async () => {
    const user = await makeUser();
    const req = makeReq({ user: { id: user._id.toString(), role: user.role, organizationId: null, permissions: [] }, query: { type: "NOT_REAL" } });
    const { error } = await runController(notificationController.listMyNotifications, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.code).toBe("INVALID_TYPE");
  });

  it("date filtering works", async () => {
    const user = await makeUser();
    await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "Old", message: "x" });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const req = makeReq({ user: { id: user._id.toString(), role: user.role, organizationId: null, permissions: [] }, query: { dateFrom: future } });
    const { res, error } = await runController(notificationController.listMyNotifications, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.items.length).toBe(0);
  });
});

describe("Read state", () => {
  it("a user can mark their own notification read", async () => {
    const user = await makeUser();
    const n = await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "X", message: "x" });
    const req = makeReq({ user: { id: user._id.toString(), role: user.role, organizationId: null, permissions: [] }, params: { id: n._id.toString() } });
    const { res, error } = await runController(notificationController.markRead, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.isRead).toBe(true);
    expect(res.body.data.readAt).toBeDefined();
  });

  it("a user cannot mark another user's notification read", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const n = await notify({ recipientId: userA._id.toString(), recipientRole: userA.role, type: NotificationType.GENERAL, title: "X", message: "x" });
    const req = makeReq({ user: { id: userB._id.toString(), role: userB.role, organizationId: null, permissions: [] }, params: { id: n._id.toString() } });
    const { error } = await runController(notificationController.markRead, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
    const reloaded = await Notification.findById(n._id);
    expect(reloaded.isRead).toBe(false); // untouched
  });

  it("mark-all-read only affects the current user's notifications", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await notify({ recipientId: userA._id.toString(), recipientRole: userA.role, type: NotificationType.GENERAL, title: "A1", message: "x" });
    await notify({ recipientId: userA._id.toString(), recipientRole: userA.role, type: NotificationType.GENERAL, title: "A2", message: "x" });
    await notify({ recipientId: userB._id.toString(), recipientRole: userB.role, type: NotificationType.GENERAL, title: "B1", message: "x" });
    const req = makeReq({ user: { id: userA._id.toString(), role: userA.role, organizationId: null, permissions: [] } });
    const { res, error } = await runController(notificationController.markAllRead, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.updated).toBe(2);
    const bNotification = await Notification.findOne({ recipientId: userB._id });
    expect(bNotification.isRead).toBe(false); // untouched
  });

  it("unread count is correct", async () => {
    const user = await makeUser();
    await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "1", message: "x" });
    await notify({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "2", message: "x" });
    const req = makeReq({ user: { id: user._id.toString(), role: user.role, organizationId: null, permissions: [] } });
    const { res, error } = await runController(notificationController.getUnreadCount, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.unreadCount).toBe(2);
  });
});

describe("Tenant isolation / mass assignment", () => {
  it("a client cannot manipulate recipientId to read someone else's notification via any client-supplied id", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const n = await notify({ recipientId: userB._id.toString(), recipientRole: userB.role, type: NotificationType.GENERAL, title: "B's", message: "x" });
    // listMyNotifications never reads a recipientId from the query at all -
    // it is always req.user.id, so there is no parameter to spoof here.
    const req = makeReq({ user: { id: userA._id.toString(), role: userA.role, organizationId: null, permissions: [] }, query: { recipientId: userB._id.toString() } });
    const { res } = await runController(notificationController.listMyNotifications, req, makeRes());
    expect(res.body.data.items.find((i) => i._id.toString() === n._id.toString())).toBeUndefined();
  });
});

describe("Idempotency", () => {
  it("a duplicate business event (same eventKey) does not create a duplicate logical notification", async () => {
    const user = await makeUser();
    const params = { recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "X", message: "x", eventKey: "test-event:once" };
    const first = await notify(params);
    const second = await notify(params);
    expect(second._id.toString()).toBe(first._id.toString());
    const count = await Notification.countDocuments({ eventKey: "test-event:once" });
    expect(count).toBe(1);
  });

  it("duplicate payment verification does not send a duplicate payment email", async () => {
    const org = await Organization.create({ name: "PayIdemp", contactEmail: `pi-${new mongoose.Types.ObjectId()}@x.com`, contactPhone: "1", createdBy: new mongoose.Types.ObjectId(), status: OrganizationStatus.ACTIVE });
    await Wallet.create({ organizationId: org._id, balance: 0 });
    const user = await makeUser(Role.SUPER_ADMIN, org._id);
    const orderResult = await PaymentService.createOrder({ organizationId: org._id, userId: user._id, amount: 1000 });
    const razorpayPaymentId = `pay_${new mongoose.Types.ObjectId()}`;
    const signature = mockCheckoutSignature(orderResult.razorpayOrderId, razorpayPaymentId);
    const params = { razorpayOrderId: orderResult.razorpayOrderId, razorpayPaymentId, razorpaySignature: signature, userId: user._id };
    await PaymentService.confirmPayment(params);
    await PaymentService.confirmPayment(params); // retried "verify" call
    const emailCount = await EmailLog.countDocuments({ eventKey: `payment:${orderResult.paymentId.toString()}:success:${user.email}` });
    expect(emailCount).toBe(1);
    const notifCount = await Notification.countDocuments({ eventKey: `payment:${orderResult.paymentId.toString()}:success` });
    expect(notifCount).toBe(1);
  });

  it("duplicate E-Stamp order sync (webhook-equivalent) does not send a duplicate order-issued email", async () => {
    const { org, order, requester } = await makeLockedOrder();
    const actor = new mongoose.Types.ObjectId().toString();
    await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), actor, Role.MASTER_ADMIN);
    await EStampRequestService.syncEStampOrderStatus(order._id.toString(), org._id.toString(), actor, Role.MASTER_ADMIN);
    // A second sync call on an already-terminal (ISSUED) order is itself a
    // no-op (see Phase 7's applyProviderResult terminal-state guard), but
    // exercise it anyway to prove no second email/notification results.
    await EStampRequestService.syncEStampOrderStatus(order._id.toString(), org._id.toString(), actor, Role.MASTER_ADMIN);
    const emailCount = await EmailLog.countDocuments({ eventKey: `estamp-order:${order._id.toString()}:issued:${requester.email}` });
    expect(emailCount).toBe(1);
    const notifCount = await Notification.countDocuments({ eventKey: `estamp-order:${order._id.toString()}:issued` });
    expect(notifCount).toBe(1);
  });
});

describe("Email provider", () => {
  it("the configured (mock, in tests) provider sends through the abstraction and logs SENT", async () => {
    const user = await makeUser();
    await notifyUser({ recipientId: user._id.toString(), recipientRole: user.role, type: NotificationType.GENERAL, title: "X", message: "x", email: { to: user.email, method: "sendSecurityAlertEmail", args: ["hello"] } });
    const log = await EmailLog.findOne({ to: user.email });
    expect(log.status).toBe("SENT");
    expect(log.provider).toBe("mock");
  });

  it("missing production email configuration fails clearly rather than silently mocking", () => {
    const originalEnv = env.NODE_ENV;
    const originalKey = env.BREVO_API_KEY;
    env.NODE_ENV = "production";
    env.BREVO_API_KEY = "";
    try {
      const { getEmailProvider } = require("../src/services/email-providers/index.js");
      expect(() => getEmailProvider()).toThrow(/EMAIL_PROVIDER_NOT_CONFIGURED|not configured/i);
    } finally {
      env.NODE_ENV = originalEnv;
      env.BREVO_API_KEY = originalKey;
    }
  });

  it("a business event's email failure does not change the underlying successful business state (payment stays SUCCESS)", async () => {
    const org = await Organization.create({ name: "EmailFailCo", contactEmail: `ef-${new mongoose.Types.ObjectId()}@x.com`, contactPhone: "1", createdBy: new mongoose.Types.ObjectId(), status: OrganizationStatus.ACTIVE });
    await Wallet.create({ organizationId: org._id, balance: 0 });
    const user = await makeUser(Role.SUPER_ADMIN, org._id);
    await User.updateOne({ _id: user._id }, { email: "" }); // no valid recipient -> notifyUser skips email cleanly
    const orderResult = await PaymentService.createOrder({ organizationId: org._id, userId: user._id, amount: 500 });
    const razorpayPaymentId = `pay_${new mongoose.Types.ObjectId()}`;
    const signature = mockCheckoutSignature(orderResult.razorpayOrderId, razorpayPaymentId);
    const payment = await PaymentService.confirmPayment({ razorpayOrderId: orderResult.razorpayOrderId, razorpayPaymentId, razorpaySignature: signature, userId: user._id });
    expect(payment.status).toBe(PaymentStatus.SUCCESS);
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.balance).toBe(500); // wallet credit unaffected by absent/failed notification
  });
});

describe("OTP / password reset preservation", () => {
  it("OTP remains hashed in storage and the OTP email flow still functions", async () => {
    const user = await makeUser();
    const { OtpService } = require("../src/services/otp.service.js");
    const { challengeToken } = await OtpService.issue(user._id.toString(), "LOGIN", user.email, user.role);
    const { OTP } = await import("../src/models/index.js");
    const otp = await OTP.findOne({ challengeToken });
    expect(otp.codeHash).toBeDefined();
    expect(otp.codeHash.length).toBeGreaterThan(20); // a hash, not a 6-digit plaintext code
    const log = await EmailLog.findOne({ to: user.email, template: "otp" });
    expect(log).not.toBeNull();
    expect(log.status).toBe("SENT");
  });
});

describe("Certificate availability notification", () => {
  it("reaching ISSUED alone does not create a certificate-available notification - only attaching an actual document does", async () => {
    const { org, order, requester } = await makeLockedOrder();
    const actor = new mongoose.Types.ObjectId().toString();
    await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), actor, Role.MASTER_ADMIN);
    await EStampRequestService.syncEStampOrderStatus(order._id.toString(), org._id.toString(), actor, Role.MASTER_ADMIN);
    const issued = await EStampOrder.findById(order._id);
    expect(issued.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);
    const beforeAttach = await Notification.findOne({ recipientId: requester._id, title: "E-Stamp certificate available" });
    expect(beforeAttach).toBeNull();

    const uploadReq = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values((await import("@launcherdesk/shared")).Permission) },
      body: { organizationId: org._id.toString(), fileType: "ESTAMP_DOCUMENT", orderId: order._id.toString() },
      file: { buffer: Buffer.from("fake-cert"), originalname: "cert.pdf", mimetype: "application/pdf" },
    });
    const { error } = await runController(fileController.uploadFile, uploadReq, makeRes());
    expect(error).toBeNull();

    const afterAttach = await Notification.findOne({ recipientId: requester._id, title: "E-Stamp certificate available" });
    expect(afterAttach).not.toBeNull();
    const emailLog = await EmailLog.findOne({ to: requester.email, template: "certificateAvailable" });
    expect(emailLog).not.toBeNull();
  });
});
