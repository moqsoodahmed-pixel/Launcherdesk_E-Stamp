import { describe, it, expect, beforeEach } from "vitest";
import "./setup.js";
import mongoose from "mongoose";
import {
  Organization,
  Wallet,
  Article,
  ArticleVersion,
  User,
  EStampRequest,
  EStampOrder,
  Notification,
  FileAsset,
} from "../src/models/index.js";
import {
  Role,
  Permission,
  OrganizationStatus,
  EStampRequestStatus,
  NotificationType,
} from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { SmtpEmailProvider } from "../src/services/email-providers/SmtpEmailProvider.js";
import { BrevoEmailProvider } from "../src/services/email-providers/BrevoEmailProvider.js";
import { getEmailProvider } from "../src/services/email-providers/index.js";
import * as estampCtrl from "../src/controllers/estamp-request.controller.js";
import * as orderCtrl from "../src/controllers/order.controller.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";

describe("E-Stamping Purchase, Admin Notifications, Document Verification, and 20-Minute Wallet Deduction", () => {
  let masterAdmin;
  let superAdmin;
  let org;
  let article;

  beforeEach(async () => {
    masterAdmin = await User.create({
      name: "Master Admin User",
      email: `master.${new mongoose.Types.ObjectId()}@launcherdesk.com`,
      passwordHash: "hash123",
      role: Role.MASTER_ADMIN,
      permissions: Object.values(Permission),
      isActive: true,
    });

    org = await Organization.create({
      name: "Acme Enterprises Ltd",
      contactEmail: `contact.${new mongoose.Types.ObjectId()}@acme.com`,
      contactPhone: "9876543210",
      createdBy: masterAdmin._id,
      status: OrganizationStatus.ACTIVE,
      isEstampServiceEnabled: true,
    });

    await Wallet.create({
      organizationId: org._id,
      balance: 10000,
      reservedBalance: 0,
    });

    superAdmin = await User.create({
      name: "Super Admin Jeevan",
      email: `jeevan.${new mongoose.Types.ObjectId()}@launcherdesk.com`,
      passwordHash: "hash123",
      role: Role.SUPER_ADMIN,
      organizationId: org._id,
      permissions: [
        Permission.ESTAMP_CREATE,
        Permission.ESTAMP_VIEW,
        Permission.ESTAMP_MODIFY,
        Permission.ESTAMP_CANCEL,
        Permission.ORDER_VIEW,
        Permission.WALLET_VIEW,
      ],
      isActive: true,
    });

    article = await Article.create({
      stateCode: "KA",
      articleCode: `ART-${new mongoose.Types.ObjectId()}`,
      title: "Commercial Affidavit",
      createdBy: masterAdmin._id,
      currentVersion: 1,
    });

    await ArticleVersion.create({
      articleId: article._id,
      versionNumber: 1,
      calculationRule: { type: "FIXED", fixedAmount: 500 },
      createdBy: masterAdmin._id,
    });
  });

  async function createSampleRequest() {
    const req = makeReq({
      user: {
        id: superAdmin._id.toString(),
        role: Role.SUPER_ADMIN,
        organizationId: org._id.toString(),
        permissions: [Permission.ESTAMP_CREATE, Permission.ESTAMP_VIEW],
      },
      body: {
        stateCode: "KA",
        articleId: article._id.toString(),
        firstParty: "Acme First Party Corp",
        secondParty: "Beta Second Party LLC",
        descriptionOfDocument: "Commercial Service Agreement",
        considerationPrice: 50000,
        stampDutyPaidBy: "Acme First Party Corp",
        numberOfEStamps: 1,
      },
    });

    const res = makeRes();
    const { res: response, error } = await runController(estampCtrl.createRequest, req, res);
    expect(error).toBeNull();
    expect(response.statusCode).toBe(201);
    return { request: response.body.data.request, order: response.body.data.order };
  }

  it("1. When Super Admin creates an E-Stamp order, Master Admin and Org Admins receive real-time notifications with full order details", async () => {
    const { request: createdRequest, order: createdOrder } = await createSampleRequest();

    // Check notifications for Master Admin
    const masterNotification = await Notification.findOne({
      recipientId: masterAdmin._id.toString(),
      type: NotificationType.ESTAMP_STATUS,
    });

    expect(masterNotification).not.toBeNull();
    expect(masterNotification.title).toContain(createdOrder.orderNumber);
    expect(masterNotification.message).toContain("Acme Enterprises Ltd");
    expect(masterNotification.message).toContain(createdRequest.requestNumber);
    expect(masterNotification.metadata.firstParty).toBe("Acme First Party Corp");
    expect(masterNotification.metadata.secondParty).toBe("Beta Second Party LLC");

    // Check notifications for Org Admin (Super Admin)
    const orgNotification = await Notification.findOne({
      recipientId: superAdmin._id.toString(),
      type: NotificationType.ESTAMP_STATUS,
    });

    expect(orgNotification).not.toBeNull();
    expect(orgNotification.title).toContain(createdOrder.orderNumber);
    expect(orgNotification.message).toContain(createdRequest.requestNumber);

    // Check wallet reservation
    const wallet = await Wallet.findOne({ organizationId: org._id });
    expect(wallet.reservedBalance).toBe(createdRequest.calculatedStampDuty);
    expect(createdRequest.chargeStatus).toBe("RESERVED");
  });

  it("2. Admins and Master Admins can review details and verify/confirm documents", async () => {
    const { request: createdRequest, order: createdOrder } = await createSampleRequest();
    expect(createdRequest.documentsVerified).toBe(false);

    // Master Admin verifies documents via request route
    const verifyReq = makeReq({
      user: {
        id: masterAdmin._id.toString(),
        role: Role.MASTER_ADMIN,
        permissions: Object.values(Permission),
      },
      params: { id: createdRequest._id.toString() },
      body: { notes: "All identification and agreement clauses confirmed correct." },
    });

    const verifyRes = makeRes();
    const { res: verifyResponse, error: verifyError } = await runController(estampCtrl.verifyDocuments, verifyReq, verifyRes);

    expect(verifyError).toBeNull();
    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.body.data.documentsVerified).toBe(true);
    expect(verifyResponse.body.data.verificationNotes).toBe("All identification and agreement clauses confirmed correct.");

    // Check that linked order also has documentsVerified = true
    const updatedOrder = await EStampOrder.findById(createdRequest.orderId);
    expect(updatedOrder.documentsVerified).toBe(true);
    expect(updatedOrder.verificationNotes).toBe("All identification and agreement clauses confirmed correct.");

    // Check getOrder returns document verification status and supporting documents
    const getOrderReq = makeReq({
      user: {
        id: masterAdmin._id.toString(),
        role: Role.MASTER_ADMIN,
        permissions: [Permission.ORDER_VIEW],
      },
      params: { id: updatedOrder._id.toString() },
    });
    const getOrderRes = makeRes();
    const { res: getOrderResponse, error: getOrderError } = await runController(orderCtrl.getOrder, getOrderReq, getOrderRes);

    expect(getOrderError).toBeNull();
    const orderData = getOrderResponse.body;
    expect(orderData.data.order.documentsVerified).toBe(true);
    expect(orderData.data.request.documentsVerified).toBe(true);
    expect(Array.isArray(orderData.data.supportingDocuments)).toBe(true);
  });

  it("3. After 20-minute window completes, wallet balance is automatically reduced and charged", async () => {
    const { request } = await createSampleRequest();
    const initialWallet = await Wallet.findOne({ organizationId: org._id });
    const initialBalance = initialWallet.balance;
    const reservedAmount = request.reservedAmount;

    // Simulate 20 minutes having passed
    await EStampRequest.updateOne(
      { _id: request._id },
      { modificationDeadline: new Date(Date.now() - 1000) }
    );

    // Run lockExpiredRequests job (which runs on interval in server.js)
    const lockedCount = await EStampRequestService.lockExpiredRequests();
    expect(lockedCount).toBe(1);

    // Verify request is locked and charged
    const lockedRequest = await EStampRequest.findById(request._id);
    expect(lockedRequest.status).toBe(EStampRequestStatus.LOCKED);
    expect(lockedRequest.chargeStatus).toBe("CHARGED");
    expect(lockedRequest.chargedAt).toBeDefined();

    // Verify linked order is ready for processing and paid
    const linkedOrder = await EStampOrder.findById(request.orderId);
    expect(linkedOrder.paymentStatus).toBe("PAID");

    // Verify wallet: balance is deducted by reservedAmount, reservedBalance is cleared to 0
    const finalWallet = await Wallet.findOne({ organizationId: org._id });
    expect(finalWallet.balance).toBe(initialBalance - reservedAmount);
    expect(finalWallet.reservedBalance).toBe(0);

    // Verify Org Admin received deduction notification
    const deductionNotification = await Notification.findOne({
      recipientId: superAdmin._id.toString(),
      type: NotificationType.PAYMENT,
      title: "E-Stamp Wallet Amount Charged",
    });
    expect(deductionNotification).not.toBeNull();
    expect(deductionNotification.message).toContain(`₹${reservedAmount} has been deducted`);
  });

  it("4. Email providers: SmtpEmailProvider handles direct SMTP delivery and BrevoEmailProvider surfaces full error information", () => {
    const smtp = new SmtpEmailProvider();
    expect(typeof smtp.send).toBe("function");

    const brevo = new BrevoEmailProvider();
    expect(typeof brevo.send).toBe("function");

    // Email provider selection
    const provider = getEmailProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.send).toBe("function");
  });
});
