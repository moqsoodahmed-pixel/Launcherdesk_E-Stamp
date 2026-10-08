"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerWebhook = exports.retryOrder = exports.syncOrder = exports.processOrder = exports.getOrderSummary = exports.getOrder = exports.listOrders = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const mongoose_1 = require("mongoose");
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const estamp_request_service_1 = require("../services/estamp-request.service");
const audit_service_1 = require("../services/audit.service");
const shared_1 = require("@launcherdesk/shared");
const sanitizeFilename_1 = require("../utils/sanitizeFilename");
function isInternalActor(req) {
    return req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
// organizationId is NEVER trusted from a tenant actor's own request - only
// an internal (already permission-gated) actor may explicitly scope to a
// specific organization; a tenant actor always gets their own, full stop.
function resolveOrgId(req) {
    return isInternalActor(req) ? req.query.organizationId : req.user.organizationId;
}
const SORT_FIELDS = ["createdAt", "updatedAt", "status", "eStampStatus", "amount"];
// Explicit whitelist - never pass a client-supplied filter object directly
// into MongoDB. Every field below is validated/typed before being placed
// into the query.
async function buildOrderFilter(req) {
    const organizationId = resolveOrgId(req);
    const { status, eStampStatus, stateCode, articleId, search, dateFrom, dateTo, organizationName } = req.query;
    const filter = {};
    if (organizationId) {
        // Cast explicitly - this filter also feeds an aggregate() pipeline
        // (getOrderSummary), which does NOT apply Mongoose's automatic
        // string->ObjectId query casting the way find()/countDocuments() do.
        if (!mongoose_1.Types.ObjectId.isValid(organizationId))
            throw ApiError_1.ApiError.badRequest("Invalid organizationId", "INVALID_ORGANIZATION_ID");
        filter.organizationId = new mongoose_1.Types.ObjectId(organizationId);
    }
    if (status) {
        if (!Object.values(shared_1.OrderStatus).includes(status))
            throw ApiError_1.ApiError.badRequest("Invalid status filter", "INVALID_STATUS");
        filter.status = status;
    }
    if (eStampStatus) {
        if (!Object.values(shared_1.EStampOrderProcessingStatus).includes(eStampStatus))
            throw ApiError_1.ApiError.badRequest("Invalid eStampStatus filter", "INVALID_STATUS");
        filter.eStampStatus = eStampStatus;
    }
    if (stateCode)
        filter.stateCode = String(stateCode).toUpperCase();
    if (articleId) {
        if (!mongoose_1.Types.ObjectId.isValid(articleId))
            throw ApiError_1.ApiError.badRequest("Invalid articleId", "INVALID_ARTICLE_ID");
        filter.articleId = new mongoose_1.Types.ObjectId(articleId);
    }
    if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to = dateTo ? new Date(dateTo) : null;
        if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
            throw ApiError_1.ApiError.badRequest("Invalid date range", "INVALID_DATE_RANGE");
        }
        if (from && to && from.getTime() > to.getTime()) {
            throw ApiError_1.ApiError.badRequest("`dateFrom` must not be after `dateTo`", "INVALID_DATE_RANGE");
        }
        filter.createdAt = {};
        if (from)
            filter.createdAt.$gte = from;
        if (to)
            filter.createdAt.$lte = to;
    }
    // Organization name search is Master-Admin/Assistant-only (a tenant
    // actor's organizationId is already fixed above and can't be widened by
    // this) - resolved via a small, indexed lookup rather than an unindexed
    // join, then narrowed to an explicit list of ids. If a specific
    // organizationId was ALSO requested, intersect rather than letting the
    // name filter silently override it.
    if (isInternalActor(req) && organizationName) {
        const matchingOrgs = await models_1.Organization.find({ name: { $regex: escapeRegex(organizationName), $options: "i" } }).select("_id").limit(500);
        const matchingIds = matchingOrgs.map((o) => o._id.toString());
        if (filter.organizationId) {
            filter.organizationId = matchingIds.includes(filter.organizationId.toString()) ? filter.organizationId : { $in: [] };
        }
        else {
            filter.organizationId = { $in: matchingIds };
        }
    }
    if (search) {
        // Only fields actually present on EStampOrder itself - never an
        // unrestricted regex across unrelated collections.
        filter.$or = [
            { orderNumber: { $regex: escapeRegex(search), $options: "i" } },
            { providerReference: { $regex: escapeRegex(search), $options: "i" } },
        ];
    }
    return filter;
}
function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
exports.listOrders = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const filter = await buildOrderFilter(req);
    const { page = "1", limit = "20", sortBy = "createdAt", sortDir = "desc" } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const sortField = SORT_FIELDS.includes(sortBy) ? sortBy : "createdAt";
    const sortOrder = sortDir === "asc" ? 1 : -1;
    const [items, total] = await Promise.all([
        models_1.EStampOrder.find(filter)
            .sort({ [sortField]: sortOrder })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        models_1.EStampOrder.countDocuments(filter),
    ]);
    // Display-only labels, additive to the raw order fields. Request number is
    // looked up for everyone (their own orders' requests only - the orders
    // themselves are already tenant-scoped above); organization name only for
    // internal actors, who are the only ones who see more than one org.
    const requestIds = items.map((o) => o.requestId);
    const orgIds = isInternalActor(req) ? [...new Set(items.map((o) => o.organizationId.toString()))] : [];
    const [requests, orgs] = await Promise.all([
        requestIds.length ? models_1.EStampRequest.find({ _id: { $in: requestIds } }).select("requestNumber") : [],
        orgIds.length ? models_1.Organization.find({ _id: { $in: orgIds } }).select("name") : [],
    ]);
    const requestNumberById = new Map(requests.map((r) => [r._id.toString(), r.requestNumber]));
    const orgNameById = new Map(orgs.map((o) => [o._id.toString(), o.name]));
    const enriched = items.map((o) => {
        const plain = o.toObject();
        plain.requestNumber = requestNumberById.get(o.requestId.toString()) ?? null;
        if (isInternalActor(req))
            plain.organizationName = orgNameById.get(o.organizationId.toString()) ?? null;
        return plain;
    });
    return (0, ApiResponse_1.ok)(res, { items: enriched, total, page: pageNum, limit: limitNum });
});
// Server-authoritative counts by processing status - never derived from a
// paginated page on the frontend. Same tenant/organization scoping as the
// list endpoint (client actors only ever see their own organization).
exports.getOrderSummary = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const filter = await buildOrderFilter(req);
    // Drop pagination-only params; summary always covers the full filtered set.
    const rows = await models_1.EStampOrder.aggregate([
        { $match: filter },
        { $group: { _id: "$eStampStatus", count: { $sum: 1 } } },
    ]);
    const summary = { total: 0, CREATED: 0, SUBMITTING: 0, SUBMITTED: 0, PROCESSING: 0, ISSUED: 0, FAILED: 0 };
    for (const row of rows) {
        if (summary[row._id] !== undefined)
            summary[row._id] = row.count;
        summary.total += row.count;
    }
    return (0, ApiResponse_1.ok)(res, summary);
});
// Server-authoritative view of which operational actions would currently be
// accepted for this actor + order, mirroring (never replacing) the guards in
// EStampRequestService.processOrder/syncEStampOrderStatus. The frontend
// renders these flags instead of re-deriving the state machine itself.
// `retry` is deliberately always false: retryOrder() delegates to
// processOrder(), which for a non-CREATED order without a provider reference
// is a safe no-op (the atomic CREATED->SUBMITTING claim fails), with a
// provider reference is exactly Sync, and for ISSUED/FAILED is an
// idempotent no-op. It therefore never does anything Process/Sync do not,
// and an unconfirmed SUBMITTING order is intentionally never resubmitted.
function computeAvailableActions(req, order, request) {
    const canManage = req.user.permissions.includes(shared_1.Permission.ORDER_MANAGE);
    const status = order.eStampStatus;
    const terminal = status === shared_1.EStampOrderProcessingStatus.ISSUED || status === shared_1.EStampOrderProcessingStatus.FAILED;
    const requestSubmittable = !!request && [shared_1.EStampRequestStatus.LOCKED, shared_1.EStampRequestStatus.PROCESSING].includes(request.status);
    return {
        process: canManage && status === shared_1.EStampOrderProcessingStatus.CREATED && !order.providerReference && requestSubmittable,
        sync: canManage && !!order.providerReference && !terminal,
        retry: false,
    };
}
exports.getOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const order = await models_1.EStampOrder.findById(req.params.id);
    if (!order || (!isInternalActor(req) && order.organizationId.toString() !== req.user.organizationId)) {
        throw ApiError_1.ApiError.notFound("Order not found");
    }
    const [request, document, historyEntries] = await Promise.all([
        models_1.EStampRequest.findById(order.requestId),
        models_1.EStampDocument.findOne({ orderId: order._id }),
        !req.user.permissions.includes(shared_1.Permission.AUDIT_VIEW) ? null : models_1.AuditLog.find({ entityType: "EStampOrder", entityId: order._id.toString() }).sort({ createdAt: 1 }).select("action actorRole metadata createdAt"),
    ]);
    // Only fetched when a document actually exists - never speculatively, and
    // never exposing storage-addressing/credential fields (cloudinaryPublicId
    // etc.) in the response below, only safe descriptive metadata.
    const fileAsset = document ? await models_1.FileAsset.findById(document.fileAssetId) : null;
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            organizationId: order.organizationId.toString(),
            action: shared_1.AuditAction.ORDER_VIEWED,
            entityType: "EStampOrder",
            entityId: order._id.toString(),
            req,
        });
    }
    // A lightweight, read-only operational timeline built entirely from
    // existing order timestamps and audit history - not a second state
    // machine, just a view over data that already exists.
    const timeline = [
        request?.createdAt && { label: "Request created", at: request.createdAt },
        { label: "Order created", at: order.createdAt },
        order.submittedAt && { label: "Submitted to provider", at: order.submittedAt },
        order.lastSyncedAt && { label: "Last status sync", at: order.lastSyncedAt },
        order.issuedAt && { label: "Issued", at: order.issuedAt },
        document && { label: "Certificate document attached", at: document.createdAt },
        order.eStampStatus === shared_1.EStampOrderProcessingStatus.FAILED && { label: "Failed", at: order.updatedAt, reason: order.failureReason },
    ].filter(Boolean);
    return (0, ApiResponse_1.ok)(res, {
        order,
        request: request ? {
            _id: request._id,
            requestNumber: request.requestNumber,
            status: request.status,
            stateCode: request.stateCode,
            articleId: request.articleId,
            createdAt: request.createdAt,
            firstParty: request.firstParty,
            secondParty: request.secondParty,
            descriptionOfDocument: request.descriptionOfDocument,
            considerationPrice: request.considerationPrice,
            stampDutyPaidBy: request.stampDutyPaidBy,
            numberOfEStamps: request.numberOfEStamps,
            calculatedStampDuty: request.calculatedStampDuty,
        } : null,
        // certificateAvailable stays a plain boolean for backward
        // compatibility (existing frontend usage / Phase 13 tests); `document`
        // is the new, additive, richer metadata shape - null whenever no
        // EStampDocument exists yet, deliberately distinct from "not issued"
        // (see order.eStampStatus, checked independently by the frontend).
        certificateAvailable: !!document,
        document: document ? {
            documentId: document._id,
            filename: (0, sanitizeFilename_1.buildCertificateFilename)(order.orderNumber, fileAsset?.mimeType),
            contentType: fileAsset?.mimeType ?? null,
            fileSize: fileAsset?.sizeBytes ?? null,
            createdAt: document.createdAt,
            downloadAvailable: order.downloadStatus === "AVAILABLE" || order.downloadStatus === "DOWNLOADED",
        } : null,
        timeline,
        availableActions: computeAvailableActions(req, order, request),
        // Audit history is only returned to an actor holding AUDIT_VIEW.
        history: historyEntries,
    });
});
// Operational actions below (process/sync/retry) are gated by ORDER_MANAGE
// at the route level - never automatically available merely because a role
// is internal; Master Admin has it via the all-permissions rule, an
// Assistant Master Admin only if explicitly granted. These delegate entirely
// to the existing Phase 7 EStampRequestService - no second processing/retry/
// sync engine is introduced here.
exports.processOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveOrgId(req);
    const result = await estamp_request_service_1.EStampRequestService.processOrder(req.params.id, organizationId, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, result);
});
exports.syncOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveOrgId(req);
    const result = await estamp_request_service_1.EStampRequestService.syncEStampOrderStatus(req.params.id, organizationId, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, result);
});
exports.retryOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveOrgId(req);
    const result = await estamp_request_service_1.EStampRequestService.retryOrder(req.params.id, organizationId, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, result);
});
// E-Stamp provider server-to-server webhook - NOT behind `authenticate`
// (the provider cannot present a LauncherDesk session token). Trust is
// established entirely by the provider's own webhook signature, verified
// inside EStampRequestService.handleProviderWebhook via the provider
// adapter - never by anything in this request body.
exports.providerWebhook = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const signature = req.headers["x-estamp-signature"];
    const result = await estamp_request_service_1.EStampRequestService.handleProviderWebhook(req.rawBody, signature);
    return (0, ApiResponse_1.ok)(res, { received: true, ...result });
});
