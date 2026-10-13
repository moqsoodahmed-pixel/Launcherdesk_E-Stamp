"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteVendor = exports.resetVendorPassword = exports.getMyOrderFile = exports.cannotProcessMyOrder = exports.uploadMyOrder = exports.acceptMyOrder = exports.getMyOrder = exports.getMySummary = exports.listMyOrders = exports.updateVendorStatus = exports.createVendor = exports.listVendors = void 0;
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = require("mongoose");
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const ApiError_1 = require("../utils/ApiError");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const auth_service_1 = require("../services/auth.service");
const audit_service_1 = require("../services/audit.service");
const email_service_1 = require("../services/email.service");
const file_service_1 = require("../services/file.service");
const fulfilment_service_1 = require("../services/fulfilment.service");
const credentialVault_1 = require("../utils/credentialVault");
function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const VENDOR_LIST_FIELDS = "name email phone isActive mustChangePassword lastLoginAt createdAt";
// ---- Master Admin: vendor accounts ----------------------------------------
exports.listVendors = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    // Soft-deleted vendors are gone from every list.
    const filter = { role: shared_1.Role.VENDOR, deletedAt: null };
    if (req.query.status === "active")
        filter.isActive = true;
    else if (req.query.status === "inactive")
        filter.isActive = false;
    if (req.query.search) {
        filter.$or = [
            { name: { $regex: escapeRegex(req.query.search), $options: "i" } },
            { email: { $regex: escapeRegex(req.query.search), $options: "i" } },
        ];
    }
    const vendors = await models_1.User.find(filter).sort({ name: 1 }).limit(500).select(`${VENDOR_LIST_FIELDS} +tempPasswordExpiresAt`);
    // passwordState only - never the password or its expiry.
    const items = vendors.map((v) => {
        const plain = v.toObject();
        delete plain.tempPasswordExpiresAt;
        return { ...plain, passwordState: (0, credentialVault_1.passwordStateOf)(v) };
    });
    return (0, ApiResponse_1.ok)(res, { items, total: items.length });
});
// Same pattern as createAssistantAdmin: the temp password is returned ONCE
// in this response and never emailed - the welcome email only points the
// vendor to "Forgot password".
exports.createVendor = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { name, email, phone } = req.body;
    const existing = await models_1.User.findOne({ email: email.toLowerCase() });
    if (existing)
        throw ApiError_1.ApiError.conflict("A user with this email already exists");
    const tempPassword = crypto_1.default.randomBytes(9).toString("base64url");
    const user = await models_1.User.create({
        name,
        email: email.toLowerCase(),
        phone,
        role: shared_1.Role.VENDOR,
        organizationId: null,
        permissions: [],
        passwordHash: await auth_service_1.AuthService.hashPassword(tempPassword),
        mustChangePassword: true,
        createdBy: req.user.id,
    });
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.USER_CREATED,
        entityType: "User",
        entityId: user._id.toString(),
        metadata: { role: shared_1.Role.VENDOR },
        req,
    });
    await (0, credentialVault_1.storeTemporaryPassword)(user._id, tempPassword);
    await email_service_1.EmailService.sendVendorWelcomeEmail(user.email, user.name, `vendor-welcome:${user._id.toString()}`);
    return (0, ApiResponse_1.created)(res, { user: { ...user.toObject(), passwordHash: undefined }, tempPassword });
});
// A live (not deleted) VENDOR by :id, or 404 - never any other role.
async function findVendor(id) {
    const target = mongoose_1.Types.ObjectId.isValid(id) ? await models_1.User.findOne({ _id: id, role: shared_1.Role.VENDOR, deletedAt: null }) : null;
    if (!target)
        throw ApiError_1.ApiError.notFound("Vendor not found");
    return target;
}
exports.updateVendorStatus = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const target = await findVendor(req.params.id);
    const { isActive } = req.body;
    if (target.isActive !== isActive) {
        target.isActive = isActive;
        // Deactivation ends every live session at once (authenticate also
        // refuses an inactive account on every request).
        if (!isActive)
            target.tokenVersion = (target.tokenVersion || 0) + 1;
        await target.save();
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            action: isActive ? shared_1.AuditAction.USER_MODIFIED : shared_1.AuditAction.USER_DEACTIVATED,
            entityType: "User",
            entityId: target._id.toString(),
            metadata: { role: shared_1.Role.VENDOR, isActive },
            req,
        });
    }
    const user = await models_1.User.findById(target._id).select(VENDOR_LIST_FIELDS);
    return (0, ApiResponse_1.ok)(res, user);
});
// POST /vendors/:id/reset-password - a new temporary password (same
// generator as createVendor), returned ONCE and never logged or emailed.
// Every existing session ends (same helper as the password-reset flow).
exports.resetVendorPassword = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const target = await findVendor(req.params.id);
    const tempPassword = crypto_1.default.randomBytes(9).toString("base64url");
    await models_1.User.updateOne({ _id: target._id }, { $set: { passwordHash: await auth_service_1.AuthService.hashPassword(tempPassword), mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null } });
    await auth_service_1.AuthService.invalidateAllSessions(target._id.toString());
    await (0, credentialVault_1.storeTemporaryPassword)(target._id, tempPassword);
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.PASSWORD_RESET_COMPLETED,
        entityType: "User",
        entityId: target._id.toString(),
        metadata: { role: shared_1.Role.VENDOR, by: "master_admin" },
        req,
    });
    return (0, ApiResponse_1.ok)(res, { tempPassword }, "Temporary password generated");
});
// DELETE /vendors/:id - 409 while orders are with the vendor; hard delete
// when the account was never used; otherwise soft delete (inactive,
// deletedAt, email released, id kept so old orders/uploads/audit resolve).
const OPEN_VENDOR_STATUSES = [shared_1.VendorStatus.SENT, shared_1.VendorStatus.ACCEPTED, shared_1.VendorStatus.UPLOADED, shared_1.VendorStatus.REJECTED];
exports.deleteVendor = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const target = await findVendor(req.params.id);
    const id = target._id;
    const open = await models_1.EStampOrder.countDocuments({ vendorId: id, vendorStatus: { $in: OPEN_VENDOR_STATUSES } });
    if (open > 0) {
        throw ApiError_1.ApiError.conflict(`${open} order${open === 1 ? " is" : "s are"} still with this vendor. Recall or reassign ${open === 1 ? "it" : "them"} first.`, "VENDOR_HAS_OPEN_ORDERS", { openOrders: open });
    }
    // History: any order ever dispatched to or uploaded by them (recall
    // clears vendorId, so dispatch audits and upload entries count too),
    // any file they own, or any audit entry they made.
    const [orders, files, audits] = await Promise.all([
        models_1.EStampOrder.exists({ $or: [{ vendorId: id }, { "vendorUploads.uploadedBy": id }] }),
        models_1.FileAsset.exists({ ownerUserId: id }),
        models_1.AuditLog.exists({ $or: [{ actorId: id }, { "metadata.vendorId": id.toString() }] }),
    ]);
    const hard = !orders && !files && !audits;
    if (hard) {
        await models_1.RefreshToken.deleteMany({ userId: id });
        await models_1.User.deleteOne({ _id: id });
    }
    else {
        await models_1.User.updateOne({ _id: id }, { $set: { isActive: false, deletedAt: new Date(), email: `deleted+${id.toString()}@deleted.invalid` }, $unset: { initialPasswordEnc: "", tempPasswordExpiresAt: "" } });
        await auth_service_1.AuthService.invalidateAllSessions(id.toString());
    }
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.USER_DELETED,
        entityType: "User",
        entityId: id.toString(),
        metadata: { role: shared_1.Role.VENDOR, deleted: hard ? "hard" : "soft" },
        req,
    });
    return (0, ApiResponse_1.ok)(res, { id: id.toString(), deleted: hard ? "hard" : "soft" }, "Vendor deleted");
});
// ---- Vendor: own dispatched orders only -----------------------------------
// Every lookup is scoped to vendorId = req.user.id. Another vendor's order,
// a recalled order and a missing id all answer the same 404.
async function loadMyOrder(req) {
    if (!mongoose_1.Types.ObjectId.isValid(req.params.id))
        throw ApiError_1.ApiError.notFound("Order not found");
    const order = await models_1.EStampOrder.findOne({ _id: req.params.id, vendorId: req.user.id });
    if (!order)
        throw ApiError_1.ApiError.notFound("Order not found");
    return order;
}
// Client documents a vendor may download: the request's own uploads, never
// certificates (ESTAMP_DOCUMENT covers every vendor upload and issued stamp).
function clientDocumentsFilter(order) {
    return { $or: [{ orderId: order._id }, { requestId: order.requestId }], fileType: { $ne: "ESTAMP_DOCUMENT" } };
}
async function batchesForRequests(requestIds) {
    if (!requestIds.length)
        return new Map();
    const items = await models_1.BulkEStampBatchItem.find({ requestId: { $in: requestIds } }).select("requestId batchId");
    const batchIds = [...new Set(items.map((i) => i.batchId.toString()))];
    const batches = batchIds.length ? await models_1.BulkEStampBatch.find({ _id: { $in: batchIds } }).select("batchNumber") : [];
    const numberById = new Map(batches.map((b) => [b._id.toString(), b.batchNumber]));
    return new Map(items.map((i) => [i.requestId.toString(), { batchId: i.batchId.toString(), batchNumber: numberById.get(i.batchId.toString()) || null }]));
}
// The restricted vendor projection. Explicit allowlist: no amount, wallet,
// payment, charge, contact, user or other-organization data ever.
function projectForVendor(order, { request, article, orgName, batch, documents }) {
    return {
        _id: order._id,
        orderNumber: order.orderNumber,
        bulkBatchId: batch?.batchId || null,
        bulkBatchNumber: batch?.batchNumber || null,
        stateCode: order.stateCode,
        articleTitle: article?.title || null,
        firstParty: request?.firstParty ?? null,
        secondParty: request?.secondParty ?? null,
        descriptionOfDocument: request?.descriptionOfDocument ?? null,
        propertyDescription: request?.propertyDescription ?? null,
        considerationPrice: request?.considerationPrice ?? null,
        stampDuty: request?.calculatedStampDuty ?? null,
        numberOfEStamps: request?.numberOfEStamps ?? null,
        organizationName: orgName || null,
        vendorStatus: order.vendorStatus,
        dispatchedAt: order.dispatchedAt || null,
        acceptedAt: order.vendorAcceptedAt || null,
        declined: !!order.vendorDeclined,
        declineReason: order.vendorDeclineReason || null,
        closed: order.eStampStatus === shared_1.EStampOrderProcessingStatus.ISSUED || order.eStampStatus === shared_1.EStampOrderProcessingStatus.FAILED,
        ...(documents ? { documents: documents.map((d) => ({ _id: d._id, originalFileName: d.originalFileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes })) } : {}),
        uploads: (order.vendorUploads || []).map((u) => ({
            _id: u._id,
            stampReference: u.stampReference,
            notes: u.notes || null,
            uploadedAt: u.uploadedAt,
            status: u.status,
            reviewNotes: u.reviewNotes || null,
            reviewedAt: u.reviewedAt || null,
        })),
    };
}
async function loadContext(orders) {
    const requestIds = orders.map((o) => o.requestId);
    const [requests, orgs, articles, batchByRequest] = await Promise.all([
        requestIds.length ? models_1.EStampRequest.find({ _id: { $in: requestIds } }).select("firstParty secondParty descriptionOfDocument propertyDescription considerationPrice calculatedStampDuty numberOfEStamps") : [],
        models_1.Organization.find({ _id: { $in: [...new Set(orders.map((o) => o.organizationId.toString()))] } }).select("name"),
        models_1.Article.find({ _id: { $in: [...new Set(orders.map((o) => o.articleId.toString()))] } }).select("title"),
        batchesForRequests(requestIds),
    ]);
    const byId = (rows) => new Map(rows.map((r) => [r._id.toString(), r]));
    return { requests: byId(requests), orgs: byId(orgs), articles: byId(articles), batchByRequest };
}
function contextFor(order, ctx) {
    return {
        request: ctx.requests.get(order.requestId.toString()),
        article: ctx.articles.get(order.articleId.toString()),
        orgName: ctx.orgs.get(order.organizationId.toString())?.name,
        batch: ctx.batchByRequest.get(order.requestId.toString()),
    };
}
const VENDOR_FILTER_STATUSES = [shared_1.VendorStatus.SENT, shared_1.VendorStatus.ACCEPTED, shared_1.VendorStatus.UPLOADED, shared_1.VendorStatus.REJECTED, shared_1.VendorStatus.APPROVED];
exports.listMyOrders = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const vid = mongoose_1.Types.ObjectId.isValid(req.user.id) ? new mongoose_1.Types.ObjectId(req.user.id) : req.user.id;
    const filter = { vendorId: { $in: [vid, req.user.id] } };
    const { status, batch, search, page = "1", limit = "50" } = req.query;
    if (status) {
        if (!VENDOR_FILTER_STATUSES.includes(status))
            throw ApiError_1.ApiError.badRequest("Invalid status filter", "INVALID_STATUS");
        filter.vendorStatus = status;
    }
    if (batch) {
        if (!mongoose_1.Types.ObjectId.isValid(String(batch)))
            throw ApiError_1.ApiError.badRequest("Invalid batch filter", "INVALID_BATCH");
        const items = await models_1.BulkEStampBatchItem.find({ batchId: batch, requestId: { $exists: true } }).select("requestId");
        filter.requestId = { $in: items.map((i) => i.requestId) };
    }
    if (search)
        filter.orderNumber = { $regex: escapeRegex(search), $options: "i" };
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const [orders, total] = await Promise.all([
        models_1.EStampOrder.find(filter).sort({ dispatchedAt: 1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
        models_1.EStampOrder.countDocuments(filter),
    ]);
    const ctx = await loadContext(orders);
    const items = orders.map((o) => projectForVendor(o, contextFor(o, ctx)));
    return (0, ApiResponse_1.ok)(res, { items, total, page: pageNum, limit: limitNum });
});
exports.getMySummary = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    return (0, ApiResponse_1.ok)(res, await fulfilment_service_1.FulfilmentService.vendorSummary(req.user.id));
});
async function respondWithOrder(res, order, message) {
    const ctx = await loadContext([order]);
    const documents = await models_1.FileAsset.find(clientDocumentsFilter(order)).select("_id originalFileName mimeType sizeBytes");
    return (0, ApiResponse_1.ok)(res, projectForVendor(order, { ...contextFor(order, ctx), documents }), message);
}
exports.getMyOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    return respondWithOrder(res, await loadMyOrder(req));
});
exports.acceptMyOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await fulfilment_service_1.FulfilmentService.vendorAccept(await loadMyOrder(req), req.user, req);
    return respondWithOrder(res, result.order, result.alreadyAccepted ? "Already accepted" : "Order accepted");
});
exports.uploadMyOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await fulfilment_service_1.FulfilmentService.vendorUpload(await loadMyOrder(req), req.user, {
        file: req.file,
        stampReference: req.body?.stampReference,
        notes: req.body?.notes,
    }, req);
    return respondWithOrder(res, result.order, "Certificate uploaded for review");
});
exports.cannotProcessMyOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await fulfilment_service_1.FulfilmentService.vendorCannotProcess(await loadMyOrder(req), req.user, { reason: req.body?.reason }, req);
    return respondWithOrder(res, result.order, "Order handed back to LauncherDesk");
});
// GET /vendor/orders/:id/files/:fileId - a signed URL for one of the
// client's documents on an order dispatched to this vendor (closed orders
// included, so history stays viewable), or for one of this vendor's own
// uploads on it. Anything else is 404.
exports.getMyOrderFile = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const order = await loadMyOrder(req);
    if (!mongoose_1.Types.ObjectId.isValid(req.params.fileId))
        throw ApiError_1.ApiError.notFound("File not found");
    const ownUpload = (order.vendorUploads || []).find((u) => u.fileAssetId.toString() === req.params.fileId && u.uploadedBy?.toString() === req.user.id);
    const asset = ownUpload
        ? await models_1.FileAsset.findById(req.params.fileId)
        : await models_1.FileAsset.findOne({ _id: req.params.fileId, ...clientDocumentsFilter(order) });
    if (!asset)
        throw ApiError_1.ApiError.notFound("File not found");
    const url = await file_service_1.FileService.getSignedUrl(asset.cloudinaryPublicId);
    return (0, ApiResponse_1.ok)(res, { url, filename: asset.originalFileName, contentType: asset.mimeType, fileSize: asset.sizeBytes });
});
