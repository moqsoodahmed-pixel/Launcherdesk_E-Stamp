import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import {
  Organization,
  Wallet,
  Article,
  ArticleVersion,
  User,
  AuditLog,
  Notification,
  EmailLog,
  EStampRequest,
  EStampOrder,
  EStampDocument,
  FileAsset,
} from "../src/models/index.js";
import {
  Role,
  Permission,
  AuditAction,
  OrganizationStatus,
  EStampRequestStatus,
  EStampOrderProcessingStatus,
} from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { FileService } from "../src/services/file.service.js";
import * as fileController from "../src/controllers/file.controller.js";
import * as orderController from "../src/controllers/order.controller.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";

// ---- Fixtures --------------------------------------------------------

async function makeOrg(overrides = {}) {
  const creator = new mongoose.Types.ObjectId();
  return Organization.create({
    name: `Doc Test Co ${new mongoose.Types.ObjectId()}`,
    contactEmail: `doc-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
    ...overrides,
  });
}

// Drives a brand-new request all the way to a real ISSUED order via the
// EXISTING Phase 7 EStampRequestService (processOrder -> syncOrder against
// the mock provider) - never fabricates ISSUED by direct field assignment,
// matching the actual production path a document attachment would follow.
async function makeIssuedOrder({ org, balance = 100000, fixedAmount = 500 } = {}) {
  org = org || (await makeOrg());
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({
    stateCode: "KA",
    articleCode: `DOC-${new mongoose.Types.ObjectId()}`,
    title: "Doc Mgmt Article",
    createdBy: new mongoose.Types.ObjectId(),
    currentVersion: 1,
  });
  await ArticleVersion.create({
    articleId: article._id,
    versionNumber: 1,
    calculationRule: { type: "FIXED", fixedAmount },
    createdBy: new mongoose.Types.ObjectId(),
  });
  const requester = await User.create({
    name: "Client Requester",
    email: `requester-${new mongoose.Types.ObjectId()}@example.com`,
    passwordHash: "x",
    role: Role.SUPER_ADMIN,
    organizationId: org._id,
  });
  const { request, order } = await EStampRequestService.createRequest({
    organizationId: org._id,
    createdBy: requester._id,
    stateCode: "KA",
    articleId: article._id.toString(),
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Doc mgmt test",
    considerationPrice: 0,
    stampDutyPaidBy: "Alice",
    numberOfEStamps: 1,
  });
  request.status = EStampRequestStatus.LOCKED;
  request.lockedAt = new Date();
  await request.save();
  order.eStampStatus = EStampOrderProcessingStatus.CREATED;
  await order.save();
  await EStampRequestService.processOrder(order._id.toString(), org._id.toString(), requester._id.toString(), Role.SUPER_ADMIN);
  await EStampRequestService.syncEStampOrderStatus(order._id.toString(), org._id.toString(), requester._id.toString(), Role.SUPER_ADMIN);
  const issuedOrder = await EStampOrder.findById(order._id);
  expect(issuedOrder.eStampStatus).toBe(EStampOrderProcessingStatus.ISSUED);
  return { org, article, request, order: issuedOrder, requester };
}

function masterReq(overrides = {}) {
  return makeReq({
    user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: Object.values(Permission) },
    ...overrides,
  });
}

function pdfFile(buffer = Buffer.from("test-pdf-bytes-A")) {
  return { buffer, originalname: "stamp.pdf", mimetype: "application/pdf" };
}

async function attach(org, order, { file, actor } = {}) {
  const req = actor
    ? masterReq({ body: { organizationId: org._id.toString(), orderId: order._id.toString(), fileType: "ESTAMP_DOCUMENT" }, file: file || pdfFile(), user: actor })
    : masterReq({ body: { organizationId: org._id.toString(), orderId: order._id.toString(), fileType: "ESTAMP_DOCUMENT" }, file: file || pdfFile() });
  return runController(fileController.uploadFile, req, makeRes());
}

// ---- Attachment --------------------------------------------------------

describe("Certificate attachment", () => {
  it("a valid PDF attaches successfully, sets downloadStatus=AVAILABLE and the request to DOWNLOAD_AVAILABLE", async () => {
    const { org, order, request } = await makeIssuedOrder();
    const { error } = await attach(org, order);
    expect(error).toBeNull();

    const reloadedOrder = await EStampOrder.findById(order._id);
    expect(reloadedOrder.downloadStatus).toBe("AVAILABLE");
    const reloadedRequest = await EStampRequest.findById(request._id);
    expect(reloadedRequest.status).toBe(EStampRequestStatus.DOWNLOAD_AVAILABLE);

    const doc = await EStampDocument.findOne({ orderId: order._id });
    expect(doc).not.toBeNull();
  });

  it("wrong MIME type is rejected with a clean 400, not a 500", async () => {
    const { org, order } = await makeIssuedOrder();
    const { error } = await attach(org, order, { file: { buffer: Buffer.from("exe-bytes"), originalname: "virus.exe", mimetype: "application/x-msdownload" } });
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("UNSUPPORTED_FILE_TYPE");
    const doc = await EStampDocument.findOne({ orderId: order._id });
    expect(doc).toBeNull();
  });

  it("an oversized file is rejected with a clean 400, not a 500", async () => {
    const { org, order } = await makeIssuedOrder();
    const oversized = Buffer.alloc(11 * 1024 * 1024); // > default 10MB
    const { error } = await attach(org, order, { file: { buffer: oversized, originalname: "big.pdf", mimetype: "application/pdf" } });
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("FILE_TOO_LARGE");
  });

  it("a genuine duplicate attachment is rejected with DOCUMENT_ALREADY_ATTACHED and does not create a second EStampDocument", async () => {
    const { org, order } = await makeIssuedOrder();
    const first = await attach(org, order);
    expect(first.error).toBeNull();
    const second = await attach(org, order);
    expect(second.error).not.toBeNull();
    expect(second.error.statusCode).toBe(409);
    expect(second.error.code).toBe("DOCUMENT_ALREADY_ATTACHED");
    const docs = await EStampDocument.find({ orderId: order._id });
    expect(docs.length).toBe(1);
  });

  it("the model's own unique index (not just the controller pre-check) is the real backstop against duplicates", async () => {
    const { org, order } = await makeIssuedOrder();
    const asset = await FileAsset.create({
      organizationId: org._id,
      ownerUserId: new mongoose.Types.ObjectId(),
      cloudinaryPublicId: "mock/idx-test/1",
      resourceType: "raw",
      fileType: "ESTAMP_DOCUMENT",
      originalFileName: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    });
    await EStampDocument.create({ organizationId: org._id, requestId: order.requestId, orderId: order._id, fileAssetId: asset._id });
    await expect(
      EStampDocument.create({ organizationId: org._id, requestId: order.requestId, orderId: order._id, fileAssetId: asset._id })
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("attaching to a nonexistent/wrong-org order is rejected as 404 (existence hidden)", async () => {
    const { order } = await makeIssuedOrder();
    const otherOrg = await makeOrg();
    const req = masterReq({ body: { organizationId: otherOrg._id.toString(), orderId: order._id.toString(), fileType: "ESTAMP_DOCUMENT" }, file: pdfFile() });
    const { error } = await runController(fileController.uploadFile, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });

  it("attaching to a nonexistent order id is rejected as 404", async () => {
    const org = await makeOrg();
    const req = masterReq({ body: { organizationId: org._id.toString(), orderId: new mongoose.Types.ObjectId().toString(), fileType: "ESTAMP_DOCUMENT" }, file: pdfFile() });
    const { error } = await runController(fileController.uploadFile, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });

  it("attaching to an order that is not yet ISSUED is rejected", async () => {
    const org = await makeOrg();
    await Wallet.create({ organizationId: org._id, balance: 100000 });
    const article = await Article.create({ stateCode: "KA", articleCode: `NI-${new mongoose.Types.ObjectId()}`, title: "Not issued", createdBy: new mongoose.Types.ObjectId(), currentVersion: 1 });
    await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 100 }, createdBy: new mongoose.Types.ObjectId() });
    const { order } = await EStampRequestService.createRequest({
      organizationId: org._id,
      createdBy: new mongoose.Types.ObjectId(),
      stateCode: "KA",
      articleId: article._id.toString(),
      firstParty: "Alice",
      secondParty: "Bob",
      descriptionOfDocument: "Not issued test",
      considerationPrice: 0,
      stampDutyPaidBy: "Alice",
      numberOfEStamps: 1,
    });
    const { error } = await attach(org, order);
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe("NOT_ISSUED");
    const doc = await EStampDocument.findOne({ orderId: order._id });
    expect(doc).toBeNull();
  });

  it("issued-without-document leaves certificateAvailable false and downloadStatus unchanged (no false-positive certificate)", async () => {
    const { org, order } = await makeIssuedOrder();
    expect(order.downloadStatus).toBe("NOT_AVAILABLE");
    const { res, error } = await runController(
      orderController.getOrder,
      masterReq({ params: { id: order._id.toString() } }),
      makeRes()
    );
    expect(error).toBeNull();
    expect(res.body.data.certificateAvailable).toBe(false);
    expect(res.body.data.document).toBeNull();
  });

  it("issued-with-document reports full metadata via getOrder", async () => {
    const { org, order } = await makeIssuedOrder();
    await attach(org, order, { file: pdfFile(Buffer.from("metadata-check-bytes")) });
    const { res, error } = await runController(
      orderController.getOrder,
      masterReq({ params: { id: order._id.toString() } }),
      makeRes()
    );
    expect(error).toBeNull();
    expect(res.body.data.certificateAvailable).toBe(true);
    expect(res.body.data.document).not.toBeNull();
    expect(res.body.data.document.contentType).toBe("application/pdf");
    expect(res.body.data.document.fileSize).toBe(Buffer.from("metadata-check-bytes").length);
    expect(res.body.data.document.filename).toContain("estamp-certificate.pdf");
    expect(res.body.data.document.downloadAvailable).toBe(true);
    // Never leak storage-addressing/credential fields.
    expect(res.body.data.document.cloudinaryPublicId).toBeUndefined();
  });
});

// ---- Download --------------------------------------------------------

describe("Certificate download", () => {
  it("the authorized owner can download and gets {url, filename, contentType, fileSize}", async () => {
    const { org, order } = await makeIssuedOrder();
    await attach(org, order);
    const req = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions: [Permission.ESTAMP_DOWNLOAD] },
      params: { orderId: order._id.toString() },
    });
    const { res, error } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.url).toBeDefined();
    expect(res.body.data.filename).toContain("estamp-certificate.pdf");
    expect(res.body.data.contentType).toBe("application/pdf");
    expect(typeof res.body.data.fileSize).toBe("number");
  });

  it("download by a different organization is rejected as 404 (existence hidden, not 403)", async () => {
    const { org, order } = await makeIssuedOrder();
    await attach(org, order);
    const otherOrg = await makeOrg();
    const req = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: otherOrg._id.toString(), permissions: [Permission.ESTAMP_DOWNLOAD] },
      params: { orderId: order._id.toString() },
    });
    const { error } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });

  it("download of a nonexistent order/document is rejected cleanly (404)", async () => {
    const req = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: new mongoose.Types.ObjectId().toString(), permissions: [Permission.ESTAMP_DOWNLOAD] },
      params: { orderId: new mongoose.Types.ObjectId().toString() },
    });
    const { error } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });

  it("download before a document is attached is rejected cleanly (404), even for the owning organization", async () => {
    const { org, order } = await makeIssuedOrder();
    const req = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions: [Permission.ESTAMP_DOWNLOAD] },
      params: { orderId: order._id.toString() },
    });
    const { error } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });

  it("a sanitized filename never contains a path-traversal sequence, even with adversarial orderNumber input", async () => {
    const { org, order } = await makeIssuedOrder();
    await attach(org, order);
    await EStampOrder.updateOne({ _id: order._id }, { orderNumber: "../../../etc/passwd" });
    const req = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions: [Permission.ESTAMP_DOWNLOAD] },
      params: { orderId: order._id.toString() },
    });
    const { res, error } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.filename).not.toContain("..");
    expect(res.body.data.filename).not.toContain("/");
    expect(res.body.data.filename).not.toContain("\\");
  });
});

// ---- Checksum integrity ------------------------------------------------

describe("Checksum integrity", () => {
  it("is computed from the real bytes: two different buffers get two different checksums", async () => {
    const org = await makeOrg();
    const assetA = await FileService.upload({
      organizationId: org._id,
      ownerUserId: new mongoose.Types.ObjectId(),
      fileBuffer: Buffer.from("content-A"),
      originalFileName: "a.pdf",
      mimeType: "application/pdf",
      fileType: "OTHER",
    });
    const assetB = await FileService.upload({
      organizationId: org._id,
      ownerUserId: new mongoose.Types.ObjectId(),
      fileBuffer: Buffer.from("content-B"),
      originalFileName: "b.pdf",
      mimeType: "application/pdf",
      fileType: "OTHER",
    });
    expect(assetA.checksumSha256).toBeDefined();
    expect(assetB.checksumSha256).toBeDefined();
    expect(assetA.checksumSha256).not.toBe(assetB.checksumSha256);
  });

  it("the exact same bytes attached to two DIFFERENT orders produce the same checksum both times", async () => {
    const bytes = Buffer.from("identical-certificate-bytes");
    const { org: orgA, order: orderA } = await makeIssuedOrder();
    const { org: orgB, order: orderB } = await makeIssuedOrder();
    await attach(orgA, orderA, { file: pdfFile(bytes) });
    await attach(orgB, orderB, { file: pdfFile(bytes) });
    const docA = await EStampDocument.findOne({ orderId: orderA._id });
    const docB = await EStampDocument.findOne({ orderId: orderB._id });
    const assetA = await FileAsset.findById(docA.fileAssetId);
    const assetB = await FileAsset.findById(docB.fileAssetId);
    expect(assetA.checksumSha256).toBe(assetB.checksumSha256);
  });
});

// ---- Permissions --------------------------------------------------------

describe("Permissions", () => {
  it("Master Admin can attach and download", async () => {
    const { org, order } = await makeIssuedOrder();
    const { error } = await attach(org, order);
    expect(error).toBeNull();
    const req = masterReq({ params: { orderId: order._id.toString() } });
    const { error: dlError } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(dlError).toBeNull();
  });

  it("an Assistant Master Admin explicitly granted ORDER_MANAGE can attach", async () => {
    const { org, order } = await makeIssuedOrder();
    const assistant = { id: new mongoose.Types.ObjectId().toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [Permission.ORDER_MANAGE] };
    const { error } = await attach(org, order, { actor: assistant });
    expect(error).toBeNull();
  });

  it("an Assistant Master Admin WITHOUT ORDER_MANAGE is rejected (403) when attaching", async () => {
    const { org, order } = await makeIssuedOrder();
    const assistant = { id: new mongoose.Types.ObjectId().toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [] };
    const { error } = await attach(org, order, { actor: assistant });
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
  });

  it("route-level ESTAMP_DOWNLOAD permission gate matches the existing permission model for client roles", async () => {
    // SUPER_ADMIN/ADMIN/USER all default-include ESTAMP_DOWNLOAD.
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.USER]) {
      const req = makeReq({ user: { id: "x", role, organizationId: new mongoose.Types.ObjectId().toString(), permissions: [Permission.ESTAMP_DOWNLOAD] } });
      const { threw } = await runMiddleware(requirePermission(Permission.ESTAMP_DOWNLOAD), req, makeRes());
      expect(threw).toBeNull();
    }
  });

  it("a client role missing ESTAMP_DOWNLOAD is rejected at the route gate", async () => {
    const req = makeReq({ user: { id: "x", role: Role.USER, organizationId: new mongoose.Types.ObjectId().toString(), permissions: [] } });
    const { threw } = await runMiddleware(requirePermission(Permission.ESTAMP_DOWNLOAD), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("attaching without ORDER_MANAGE is rejected even for otherwise-privileged client roles", async () => {
    const { org, order } = await makeIssuedOrder();
    const clientActor = { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions: [Permission.ESTAMP_DOWNLOAD, Permission.ORDER_VIEW] };
    const req = makeReq({ user: clientActor, body: { orderId: order._id.toString(), fileType: "ESTAMP_DOCUMENT" }, file: pdfFile() });
    const { error } = await runController(fileController.uploadFile, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
  });
});

// ---- Audit ---------------------------------------------------------------

describe("Audit coverage", () => {
  it("ESTAMP_DOWNLOADED is recorded with the correct actor/org/entity, and no sensitive data ever lands in AuditLog", async () => {
    const { org, order } = await makeIssuedOrder();
    await attach(org, order);
    const actorId = new mongoose.Types.ObjectId().toString();
    const req = makeReq({
      user: { id: actorId, role: Role.SUPER_ADMIN, organizationId: org._id.toString(), permissions: [Permission.ESTAMP_DOWNLOAD] },
      params: { orderId: order._id.toString() },
    });
    const { res, error } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(error).toBeNull();

    const auditEntry = await AuditLog.findOne({ actorId, action: AuditAction.ESTAMP_DOWNLOADED });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.organizationId.toString()).toBe(org._id.toString());

    const serialized = JSON.stringify(auditEntry.toObject());
    expect(serialized).not.toContain(res.body.data.url);
    expect(serialized.toLowerCase()).not.toContain("cloudinary");
  });
});

// ---- Notifications --------------------------------------------------------

describe("Notifications", () => {
  it("certificate-available fires exactly once even when two near-simultaneous attach attempts race", async () => {
    const { org, order, requester } = await makeIssuedOrder();
    const [r1, r2] = await Promise.all([attach(org, order), attach(org, order, { file: pdfFile(Buffer.from("race-2")) })]);
    const results = [r1, r2];
    const successes = results.filter((r) => r.error === null);
    const conflicts = results.filter((r) => r.error !== null);
    // Exactly one attacher wins; the loser gets a clean conflict, never a
    // second document.
    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].error.statusCode).toBe(409);
    const docs = await EStampDocument.find({ orderId: order._id });
    expect(docs.length).toBe(1);
    const notifications = await Notification.find({ recipientId: requester._id.toString(), eventKey: `estamp-order:${order._id.toString()}:certificate_available` });
    expect(notifications.length).toBe(1);
  });

  it("an Assistant Master Admin's download no longer emails themselves, but the in-app Master Admin fan-out still fires", async () => {
    const master = await User.create({ name: "Master", email: `m-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null, isActive: true });
    const { org, order } = await makeIssuedOrder();
    await attach(org, order);
    const assistant = await User.create({ name: "Assistant", email: `a-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null });
    const req = makeReq({
      user: { id: assistant._id.toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [Permission.ESTAMP_DOWNLOAD] },
      params: { orderId: order._id.toString() },
    });
    const { error } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(error).toBeNull();

    const masterNotification = await Notification.findOne({ recipientId: master._id, type: "ASSISTANT_ADMIN_ACTIVITY", relatedActorId: assistant._id.toString() });
    expect(masterNotification).not.toBeNull();

    // The stray self-email bug: previously EmailService.sendEStampDownloadNotification
    // was called with the ASSISTANT's own address. Confirm no email was ever
    // logged to the assistant.
    const emailToAssistant = await EmailLog.findOne({ to: assistant.email });
    expect(emailToAssistant).toBeNull();
  });

  it("repeated downloads by the same Assistant fire the in-app oversight notification every time (deliberate, matches modifyRequest's convention)", async () => {
    const master = await User.create({ name: "Master2", email: `m2-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN, organizationId: null, isActive: true });
    const { org, order } = await makeIssuedOrder();
    await attach(org, order);
    const assistantId = new mongoose.Types.ObjectId().toString();
    const req = () =>
      makeReq({
        user: { id: assistantId, role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: [Permission.ESTAMP_DOWNLOAD] },
        params: { orderId: order._id.toString() },
      });
    await runController(fileController.downloadEStamp, req(), makeRes());
    await runController(fileController.downloadEStamp, req(), makeRes());
    const notifications = await Notification.find({ recipientId: master._id, relatedActorId: assistantId, type: "ASSISTANT_ADMIN_ACTIVITY" });
    expect(notifications.length).toBe(2);
  });
});

// ---- Tenant isolation -------------------------------------------------

describe("Tenant isolation", () => {
  it("org A cannot attach to org B's order by forging orderId under org A's own organizationId", async () => {
    const { org: orgA } = await makeIssuedOrder();
    const { order: orderB } = await makeIssuedOrder();
    const req = masterReq({ body: { organizationId: orgA._id.toString(), orderId: orderB._id.toString(), fileType: "ESTAMP_DOCUMENT" }, file: pdfFile() });
    const { error } = await runController(fileController.uploadFile, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });

  it("org A cannot download org B's document via a forged order id", async () => {
    const { org: orgB, order: orderB } = await makeIssuedOrder();
    await attach(orgB, orderB);
    const orgA = await makeOrg();
    const req = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.SUPER_ADMIN, organizationId: orgA._id.toString(), permissions: [Permission.ESTAMP_DOWNLOAD] },
      params: { orderId: orderB._id.toString() },
    });
    const { error } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });
});

// ---- Empty / negative cases -----------------------------------------

describe("Empty / negative cases", () => {
  it("uploading with no file at all is rejected cleanly (400)", async () => {
    const req = masterReq({ body: { organizationId: new mongoose.Types.ObjectId().toString() } });
    const { error } = await runController(fileController.uploadFile, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(400);
  });

  it("downloading for an order with no document and no organization match still fails cleanly (404, never 500)", async () => {
    const req = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.USER, organizationId: new mongoose.Types.ObjectId().toString(), permissions: [Permission.ESTAMP_DOWNLOAD] },
      params: { orderId: new mongoose.Types.ObjectId().toString() },
    });
    const { error } = await runController(fileController.downloadEStamp, req, makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });
});
