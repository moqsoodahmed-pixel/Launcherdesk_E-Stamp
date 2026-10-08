// Phase 20 - Final QA: full-chain end-to-end lifecycle test.
//
// Every step below (organization creation, activation, Super Admin
// provisioning, article authoring, wallet funding, E-Stamp request creation,
// modification-window expiry, order processing, provider issuance,
// certificate attachment, and download) already has dedicated, thorough
// per-step/per-resource coverage elsewhere in this suite (organization.test.js,
// article.test.js, wallet.test.js, estamp-request.test.js, order-management
// .test.js, estamp-processing.test.js, document-management.test.js).
//
// What does NOT exist anywhere else is ONE continuous test that drives every
// step through its REAL controller entry point in sequence, using the output
// of each step as the input to the next - exactly as a real deployment would.
// Every other test file fabricates its starting fixtures directly via
// Model.create({..., status: ACTIVE, isEstampServiceEnabled: true}), bypassing
// createOrganization/setEstampServiceEnabled/provisionSuperAdmin entirely.
// That's the right call for isolating what each of those tests actually means
// to prove, but it also means a bug at the SEAM between two real endpoints
// (e.g. createOrganization's wallet always starting at 0, or
// provisionSuperAdmin's organizationId not matching what createRequest later
// reads) would never surface in any single existing test. This test exists to
// catch exactly that class of integration bug, not to re-prove any individual
// step.
import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import {
  Organization,
  Wallet,
  WalletTransaction,
  Article,
  User,
  AuditLog,
  EStampRequest,
  EStampOrder,
  EStampDocument,
} from "../src/models/index.js";
import {
  Role,
  Permission,
  getEffectivePermissions,
  OrganizationStatus,
  EStampRequestStatus,
  EStampOrderProcessingStatus,
  AuditAction,
} from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import * as orgController from "../src/controllers/organization.controller.js";
import * as articleController from "../src/controllers/article.controller.js";
import * as walletController from "../src/controllers/wallet.controller.js";
import * as estampController from "../src/controllers/estamp-request.controller.js";
import * as orderController from "../src/controllers/order.controller.js";
import * as fileController from "../src/controllers/file.controller.js";
import {
  createOrganizationSchema,
  provisionSuperAdminSchema,
  createEStampRequestSchema,
} from "@launcherdesk/validation";
import { makeReq, makeRes, runController } from "./helpers/http.js";

function masterAdminReq(overrides = {}) {
  return makeReq({
    user: {
      id: new mongoose.Types.ObjectId().toString(),
      role: Role.MASTER_ADMIN,
      organizationId: null,
      // Master Admin implicitly has every permission in production (enforced
      // by getEffectivePermissions), but controllers that inline-check
      // req.user.permissions directly (e.g. file.controller's ORDER_MANAGE
      // gate) need the array populated the same way authenticate.js would -
      // this mirrors the exact convention estamp-processing.test.js/
      // document-management.test.js already use for the same reason.
      permissions: Object.values(Permission),
    },
    ...overrides,
  });
}

describe("Full lifecycle - real endpoints end to end", () => {
  it("org creation -> activation -> Super Admin provisioning -> article -> wallet funding -> request -> lock -> process -> issue -> certificate attach -> download, all through real controllers", async () => {
    // 1. Master Admin creates the client organization.
    const createOrgBody = createOrganizationSchema.parse({
      name: "Full Chain Pvt Ltd",
      contactEmail: `full-chain-${new mongoose.Types.ObjectId()}@example.com`,
      contactPhone: "9876500000",
    });
    const createOrgResult = await runController(
      orgController.createOrganization,
      masterAdminReq({ body: createOrgBody }),
      makeRes()
    );
    expect(createOrgResult.error).toBeNull();
    const orgId = createOrgResult.res.body.data._id.toString();
    expect(createOrgResult.res.body.data.status).toBe(OrganizationStatus.PENDING_APPROVAL);

    // A wallet must exist immediately, at zero balance - never created lazily
    // later, and never pre-funded.
    const freshWallet = await Wallet.findOne({ organizationId: orgId });
    expect(freshWallet).not.toBeNull();
    expect(freshWallet.balance).toBe(0);

    // 2. Activate the organization and enable the E-Stamp service - both
    // deliberately separate, tightly-gated endpoints (never settable through
    // updateOrganization's writable-field whitelist).
    const activateResult = await runController(
      orgController.updateOrganizationStatus,
      masterAdminReq({ params: { id: orgId }, body: { status: OrganizationStatus.ACTIVE } }),
      makeRes()
    );
    expect(activateResult.error).toBeNull();
    expect(activateResult.res.body.data.status).toBe(OrganizationStatus.ACTIVE);

    const enableEstampResult = await runController(
      orgController.setEstampServiceEnabled,
      masterAdminReq({ params: { id: orgId }, body: { enabled: true } }),
      makeRes()
    );
    expect(enableEstampResult.error).toBeNull();
    expect(enableEstampResult.res.body.data.isEstampServiceEnabled).toBe(true);

    // 3. Provision the organization's first Super Admin.
    const provisionBody = provisionSuperAdminSchema.parse({
      name: "Chain Super Admin",
      email: `chain-super-${new mongoose.Types.ObjectId()}@example.com`,
      phone: "9876500001",
    });
    const provisionResult = await runController(
      orgController.provisionSuperAdmin,
      masterAdminReq({ params: { id: orgId }, body: provisionBody }),
      makeRes()
    );
    expect(provisionResult.error).toBeNull();
    const superAdminId = provisionResult.res.body.data.user._id.toString();
    // Never leaks the password hash back to the caller, even though a
    // one-time temp password is deliberately returned for handover.
    expect(provisionResult.res.body.data.user.passwordHash).toBeUndefined();
    expect(provisionResult.res.body.data.tempPassword).toBeTruthy();

    const superAdminUser = await User.findById(superAdminId);
    expect(superAdminUser.organizationId.toString()).toBe(orgId);
    expect(superAdminUser.role).toBe(Role.SUPER_ADMIN);

    function superAdminReq(overrides = {}) {
      return makeReq({
        user: {
          id: superAdminId,
          role: Role.SUPER_ADMIN,
          organizationId: orgId,
          permissions: getEffectivePermissions(Role.SUPER_ADMIN),
        },
        ...overrides,
      });
    }

    // 4. Master Admin authors the Article this org's request will reference.
    const createArticleResult = await runController(
      articleController.createArticle,
      masterAdminReq({
        body: {
          stateCode: "KA",
          articleCode: `FULLCHAIN-${new mongoose.Types.ObjectId()}`,
          title: "Full Chain Test Article",
          calculationRule: { type: "FIXED", fixedAmount: 750 },
        },
      }),
      makeRes()
    );
    expect(createArticleResult.error).toBeNull();
    const articleId = createArticleResult.res.body.data._id.toString();
    const article = await Article.findById(articleId);
    expect(article.isActive).toBe(true); // active by default, no extra step needed

    // 5. Master Admin funds the wallet via the manual-credit path (the
    // non-Razorpay path already used for offline reconciliation).
    const creditResult = await runController(
      walletController.manualCredit,
      masterAdminReq({ params: { organizationId: orgId }, body: { amount: 50000, description: "Full chain test funding" } }),
      makeRes()
    );
    expect(creditResult.error).toBeNull();
    expect(creditResult.res.body.data.balance).toBe(50000);
    const fundedWallet = await Wallet.findOne({ organizationId: orgId });
    expect(fundedWallet.balance).toBe(50000);

    // 6. The Super Admin creates a real E-Stamp request against the now-active,
    // now-funded organization and the just-authored article.
    const createRequestBody = createEStampRequestSchema.parse({
      stateCode: "KA",
      articleId,
      firstParty: "Full Chain Alice",
      secondParty: "Full Chain Bob",
      descriptionOfDocument: "Full chain lease agreement",
      considerationPrice: 0,
      stampDutyPaidBy: "Full Chain Alice",
      numberOfEStamps: 1,
    });
    const createRequestResult = await runController(
      estampController.createRequest,
      superAdminReq({ body: createRequestBody }),
      makeRes()
    );
    expect(createRequestResult.error).toBeNull();
    const { request: createdRequest, order: createdOrder } = createRequestResult.res.body.data;
    expect(createdRequest.calculatedStampDuty).toBe(750);
    expect(createdRequest.status).toBe(EStampRequestStatus.MODIFICATION_WINDOW);

    // The wallet debit and the request creation are provably linked - exactly
    // the funded amount minus the calculated duty, never a different amount.
    const walletAfterRequest = await Wallet.findOne({ organizationId: orgId });
    expect(walletAfterRequest.balance).toBe(50000 - 750);

    // 7. Simulate the modification window actually expiring, then run the
    // REAL lockExpiredRequests cron job (not a direct status overwrite) so
    // this test also proves the cron correctly picks up a request created
    // through the real creation endpoint above.
    await EStampRequest.updateOne(
      { _id: createdRequest._id },
      { $set: { modificationDeadline: new Date(Date.now() - 1000) } }
    );
    const lockedCount = await EStampRequestService.lockExpiredRequests();
    expect(lockedCount).toBeGreaterThanOrEqual(1);
    const lockedRequest = await EStampRequest.findById(createdRequest._id);
    expect(lockedRequest.status).toBe(EStampRequestStatus.LOCKED);
    const lockedOrder = await EStampOrder.findById(createdOrder._id);
    expect(lockedOrder.eStampStatus).toBe(EStampOrderProcessingStatus.CREATED);

    // 8. An internal ops actor (Master Admin) processes and syncs the order
    // through the mock provider to a real ISSUED state - order processing is
    // deliberately NOT something the client's own Super Admin can do (no
    // ORDER_MANAGE in that role's default permissions), matching
    // order-management.test.js's existing coverage of that exact boundary.
    const processResult = await runController(
      orderController.processOrder,
      masterAdminReq({ params: { id: createdOrder._id.toString() }, query: { organizationId: orgId } }),
      makeRes()
    );
    expect(processResult.error).toBeNull();

    const syncResult = await runController(
      orderController.syncOrder,
      masterAdminReq({ params: { id: createdOrder._id.toString() }, query: { organizationId: orgId } }),
      makeRes()
    );
    expect(syncResult.error).toBeNull();
    const issuedOrder = await EStampOrder.findById(createdOrder._id);
    expect(issuedOrder.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);
    expect(issuedOrder.providerReference).toBeTruthy();

    // 9. Attach the issued certificate (Master Admin, on behalf of the org).
    const attachResult = await runController(
      fileController.uploadFile,
      masterAdminReq({
        body: { organizationId: orgId, orderId: createdOrder._id.toString(), fileType: "ESTAMP_DOCUMENT" },
        file: { buffer: Buffer.from("full-chain-fake-pdf-bytes"), originalname: "stamp.pdf", mimetype: "application/pdf" },
      }),
      makeRes()
    );
    expect(attachResult.error).toBeNull();
    const orderAfterAttach = await EStampOrder.findById(createdOrder._id);
    expect(orderAfterAttach.downloadStatus).toBe("AVAILABLE");
    const requestAfterAttach = await EStampRequest.findById(createdRequest._id);
    expect(requestAfterAttach.status).toBe(EStampRequestStatus.DOWNLOAD_AVAILABLE);

    // 10. The org's own Super Admin - who created the request in step 6 -
    // downloads the certificate, proving the whole chain is tenant-consistent
    // end to end (same org id threaded from creation through to download).
    const downloadResult = await runController(
      fileController.downloadEStamp,
      superAdminReq({ params: { orderId: createdOrder._id.toString() } }),
      makeRes()
    );
    expect(downloadResult.error).toBeNull();
    expect(downloadResult.res.body.data.url).toBeTruthy();
    expect(downloadResult.res.body.data.filename).toBeTruthy();

    // A different organization's Super Admin must never be able to reach any
    // of this - a single consolidated tenant-isolation check across the
    // resources this chain touched, rather than a 20th scattered test.
    const otherOrg = await Organization.create({
      name: "Unrelated Org",
      contactEmail: `unrelated-${new mongoose.Types.ObjectId()}@example.com`,
      contactPhone: "1111111111",
      createdBy: new mongoose.Types.ObjectId(),
      status: OrganizationStatus.ACTIVE,
    });
    const otherUser = await User.create({
      name: "Other Org Admin",
      email: `other-admin-${new mongoose.Types.ObjectId()}@ld.local`,
      passwordHash: "x",
      role: Role.SUPER_ADMIN,
      organizationId: otherOrg._id,
    });
    function otherOrgReq(overrides = {}) {
      return makeReq({
        user: { id: otherUser._id.toString(), role: Role.SUPER_ADMIN, organizationId: otherOrg._id.toString(), permissions: getEffectivePermissions(Role.SUPER_ADMIN) },
        ...overrides,
      });
    }
    const foreignRequestView = await runController(
      estampController.getRequest,
      otherOrgReq({ params: { id: createdRequest._id.toString() } }),
      makeRes()
    );
    expect(foreignRequestView.error).not.toBeNull();
    expect(foreignRequestView.error.statusCode).toBe(404);

    const foreignDownload = await runController(
      fileController.downloadEStamp,
      otherOrgReq({ params: { orderId: createdOrder._id.toString() } }),
      makeRes()
    );
    expect(foreignDownload.error).not.toBeNull();
    expect(foreignDownload.error.statusCode).toBe(404);

    // Final sanity: the full audit trail for this chain exists, correctly
    // attributed, from org creation all the way to certificate download.
    const auditActions = await AuditLog.find({
      $or: [
        { entityType: "Organization", entityId: orgId },
        { entityType: "EStampRequest", entityId: createdRequest._id.toString() },
        { entityType: "EStampOrder", entityId: createdOrder._id.toString() },
        { entityType: "EStampDocument" },
      ],
    }).select("action");
    const actions = auditActions.map((a) => a.action);
    expect(actions).toContain(AuditAction.ORG_CREATED);
    expect(actions).toContain(AuditAction.ESTAMP_REQUEST_CREATED);
    expect(actions).toContain(AuditAction.ESTAMP_REQUEST_LOCKED);
    expect(actions).toContain(AuditAction.ESTAMP_DOWNLOADED);

    const walletTxCount = await WalletTransaction.countDocuments({ organizationId: orgId });
    // Exactly two ledger movements happened in this whole chain: the manual
    // credit and the request debit - never more, never a phantom entry.
    expect(walletTxCount).toBe(2);
  });
});
