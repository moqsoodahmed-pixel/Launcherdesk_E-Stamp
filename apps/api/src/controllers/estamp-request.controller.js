"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelRequest = exports.modifyRequest = exports.getRequest = exports.listRequests = exports.previewCalculation = exports.createRequest = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const models_1 = require("../models");
const estamp_request_service_1 = require("../services/estamp-request.service");
const calculation_service_1 = require("../services/calculation.service");
const ApiError_1 = require("../utils/ApiError");
const email_service_1 = require("../services/email.service");
const shared_1 = require("@launcherdesk/shared");
const mongoose_1 = require("mongoose");
function resolveOrgId(req) {
    const isInternal = req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
    return isInternal ? req.query.organizationId || req.body.organizationId : req.user.organizationId;
}
// Same escape used by order.controller.js/payment.controller.js's search -
// without it, a search term containing a regex metacharacter (e.g. an
// unmatched paren) throws a 500 instead of matching it literally.
function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
exports.createRequest = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    // organizationId is NEVER taken from the request body - always the
    // authenticated tenant actor's own organization.
    const organizationId = req.user.organizationId;
    const { request, order } = await estamp_request_service_1.EStampRequestService.createRequest({
        ...req.body,
        organizationId,
        createdBy: req.user.id,
        actorRole: req.user.role,
        req,
    });
    const user = await models_1.User.findById(req.user.id);
    if (user)
        await email_service_1.EmailService.sendRequestCreatedEmail(user.email, request.requestNumber);
    return (0, ApiResponse_1.created)(res, { request, order });
});
// Informational only - runs the SAME CalculationService the real request
// creation flow uses, but never creates a request, debits the wallet, or
// touches an order. The final POST / recalculates independently; this
// preview amount is never trusted or reused as-is at creation time.
exports.previewCalculation = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await calculation_service_1.CalculationService.calculate({
        stateCode: req.body.stateCode,
        articleId: req.body.articleId,
        considerationPrice: req.body.considerationPrice,
        numberOfEStamps: req.body.numberOfEStamps,
    });
    return (0, ApiResponse_1.ok)(res, result);
});
exports.listRequests = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveOrgId(req);
    const { status, stateCode, articleId, search, dateFrom, dateTo, page = "1", limit = "20" } = req.query;
    const filter = organizationId ? { organizationId } : {};
    if (status) {
        if (!Object.values(shared_1.EStampRequestStatus).includes(status))
            throw ApiError_1.ApiError.badRequest("Invalid status filter", "INVALID_STATUS");
        filter.status = status;
    }
    // Phase 22 - list-page filters (state/article/request#/date-range),
    // mirroring order.controller.js's buildOrderFilter's exact same
    // validation pattern (explicit whitelist, no free-form Mongo operators
    // ever accepted from query params).
    if (stateCode)
        filter.stateCode = String(stateCode).toUpperCase();
    if (articleId) {
        if (!mongoose_1.Types.ObjectId.isValid(articleId))
            throw ApiError_1.ApiError.badRequest("Invalid articleId", "INVALID_ARTICLE_ID");
        filter.articleId = articleId;
    }
    if (search)
        filter.requestNumber = { $regex: escapeRegex(search), $options: "i" };
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
    // Non-admin USER role only ever sees their own requests.
    if (req.user.role === shared_1.Role.USER)
        filter.createdBy = req.user.id;
    // Phase 19 - cap client-supplied `limit` (same Math.min pattern already
    // used by order/payment/user/notification/audit controllers) so an
    // unbounded `?limit=` cannot force one query to load an arbitrarily large
    // result set.
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const items = await models_1.EStampRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum);
    const total = await models_1.EStampRequest.countDocuments(filter);
    // Phase 12: attach server-computed, informational-only window fields
    // (canModify/canCancel/windowExpiresAt/windowRemainingSeconds) so the
    // frontend can stop re-deriving them from its own client-side timer.
    // Never a gate for the mutation endpoints themselves (see
    // EStampRequestService.modifyRequest/cancelRequest's atomic conditional
    // updates) - purely display data computed fresh at request time.
    const now = new Date();
    const itemsWithWindowInfo = items.map((item) => ({
        ...item.toObject(),
        ...(0, estamp_request_service_1.computeWindowInfo)(item, now),
    }));
    return (0, ApiResponse_1.ok)(res, { items: itemsWithWindowInfo, total });
});
exports.getRequest = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const isInternal = req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
    const filter = { _id: req.params.id };
    if (!isInternal)
        filter.organizationId = req.user.organizationId;
    const request = await models_1.EStampRequest.findOne(filter);
    if (!request)
        throw ApiError_1.ApiError.notFound("Request not found");
    return (0, ApiResponse_1.ok)(res, { ...request.toObject(), ...(0, estamp_request_service_1.computeWindowInfo)(request) });
});
exports.modifyRequest = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveOrgId(req);
    const request = await estamp_request_service_1.EStampRequestService.modifyRequest(req.params.id, organizationId, req.user.id, req.user.role, req.body, req);
    return (0, ApiResponse_1.ok)(res, request);
});
exports.cancelRequest = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveOrgId(req);
    const request = await estamp_request_service_1.EStampRequestService.cancelRequest(req.params.id, organizationId, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, request);
});
