"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vendorApproveMany = exports.vendorRejectOrder = exports.vendorApproveOrder = exports.getVendorUpload = exports.recallOrder = exports.dispatchOrders = exports.getFulfilmentSummary = exports.failOrder = exports.fulfilOrder = exports.startFulfilment = exports.providerWebhook = exports.retryOrder = exports.syncOrder = exports.processOrder = exports.getOrderSummary = exports.getOrder = exports.listOrders = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const dateRange_1 = require("../utils/dateRange");
const ApiResponse_1 = require("../utils/ApiResponse");
const mongoose_1 = require("mongoose");
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const estamp_request_service_1 = require("../services/estamp-request.service");
const audit_service_1 = require("../services/audit.service");
const shared_1 = require("@launcherdesk/shared");
const sanitizeFilename_1 = require("../utils/sanitizeFilename");
const orgAccess_1 = require("../utils/orgAccess");
const fulfilment_service_1 = require("../services/fulfilment.service");
const settings_service_1 = require("../services/settings.service");
const file_service_1 = require("../services/file.service");
// Assistant Master Admins only reach orders of organizations assigned to
// them; same "not found" as a missing order so ids are never confirmed.
async function assertOrderAccess(req, orderId) {
    if (req.user.role !== shared_1.Role.ASSISTANT_MASTER_ADMIN)
        return;
    const order = mongoose_1.Types.ObjectId.isValid(orderId) ? await models_1.EStampOrder.findById(orderId).select("organizationId") : null;
    if (!order || !(await (0, orgAccess_1.canAccessOrganization)(req, order.organizationId))) {
        throw ApiError_1.ApiError.notFound("Order not found");
    }
}
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
    const { status, eStampStatus, stateCode, articleId, search, dateFrom, dateTo, organizationName } = req.query;
    const filter = {};
    // Internal actors: Master Admin sees all (optionally one org); an
    // Assistant only their assigned organizations.
    const organizationId = isInternalActor(req) ? undefined : resolveOrgId(req);
    if (isInternalActor(req))
        await (0, orgAccess_1.scopeOrganizationFilter)(req, filter, req.query.organizationId);
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
        const to = dateTo ? (0, dateRange_1.parseDateTo)(dateTo) : null;
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
            // Intersect with whatever scope is already applied (a single org
            // or an assistant's assigned set) - never widen it.
            const current = filter.organizationId.$in ? filter.organizationId.$in.map(String) : [filter.organizationId.toString()];
            filter.organizationId = { $in: current.filter((id) => matchingIds.includes(id)).map((id) => new mongoose_1.Types.ObjectId(id)) };
        }
        else {
            filter.organizationId = { $in: matchingIds.map((id) => new mongoose_1.Types.ObjectId(id)) };
        }
    }
    // Manual fulfilment queue: orders still to stamp (CREATED/PROCESSING)
    // whose request has left its window and been CHARGED - never in-window,
    // CANCELLED or SHORTFALL. Internal actors only, inside their scope.
    // Vendor review queue: vendor uploads awaiting an assistant's decision
    // (vendorStatus UPLOADED), same scoping. Internal actors only.
    if (req.query.queue !== undefined) {
        if (req.query.queue !== "fulfil" && req.query.queue !== "vendor-review")
            throw ApiError_1.ApiError.badRequest("Invalid queue filter", "INVALID_QUEUE");
        if (!isInternalActor(req))
            throw ApiError_1.ApiError.forbidden("Only LauncherDesk staff can view the fulfilment queue");
        const requestFilter = fulfilment_service_1.FulfilmentService.fulfillableRequestFilter();
        if (filter.organizationId)
            requestFilter.organizationId = filter.organizationId;
        const requests = await models_1.EStampRequest.find(requestFilter).select("_id");
        filter.requestId = { $in: requests.map((r) => r._id) };
        filter.eStampStatus = { $in: fulfilment_service_1.FULFILLABLE_ORDER_STATUSES };
        if (req.query.queue === "vendor-review")
            filter.vendorStatus = shared_1.VendorStatus.UPLOADED;
        else if (req.query.vendorStatus !== undefined) {
            if (!Object.values(shared_1.VendorStatus).includes(req.query.vendorStatus))
                throw ApiError_1.ApiError.badRequest("Invalid vendorStatus filter", "INVALID_STATUS");
            filter.vendorStatus = req.query.vendorStatus === shared_1.VendorStatus.NOT_SENT ? { $in: [shared_1.VendorStatus.NOT_SENT, null] } : req.query.vendorStatus;
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
        requestIds.length ? models_1.EStampRequest.find({ _id: { $in: requestIds } }).select("requestNumber lockedAt") : [],
        orgIds.length ? models_1.Organization.find({ _id: { $in: orgIds } }).select("name") : [],
    ]);
    const requestNumberById = new Map(requests.map((r) => [r._id.toString(), r.requestNumber]));
    const lockedAtById = new Map(requests.map((r) => [r._id.toString(), r.lockedAt]));
    const isQueue = req.query.queue === "fulfil" || req.query.queue === "vendor-review";
    const articles = isQueue && items.length ? await models_1.Article.find({ _id: { $in: [...new Set(items.map((o) => o.articleId.toString()))] } }).select("title articleCode") : [];
    const articleById = new Map(articles.map((a) => [a._id.toString(), a]));
    const orgNameById = new Map(orgs.map((o) => [o._id.toString(), o.name]));
    // Vendor names for internal actors only (clients never see the vendor).
    const vendorIds = isInternalActor(req) ? [...new Set(items.filter((o) => o.vendorId).map((o) => o.vendorId.toString()))] : [];
    const vendors = vendorIds.length ? await models_1.User.find({ _id: { $in: vendorIds }, role: shared_1.Role.VENDOR }).select("name") : [];
    const vendorNameById = new Map(vendors.map((v) => [v._id.toString(), v.name]));
    const enriched = items.map((o) => {
        const plain = isInternalActor(req) ? o.toObject() : (0, models_1.stripVendorFields)(o);
        plain.requestNumber = requestNumberById.get(o.requestId.toString()) ?? null;
        if (isQueue) {
            plain.lockedAt = lockedAtById.get(o.requestId.toString()) ?? null;
            const article = articleById.get(o.articleId.toString());
            plain.articleTitle = article ? article.title : null;
        }
        if (isInternalActor(req)) {
            plain.organizationName = orgNameById.get(o.organizationId.toString()) ?? null;
            plain.vendorName = o.vendorId ? vendorNameById.get(o.vendorId.toString()) ?? null : null;
            const pending = [...(o.vendorUploads || [])].reverse().find((u) => u.status === shared_1.VendorUploadStatus.PENDING);
            plain.pendingVendorUpload = pending ? { _id: pending._id, stampReference: pending.stampReference, notes: pending.notes || null, uploadedAt: pending.uploadedAt } : null;
        }
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
// Plain-language client timeline for manual fulfilment: Submitted, Window
// ends, Queued, In progress, then Issued or Failed. Only real timestamps.
function manualTimeline(order, request, document) {
    const steps = [
        request?.createdAt && { key: "submitted", label: "Submitted", at: request.createdAt },
        request?.modificationDeadline && { key: "window", label: "Window ends", at: request.modificationDeadline, upcoming: request.status === shared_1.EStampRequestStatus.MODIFICATION_WINDOW },
        request?.lockedAt && { key: "queued", label: "Queued", at: request.lockedAt },
        order.startedAt && { key: "in_progress", label: "In progress", at: order.startedAt },
        order.eStampStatus === shared_1.EStampOrderProcessingStatus.ISSUED && { key: "issued", label: "Issued", at: order.issuedAt, downloadable: !!document },
        order.eStampStatus === shared_1.EStampOrderProcessingStatus.FAILED && { key: "failed", label: "Failed", at: order.updatedAt, reason: order.failureReason },
    ];
    return steps.filter(Boolean);
}
// Manual-mode actions: only ORDER_MANAGE internal staff who may act on this
// organization (assigned assistant or Master Admin), and only when the
// request is locked AND charged.
async function computeManualActions(req, order, request) {
    const none = { process: false, sync: false, retry: false, start: false, fulfil: false, fail: false, dispatch: false, recall: false, vendorReview: false };
    const canManage = req.user.permissions.includes(shared_1.Permission.ORDER_MANAGE) && isInternalActor(req);
    if (!canManage || !request || !(await (0, orgAccess_1.canAccessOrganization)(req, order.organizationId)))
        return none;
    const open = fulfilment_service_1.FULFILLABLE_ORDER_STATUSES.includes(order.eStampStatus) && fulfilment_service_1.FULFILLABLE_REQUEST_STATUSES.includes(request.status);
    const charged = request.chargeStatus === "CHARGED";
    return {
        ...none,
        start: open && charged && order.eStampStatus === shared_1.EStampOrderProcessingStatus.CREATED,
        fulfil: open && charged,
        fail: open,
        dispatch: open && charged && fulfilment_service_1.DISPATCHABLE_VENDOR_STATUSES.includes(order.vendorStatus || shared_1.VendorStatus.NOT_SENT),
        recall: open && fulfilment_service_1.RECALLABLE_VENDOR_STATUSES.includes(order.vendorStatus),
        vendorReview: open && charged && order.vendorStatus === shared_1.VendorStatus.UPLOADED,
    };
}
// Client view of the order: no vendor-stage actions or audit entries.
const VENDOR_AUDIT_ACTIONS = [shared_1.AuditAction.ORDER_DISPATCHED, shared_1.AuditAction.ORDER_RECALLED, shared_1.AuditAction.VENDOR_ORDER_ACCEPTED, shared_1.AuditAction.VENDOR_UPLOADED, shared_1.AuditAction.VENDOR_DECLINED, shared_1.AuditAction.VENDOR_UPLOAD_REJECTED, shared_1.AuditAction.VENDOR_UPLOAD_APPROVED];
function clientManualActions(actions) {
    const { dispatch, recall, vendorReview, ...rest } = actions;
    return rest;
}
function clientSafeHistory(entries) {
    if (!entries)
        return entries;
    return entries.filter((e) => !VENDOR_AUDIT_ACTIONS.includes(e.action) && e.actorRole !== shared_1.Role.VENDOR).map((e) => {
        const plain = typeof e.toObject === "function" ? e.toObject() : { ...e };
        if (plain.metadata) {
            const { vendorId, vendorStatus, ...metadata } = plain.metadata;
            if (metadata.stage === "vendor_approval")
                metadata.stage = "manual_fulfilment";
            plain.metadata = metadata;
        }
        return plain;
    });
}
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
    if (!order || (!isInternalActor(req) && order.organizationId.toString() !== req.user.organizationId)
        || (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN && !(await (0, orgAccess_1.canAccessOrganization)(req, order.organizationId)))) {
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
    const article = request ? await models_1.Article.findById(request.articleId).select("title") : null;
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
    const fulfilmentMode = await settings_service_1.SettingsService.getFulfilmentMode();
    const timeline = fulfilmentMode === "manual" ? manualTimeline(order, request, document) : [
        request?.createdAt && { label: "Request created", at: request.createdAt },
        { label: "Order created", at: order.createdAt },
        order.submittedAt && { label: "Submitted to provider", at: order.submittedAt },
        order.lastSyncedAt && { label: "Last status sync", at: order.lastSyncedAt },
        order.issuedAt && { label: "Issued", at: order.issuedAt },
        document && { label: "Certificate document attached", at: document.createdAt },
        order.eStampStatus === shared_1.EStampOrderProcessingStatus.FAILED && { label: "Failed", at: order.updatedAt, reason: order.failureReason },
    ].filter(Boolean);
    const internal = isInternalActor(req);
    const vendor = internal && order.vendorId ? await models_1.User.findById(order.vendorId).select("name email isActive") : null;
    return (0, ApiResponse_1.ok)(res, {
        // Clients never see the vendor stage: vendor fields are stripped and
        // the timeline keeps its existing wording.
        order: internal ? order : (0, models_1.stripVendorFields)(order),
        ...(internal ? { vendor: vendor ? { _id: vendor._id, name: vendor.name, email: vendor.email, isActive: vendor.isActive } : null } : {}),
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
            articleTitle: article ? article.title : null,
            lockedAt: request.lockedAt,
            modificationDeadline: request.modificationDeadline,
            documentsVerified: !!request.documentsVerified,
            verifiedBy: request.verifiedBy,
            verifiedAt: request.verifiedAt,
            verificationNotes: request.verificationNotes,
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
        supportingDocuments: await models_1.FileAsset.find({
            $or: [{ orderId: order._id }, ...(request ? [{ requestId: request._id }] : [])],
            fileType: { $ne: "ESTAMP_DOCUMENT" },
        }).select("_id originalFileName mimeType sizeBytes createdAt fileType"),
        timeline,
        availableActions: internal || fulfilmentMode !== "manual" ? (fulfilmentMode === "manual" ? await computeManualActions(req, order, request) : computeAvailableActions(req, order, request)) : clientManualActions(await computeManualActions(req, order, request)),
        fulfilmentMode,
        // Audit history is only returned to an actor holding AUDIT_VIEW; a
        // client never sees the vendor stage in it.
        history: internal ? historyEntries : clientSafeHistory(historyEntries),
    });
});
// Operational actions below (process/sync/retry) are gated by ORDER_MANAGE
// at the route level - never automatically available merely because a role
// is internal; Master Admin has it via the all-permissions rule, an
// Assistant Master Admin only if explicitly granted. These delegate entirely
// to the existing Phase 7 EStampRequestService - no second processing/retry/
// sync engine is introduced here.
exports.processOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await assertOrderAccess(req, req.params.id);
    const organizationId = resolveOrgId(req);
    const result = await estamp_request_service_1.EStampRequestService.processOrder(req.params.id, organizationId, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, result);
});
exports.syncOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await assertOrderAccess(req, req.params.id);
    const organizationId = resolveOrgId(req);
    const result = await estamp_request_service_1.EStampRequestService.syncEStampOrderStatus(req.params.id, organizationId, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, result);
});
exports.retryOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await assertOrderAccess(req, req.params.id);
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
// ---- Manual fulfilment (ESTAMP_FULFILMENT=manual) ------------------------
// Loads the order + request and enforces the assignment rule: Master Admin
// on any organization, an Assistant only on assigned ones (403 otherwise).
async function loadForFulfilment(req) {
    if (!mongoose_1.Types.ObjectId.isValid(req.params.id))
        throw ApiError_1.ApiError.notFound("Order not found");
    const order = await models_1.EStampOrder.findById(req.params.id);
    if (!order)
        throw ApiError_1.ApiError.notFound("Order not found");
    await (0, orgAccess_1.assertCanActOnOrganization)(req, order.organizationId);
    const request = await models_1.EStampRequest.findById(order.requestId);
    return { order, request };
}
exports.startFulfilment = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { order, request } = await loadForFulfilment(req);
    const result = await fulfilment_service_1.FulfilmentService.start(order, request, req.user, req);
    return (0, ApiResponse_1.ok)(res, result, result.alreadyStarted ? "Already in progress" : "Fulfilment started");
});
exports.fulfilOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { order, request } = await loadForFulfilment(req);
    const result = await fulfilment_service_1.FulfilmentService.fulfil(order, request, req.user, {
        file: req.file,
        stampReference: req.body?.stampReference,
        notes: req.body?.notes,
    }, req);
    return (0, ApiResponse_1.ok)(res, { order: result.order, request: result.request, documentId: result.document._id }, "Order issued");
});
exports.failOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { order, request } = await loadForFulfilment(req);
    const result = await fulfilment_service_1.FulfilmentService.fail(order, request, req.user, { reason: req.body?.reason, refundBalance: req.body?.refundBalance }, req);
    return (0, ApiResponse_1.ok)(res, { order: result.order, request: result.request, refund: result.refund }, "Order marked failed");
});
// ---- Vendor stage (assigned assistant or Master Admin) ---------------------
// POST /orders/dispatch { orderIds, vendorId } - per-order results. An
// assistant asking for any order of an organization not assigned to them
// gets 403 for the whole call (nothing is dispatched).
exports.dispatchOrders = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const orderIds = [...new Set(req.body.orderIds)];
    const vendor = await models_1.User.findOne({ _id: req.body.vendorId, role: shared_1.Role.VENDOR });
    if (!vendor)
        throw ApiError_1.ApiError.notFound("Vendor not found");
    if (!vendor.isActive)
        throw ApiError_1.ApiError.conflict("This vendor account is deactivated", "VENDOR_INACTIVE");
    const orders = await models_1.EStampOrder.find({ _id: { $in: orderIds } });
    for (const order of orders) {
        if (!(await (0, orgAccess_1.canAccessOrganization)(req, order.organizationId))) {
            throw ApiError_1.ApiError.forbidden("This organization is not assigned to you");
        }
    }
    const requests = await models_1.EStampRequest.find({ _id: { $in: orders.map((o) => o.requestId) } });
    const requestById = new Map(requests.map((r) => [r._id.toString(), r]));
    const orderById = new Map(orders.map((o) => [o._id.toString(), o]));
    const results = [];
    for (const id of orderIds) {
        const order = orderById.get(id);
        if (!order) {
            results.push({ orderId: id, ok: false, reason: "NOT_FOUND" });
            continue;
        }
        const result = await fulfilment_service_1.FulfilmentService.dispatchOne(order, requestById.get(order.requestId.toString()), vendor, req.user, req);
        results.push({ ...result, orderNumber: order.orderNumber });
    }
    const newlySent = results.filter((r) => r.ok && !r.alreadySent).map((r) => r.orderId);
    await fulfilment_service_1.FulfilmentService.notifyVendorDispatched(vendor, newlySent);
    const sent = results.filter((r) => r.ok).length;
    return (0, ApiResponse_1.ok)(res, { results, sent, failed: results.length - sent }, `${sent} of ${results.length} sent to ${vendor.name}`);
});
exports.recallOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { order } = await loadForFulfilment(req);
    const result = await fulfilment_service_1.FulfilmentService.recall(order, req.user, req);
    return (0, ApiResponse_1.ok)(res, result, "Order recalled from vendor");
});
// GET /orders/:id/vendor-upload[?uploadId=] - signed URL to view the
// vendor's latest (or a specific) upload. Staff only; never a client route.
exports.getVendorUpload = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { order } = await loadForFulfilment(req);
    const uploads = order.vendorUploads || [];
    const upload = req.query.uploadId ? uploads.find((u) => u._id.toString() === String(req.query.uploadId)) : uploads[uploads.length - 1];
    if (!upload)
        throw ApiError_1.ApiError.notFound("No vendor upload for this order");
    const asset = await models_1.FileAsset.findById(upload.fileAssetId);
    if (!asset)
        throw ApiError_1.ApiError.notFound("Underlying file not found");
    const url = await file_service_1.FileService.getSignedUrl(asset.cloudinaryPublicId);
    return (0, ApiResponse_1.ok)(res, {
        url,
        filename: asset.originalFileName,
        contentType: asset.mimeType,
        fileSize: asset.sizeBytes,
        upload: { _id: upload._id, stampReference: upload.stampReference, notes: upload.notes || null, uploadedAt: upload.uploadedAt, status: upload.status, reviewNotes: upload.reviewNotes || null },
    });
});
exports.vendorApproveOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { order, request } = await loadForFulfilment(req);
    const result = await fulfilment_service_1.FulfilmentService.vendorApprove(order, request, req.user, req);
    return (0, ApiResponse_1.ok)(res, { order: result.order, request: result.request, documentId: result.document?._id ?? null, alreadyApproved: !!result.alreadyApproved }, result.alreadyApproved ? "Already approved" : "Certificate approved and released");
});
exports.vendorRejectOrder = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { order } = await loadForFulfilment(req);
    const result = await fulfilment_service_1.FulfilmentService.vendorReject(order, req.user, { reason: req.body.reason }, req);
    return (0, ApiResponse_1.ok)(res, result, "Sent back to the vendor");
});
// POST /orders/vendor-approve-many { orderIds } - per-order results; an
// order outside the caller's organizations is reported, never approved.
exports.vendorApproveMany = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const results = [];
    for (const id of [...new Set(req.body.orderIds)]) {
        const order = await models_1.EStampOrder.findById(id);
        if (!order || !(await (0, orgAccess_1.canAccessOrganization)(req, order.organizationId))) {
            results.push({ orderId: id, ok: false, reason: "NOT_FOUND" });
            continue;
        }
        try {
            const request = await models_1.EStampRequest.findById(order.requestId);
            const result = await fulfilment_service_1.FulfilmentService.vendorApprove(order, request, req.user, req);
            results.push({ orderId: id, orderNumber: order.orderNumber, ok: true, alreadyApproved: !!result.alreadyApproved });
        }
        catch (err) {
            if (!(err instanceof ApiError_1.ApiError))
                throw err;
            results.push({ orderId: id, orderNumber: order.orderNumber, ok: false, reason: err.code || "ERROR", message: err.message });
        }
    }
    const approved = results.filter((r) => r.ok).length;
    return (0, ApiResponse_1.ok)(res, { results, approved, failed: results.length - approved }, `${approved} of ${results.length} approved`);
});
// GET /orders/fulfilment-summary - queue size, oldest age and (for the
// caller's scope) orders fulfilled today. Internal actors only.
exports.getFulfilmentSummary = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const ids = await (0, orgAccess_1.getAccessibleOrganizationIds)(req);
    const summary = await fulfilment_service_1.FulfilmentService.summary(ids === null ? undefined : { $in: ids });
    return (0, ApiResponse_1.ok)(res, summary);
});
exports.verifyDocuments = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const order = await models_1.EStampOrder.findById(req.params.id);
    if (!order || (!isInternalActor(req) && order.organizationId.toString() !== req.user.organizationId)
        || (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN && !(await (0, orgAccess_1.canAccessOrganization)(req, order.organizationId)))) {
        throw ApiError_1.ApiError.notFound("Order not found");
    }
    const isInternal = isInternalActor(req);
    const organizationId = isInternal ? undefined : order.organizationId;
    const request = await estamp_request_service_1.EStampRequestService.verifyDocuments(
        order.requestId,
        organizationId,
        req.user.id,
        req.user.role,
        req.body?.notes,
        req
    );
    const updatedOrder = await models_1.EStampOrder.findById(order._id);
    return (0, ApiResponse_1.ok)(res, { order: isInternal ? updatedOrder : (0, models_1.stripVendorFields)(updatedOrder), request });
});
