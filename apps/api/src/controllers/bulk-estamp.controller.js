"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadTemplate = exports.cancelBatch = exports.confirmBatch = exports.getBatchPreview = exports.getBatchDetail = exports.listBatches = exports.uploadBatch = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const ApiError_1 = require("../utils/ApiError");
const bulk_estamp_service_1 = require("../services/bulk-estamp.service");
const shared_1 = require("@launcherdesk/shared");
function isInternalActor(req) {
    return req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
// Action routes (upload/confirm/cancel): organizationId is ALWAYS the
// authenticated tenant actor's own organization. Internal roles act on
// behalf of a client org and must pass it explicitly - same
// resolveUploadOrgId pattern as file.controller.js, never invented anew.
function resolveActionOrgId(req) {
    if (isInternalActor(req)) {
        const organizationId = req.body.organizationId;
        if (!organizationId)
            throw ApiError_1.ApiError.badRequest("organizationId is required when acting as an internal admin");
        return organizationId;
    }
    return req.user.organizationId;
}
// View routes (list/detail/preview): internal roles may optionally scope to
// one organization via query; omitting it lists/searches across all orgs
// (same convention as order.controller.js's resolveOrgId).
function resolveViewOrgId(req) {
    return isInternalActor(req) ? req.query.organizationId : req.user.organizationId;
}
exports.uploadBatch = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const file = req.file;
    if (!file)
        throw ApiError_1.ApiError.badRequest("No file provided");
    const organizationId = resolveActionOrgId(req);
    const { batch, items } = await bulk_estamp_service_1.BulkEStampService.uploadBatch({
        organizationId,
        createdBy: req.user.id,
        actorRole: req.user.role,
        fileBuffer: file.buffer,
        mimeType: file.mimetype,
        originalFileName: file.originalname,
        req,
    });
    return (0, ApiResponse_1.created)(res, { batch, itemsCreated: items });
});
exports.listBatches = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveViewOrgId(req);
    const { page, limit, status } = req.query;
    const result = await bulk_estamp_service_1.BulkEStampService.listBatches(organizationId, req.user.role, { page, limit, status });
    return (0, ApiResponse_1.ok)(res, result);
});
exports.getBatchDetail = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveViewOrgId(req);
    const { page, limit } = req.query;
    const result = await bulk_estamp_service_1.BulkEStampService.getBatchDetail(req.params.batchId, organizationId, req.user.role, { page, limit });
    return (0, ApiResponse_1.ok)(res, result);
});
exports.getBatchPreview = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveViewOrgId(req);
    const { page, limit } = req.query;
    const result = await bulk_estamp_service_1.BulkEStampService.getBatchPreview(req.params.batchId, organizationId, req.user.role, { page, limit });
    return (0, ApiResponse_1.ok)(res, result);
});
exports.confirmBatch = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveActionOrgId(req);
    const result = await bulk_estamp_service_1.BulkEStampService.confirmBatch(req.params.batchId, organizationId, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, result);
});
exports.cancelBatch = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveActionOrgId(req);
    const batch = await bulk_estamp_service_1.BulkEStampService.cancelBatch(req.params.batchId, organizationId, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, batch);
});
// Plain-text CSV template matching createEStampRequestSchema's field names
// (minus idempotencyKey, which bulk always generates itself) - no
// export/report feature, just a static download to seed a correctly-headed
// spreadsheet. Not gated behind any calculation/provider logic.
const TEMPLATE_HEADERS = [
    "stateCode",
    "articleId",
    "firstParty",
    "secondParty",
    "descriptionOfDocument",
    "propertyDescription",
    "considerationPrice",
    "stampDutyPaidBy",
    "numberOfEStamps",
];
const TEMPLATE_EXAMPLE_ROW = [
    "KA",
    "<articleId>",
    "Alice",
    "Bob",
    "Sale agreement",
    "Flat No. 101, Example Apartments",
    "1000000",
    "Alice",
    "1",
];
exports.downloadTemplate = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const csv = `${TEMPLATE_HEADERS.join(",")}\n${TEMPLATE_EXAMPLE_ROW.join(",")}\n`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=bulk-estamp-template.csv");
    return res.status(200).send(csv);
});
