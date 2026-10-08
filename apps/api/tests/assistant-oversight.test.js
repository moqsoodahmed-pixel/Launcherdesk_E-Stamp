import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import {
  User,
  Organization,
  Wallet,
  AuditLog,
  Notification,
  Article,
  ArticleVersion,
  EStampOrder,
  EStampDocument,
  FileAsset,
} from "../src/models/index.js";
import { Role, Permission, DEFAULT_ROLE_PERMISSIONS, AuditAction, OrganizationStatus } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import * as walletController from "../src/controllers/wallet.controller.js";
import * as fileController from "../src/controllers/file.controller.js";
import * as userController from "../src/controllers/user.controller.js";
import { requireRole } from "../src/middleware/authorize.js";
import { authenticate } from "../src/middleware/authenticate.js";
import { env } from "../src/config/env.js";
import jwt from "jsonwebtoken";
import { createUserSchema } from "@launcherdesk/validation";
import { makeReq, makeRes, runMiddleware, runController } from "./helpers/http.js";

async function makeOrgWithWallet(balance = 0) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: "Acme Client",
    contactEmail: `acme-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
  });
  await Wallet.create({ organizationId: org._id, balance });
  return org;
}

async function makeMasterAdmin() {
  return User.create({
    name: "Master Admin",
    email: `master-${new mongoose.Types.ObjectId()}@ld.local`,
    passwordHash: "x",
    role: Role.MASTER_ADMIN,
    organizationId: null,
    lastOtpVerifiedAt: new Date(),
  });
}

async function makeAssistant(permissions = DEFAULT_ROLE_PERMISSIONS[Role.ASSISTANT_MASTER_ADMIN]) {
  const password = "ChangeMe!Assistant1";
  const passwordHash = await AuthService.hashPassword(password);
  const user = await User.create({
    name: "Jane Assistant",
    email: `assistant-${new mongoose.Types.ObjectId()}@ld.local`,
    passwordHash,
    role: Role.ASSISTANT_MASTER_ADMIN,
    organizationId: null,
    permissions,
    lastOtpVerifiedAt: new Date(), // pre-verified so login skips OTP
  });
  return { user, password };
}

describe("Test 3: Assistant Master Admin cannot create Master Admin", () => {
  it("the generic user-creation schema only accepts client roles", async () => {
    for (const forbidden of [Role.MASTER_ADMIN, Role.ASSISTANT_MASTER_ADMIN]) {
      const result = createUserSchema.safeParse({
        name: "Someone",
        email: "someone@example.com",
        role: forbidden,
      });
      expect(result.success).toBe(false);
    }
  });

  it("the dedicated Assistant-Master-Admin creation route is Master-Admin-only", async () => {
    const req = makeReq({ user: { id: "x", role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [] } });
    const { threw } = await runMiddleware(requireRole(Role.MASTER_ADMIN), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });
});

describe("Test 4: Assistant Master Admin cannot elevate its own permissions", () => {
  it("updateAssistantAdminPermissions refuses a caller editing their own record, even if reached", async () => {
    const { user: assistant } = await makeAssistant([]);
    const req = makeReq({
      user: { id: assistant._id.toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: [] },
      params: { id: assistant._id.toString() },
      body: { permissions: [Permission.SETTINGS_MANAGE] },
    });
    const res = makeRes();
    const { error } = await runController(userController.updateAssistantAdminPermissions, req, res);
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
    const reloaded = await User.findById(assistant._id);
    expect(reloaded.permissions).toEqual([]); // unchanged
  });
});

describe("Test 10 & 11: Assistant Master Admin login creates an audit event AND a Master Admin notification", () => {
  it("issues tokens, records LOGIN audit, and notifies every active Master Admin", async () => {
    const master = await makeMasterAdmin();
    const { user: assistant, password } = await makeAssistant();

    const result = await AuthService.loginStep1(assistant.email, password, { headers: {}, ip: "127.0.0.1" });
    expect(result.requiresOtp).toBe(false);
    expect(result.accessToken).toBeDefined();

    const auditEntry = await AuditLog.findOne({ actorId: assistant._id, action: AuditAction.LOGIN });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.actorRole).toBe(Role.ASSISTANT_MASTER_ADMIN);

    const notification = await Notification.findOne({ recipientId: master._id });
    expect(notification).not.toBeNull();
    expect(notification.type).toBe("ASSISTANT_ADMIN_ACTIVITY");
    expect(notification.relatedActorId.toString()).toBe(assistant._id.toString());
  });

  it("a regular Super Admin login does NOT spam Master Admin with a notification", async () => {
    const master = await makeMasterAdmin();
    const org = await makeOrgWithWallet();
    const password = "ChangeMe!SuperAdmin1";
    const passwordHash = await AuthService.hashPassword(password);
    const superAdmin = await User.create({
      name: "Super Admin",
      email: "super@ld.local",
      passwordHash,
      role: Role.SUPER_ADMIN,
      organizationId: org._id,
      lastOtpVerifiedAt: new Date(),
    });
    await AuthService.loginStep1(superAdmin.email, password, { headers: {}, ip: "127.0.0.1" });
    const notification = await Notification.findOne({ recipientId: master._id });
    expect(notification).toBeNull();
  });
});

describe("Test 12 & 13: Assistant Master Admin balance change creates audit + Master Admin notification", () => {
  it("manualCredit records BALANCE_CHANGED audit and notifies Master Admin", async () => {
    const master = await makeMasterAdmin();
    const org = await makeOrgWithWallet(1000);
    const { user: assistant } = await makeAssistant();

    const req = makeReq({
      user: { id: assistant._id.toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: DEFAULT_ROLE_PERMISSIONS[Role.ASSISTANT_MASTER_ADMIN] },
      params: { organizationId: org._id.toString() },
      body: { amount: 500, description: "Top-up" },
    });
    const res = makeRes();
    const { error } = await runController(walletController.manualCredit, req, res);
    expect(error).toBeNull();
    expect(res.body.data.balance).toBe(1500);

    const auditEntry = await AuditLog.findOne({ actorId: assistant._id.toString(), action: AuditAction.BALANCE_CHANGED });
    expect(auditEntry).not.toBeNull();

    const notification = await Notification.findOne({ recipientId: master._id, type: "ASSISTANT_ADMIN_ACTIVITY" });
    expect(notification).not.toBeNull();
    expect(notification.organizationId.toString()).toBe(org._id.toString());
  });
});

describe("Test 14/15 & 16/17: Assistant Master Admin E-Stamp upload/download create audit + Master Admin notification", () => {
  it("uploadFile records ESTAMP_UPLOADED audit and notifies Master Admin", async () => {
    const master = await makeMasterAdmin();
    const org = await makeOrgWithWallet();
    const { user: assistant } = await makeAssistant();

    const req = makeReq({
      user: { id: assistant._id.toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: DEFAULT_ROLE_PERMISSIONS[Role.ASSISTANT_MASTER_ADMIN] },
      body: { organizationId: org._id.toString(), fileType: "ESTAMP_DOCUMENT" },
      file: { buffer: Buffer.from("test-pdf-bytes"), originalname: "stamp.pdf", mimetype: "application/pdf" },
    });
    const res = makeRes();
    const { error } = await runController(fileController.uploadFile, req, res);
    expect(error).toBeNull();

    const asset = await FileAsset.findOne({ organizationId: org._id });
    expect(asset).not.toBeNull();

    const auditEntry = await AuditLog.findOne({ actorId: assistant._id.toString(), action: AuditAction.ESTAMP_UPLOADED });
    expect(auditEntry).not.toBeNull();

    const notification = await Notification.findOne({ recipientId: master._id, type: "ASSISTANT_ADMIN_ACTIVITY" });
    expect(notification).not.toBeNull();
  });

  it("downloadEStamp records ESTAMP_DOWNLOADED audit and notifies Master Admin", async () => {
    const master = await makeMasterAdmin();
    const org = await makeOrgWithWallet();
    const { user: assistant } = await makeAssistant();

    const asset = await FileAsset.create({
      organizationId: org._id,
      ownerUserId: assistant._id,
      cloudinaryPublicId: "mock/test/123",
      resourceType: "raw",
      fileType: "ESTAMP_DOCUMENT",
      originalFileName: "stamp.pdf",
      mimeType: "application/pdf",
      sizeBytes: 123,
    });
    const order = await EStampOrder.create({
      organizationId: org._id,
      orderNumber: "LDE-ORD-TEST-1",
      requestId: new mongoose.Types.ObjectId(),
      createdBy: assistant._id,
      stateCode: "KA",
      articleId: new mongoose.Types.ObjectId(),
      amount: 100,
      eStampStatus: "ISSUED",
      status: "COMPLETED",
    });
    const doc = await EStampDocument.create({
      organizationId: org._id,
      requestId: new mongoose.Types.ObjectId(),
      orderId: order._id,
      fileAssetId: asset._id,
    });

    const req = makeReq({
      user: { id: assistant._id.toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: DEFAULT_ROLE_PERMISSIONS[Role.ASSISTANT_MASTER_ADMIN] },
      params: { orderId: order._id.toString() },
    });
    const res = makeRes();
    const { error } = await runController(fileController.downloadEStamp, req, res);
    expect(error).toBeNull();
    expect(res.body.data.url).toBeDefined();

    const reloadedDoc = await EStampDocument.findById(doc._id);
    expect(reloadedDoc.downloadHistory.length).toBe(1);
    expect(reloadedDoc.downloadHistory[0].downloadedByRole).toBe(Role.ASSISTANT_MASTER_ADMIN);

    const auditEntry = await AuditLog.findOne({ actorId: assistant._id.toString(), action: AuditAction.ESTAMP_DOWNLOADED });
    expect(auditEntry).not.toBeNull();

    const notification = await Notification.findOne({ recipientId: master._id, type: "ASSISTANT_ADMIN_ACTIVITY" });
    expect(notification).not.toBeNull();
  });
});

describe("Test 18 & 19: Article management is Master-Admin-gated; viewing works for client roles", () => {
  it("write routes require MASTER_ADMIN (Assistant Master Admin, by default, does not have article.manage)", async () => {
    for (const role of [Role.ASSISTANT_MASTER_ADMIN, Role.SUPER_ADMIN, Role.ADMIN, Role.USER]) {
      const req = makeReq({ user: { id: "x", role, organizationId: null, permissions: [] } });
      const { threw } = await runMiddleware(requireRole(Role.MASTER_ADMIN), req, makeRes());
      expect(threw).not.toBeNull();
      expect(threw.statusCode).toBe(403);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(Permission.ARTICLE_MANAGE);
    }
  });

  it("client roles (Super Admin, Admin, User) can view Articles", async () => {
    const masterId = new mongoose.Types.ObjectId();
    const article = await Article.create({
      stateCode: "KA",
      articleCode: "2(B)",
      title: "Test Article",
      createdBy: masterId,
      currentVersion: 1,
    });
    await ArticleVersion.create({
      articleId: article._id,
      versionNumber: 1,
      calculationRule: { type: "FIXED", fixedAmount: 100 },
      createdBy: masterId,
    });
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.USER]) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(Permission.ARTICLE_VIEW);
    }
    const found = await Article.find({ isActive: true });
    expect(found.length).toBe(1);
  });
});

describe("Test 20: 24-hour OTP re-verification is enforced identically across all five roles", () => {
  it("every role is blocked once lastOtpVerifiedAt is older than the reverify window, and allowed just after re-verifying", async () => {
    const org = await makeOrgWithWallet();
    const roles = [
      { role: Role.MASTER_ADMIN, organizationId: null },
      { role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null },
      { role: Role.SUPER_ADMIN, organizationId: org._id },
      { role: Role.ADMIN, organizationId: org._id },
      { role: Role.USER, organizationId: org._id },
    ];

    for (const { role, organizationId } of roles) {
      const staleUser = await User.create({
        name: `Stale ${role}`,
        email: `stale-${role}-${new mongoose.Types.ObjectId()}@ld.local`,
        passwordHash: "x",
        role,
        organizationId,
        lastOtpVerifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h ago
      });
      const staleToken = jwt.sign({ userId: staleUser._id.toString(), tokenVersion: 0 }, env.JWT_SECRET);
      const staleReq = makeReq({ headers: { authorization: `Bearer ${staleToken}` } });
      const { threw: staleThrew } = await runMiddleware(authenticate, staleReq, makeRes());
      expect(staleThrew).not.toBeNull();
      expect(staleThrew.statusCode).toBe(401);

      const freshUser = await User.create({
        name: `Fresh ${role}`,
        email: `fresh-${role}-${new mongoose.Types.ObjectId()}@ld.local`,
        passwordHash: "x",
        role,
        organizationId,
        lastOtpVerifiedAt: new Date(), // just verified
      });
      const freshToken = jwt.sign({ userId: freshUser._id.toString(), tokenVersion: 0 }, env.JWT_SECRET);
      const freshReq = makeReq({ headers: { authorization: `Bearer ${freshToken}` } });
      const { threw: freshThrew } = await runMiddleware(authenticate, freshReq, makeRes());
      expect(freshThrew).toBeNull();
      expect(freshReq.user.role).toBe(role);
    }
  });
});