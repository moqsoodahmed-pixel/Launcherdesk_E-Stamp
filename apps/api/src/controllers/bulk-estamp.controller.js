"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadTemplate = exports.cancelBatch = exports.confirmBatch = exports.getBatchPreview = exports.getBatchDetail = exports.listBatches = exports.uploadBatch = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const ApiError_1 = require("../utils/ApiError");
const bulk_estamp_service_1 = require("../services/bulk-estamp.service");
const shared_1 = require("@launcherdesk/shared");
const ExcelJS = require("exceljs");
const models_1 = require("../models");
const indianStates_1 = require("../utils/indianStates");
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
// Human-facing template headers. matchHeaders() in bulk-estamp.service.js
// recognizes these (and the original canonical field names, for backward
// compatibility with any template already in the wild) via FIELD_ALIASES.
const TEMPLATE_COLUMNS = [
    { header: "State", field: "stateCode", width: 28 },
    { header: "Article", field: "articleId", width: 48 },
    { header: "First Party", field: "firstParty", width: 20 },
    { header: "Second Party", field: "secondParty", width: 20 },
    { header: "Description of Document", field: "descriptionOfDocument", width: 30 },
    { header: "Property Description", field: "propertyDescription", width: 30 },
    { header: "Consideration Price", field: "considerationPrice", width: 20 },
    { header: "Stamp Duty Paid By", field: "stampDutyPaidBy", width: 20 },
    { header: "Number of E-Stamps", field: "numberOfEStamps", width: 18 },
];
// Builds a valid Excel defined-name token from a state code - letters/
// digits/underscore only, and must not start with a digit (Excel's naming
// rule), so "Andaman and Nicobar Islands" (code AN) becomes ART_AN.
function definedNameForStateCode(stateCode) {
    return `ART_${String(stateCode).toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}
function describeCalculationRule(rule) {
    if (!rule)
        return "";
    switch (rule.type) {
        case "FIXED":
            return `Fixed: Rs.${rule.fixedAmount ?? 0}`;
        case "PERCENTAGE":
            return `${rule.percentage ?? 0}% of consideration price`;
        case "SLAB":
            return "Slab-based (see official rule)";
        default:
            return rule.type || "";
    }
}
// Generates the bulk-upload .xlsx template from the REAL article catalog
// (no invented states/articles) - a "Template" sheet with a State dropdown
// and a dependent Article dropdown filtered to that state's real articles,
// plus an "Article Reference" sheet listing every article's full code,
// title and calculation rule so a filler can look up exactly what each
// option means before choosing it.
exports.downloadTemplate = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const articles = await models_1.Article.find({ isActive: true }).sort({ stateCode: 1, articleCode: 1 }).lean();
    const articleIds = articles.map((a) => a._id);
    const versions = articleIds.length
        ? await models_1.ArticleVersion.find({ articleId: { $in: articleIds }, effectiveFrom: { $lte: new Date() } })
            .sort({ effectiveFrom: -1 })
            .lean()
        : [];
    const latestVersionByArticle = new Map();
    for (const v of versions) {
        const key = v.articleId.toString();
        if (!latestVersionByArticle.has(key))
            latestVersionByArticle.set(key, v);
    }
    const articlesByState = new Map();
    for (const article of articles) {
        const code = article.stateCode.toUpperCase();
        if (!articlesByState.has(code))
            articlesByState.set(code, []);
        articlesByState.get(code).push(article);
    }
    const stateCodes = Array.from(articlesByState.keys()).sort((a, b) => (0, indianStates_1.stateNameForCode)(a).localeCompare((0, indianStates_1.stateNameForCode)(b)));
    const workbook = new ExcelJS.Workbook();
    // "ArticleLists" holds one column per state - the source range each
    // state's dependent dropdown pulls from. Hidden: it's a lookup table,
    // not something a filler needs to see directly.
    const listSheet = workbook.addWorksheet("ArticleLists", { state: "veryHidden" });
    stateCodes.forEach((stateCode, colIdx) => {
        const col = colIdx + 1;
        const articlesForState = articlesByState.get(stateCode);
        listSheet.getCell(1, col).value = (0, indianStates_1.stateNameForCode)(stateCode);
        articlesForState.forEach((article, rowIdx) => {
            listSheet.getCell(rowIdx + 2, col).value = `${article.articleCode} - ${article.title}`;
        });
        const colLetter = listSheet.getColumn(col).letter;
        workbook.definedNames.add(`ArticleLists!$${colLetter}$2:$${colLetter}$${articlesForState.length + 1}`, definedNameForStateCode(stateCode));
    });
    // "Template" - the sheet a user actually fills in.
    const templateSheet = workbook.addWorksheet("Template");
    templateSheet.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.field, width: c.width }));
    const exampleArticle = articles[0];
    templateSheet.addRow({
        stateCode: exampleArticle ? (0, indianStates_1.stateNameForCode)(exampleArticle.stateCode) : "",
        articleId: exampleArticle ? `${exampleArticle.articleCode} - ${exampleArticle.title}` : "",
        firstParty: "Alice",
        secondParty: "Bob",
        descriptionOfDocument: "Sale agreement",
        propertyDescription: "Flat No. 101, Example Apartments",
        considerationPrice: 1000000,
        stampDutyPaidBy: "Alice",
        numberOfEStamps: 1,
    });
    const LAST_ROW = 200; // generous room to fill in beyond the example row
    const stateFullNames = stateCodes.map((c) => (0, indianStates_1.stateNameForCode)(c));
    for (let row = 2; row <= LAST_ROW; row += 1) {
        templateSheet.getCell(`A${row}`).dataValidation = {
            type: "list",
            allowBlank: true,
            formulae: [`"${stateFullNames.join(",")}"`],
            showErrorMessage: true,
            errorTitle: "Invalid state",
            error: "Please choose a state from the dropdown list.",
        };
        // Dependent dropdown: looks up the ArticleLists named range matching
        // whichever state was chosen in column A of this same row. If the
        // state cell is blank or unrecognized, Excel just shows no options
        // yet - never a hard error while the row is still being filled in.
        templateSheet.getCell(`B${row}`).dataValidation = {
            type: "list",
            allowBlank: true,
            formulae: [`INDIRECT("ART_"&SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(UPPER($A${row})," ","_"),"-","_"),"'","_"),"&","_"),",","_"))`],
            showErrorMessage: false,
        };
    }
    // "Article Reference" - full, human-readable detail per article (state,
    // code, title, description, calculation rule) so a filler can see
    // exactly what each dropdown option means without guessing.
    const refSheet = workbook.addWorksheet("Article Reference");
    refSheet.columns = [
        { header: "State", key: "state", width: 28 },
        { header: "Article Code", key: "code", width: 16 },
        { header: "Article Title", key: "title", width: 40 },
        { header: "Description", key: "description", width: 50 },
        { header: "Stamp Duty Rule", key: "rule", width: 28 },
    ];
    for (const article of articles) {
        const version = latestVersionByArticle.get(article._id.toString());
        refSheet.addRow({
            state: (0, indianStates_1.stateNameForCode)(article.stateCode),
            code: article.articleCode,
            title: article.title,
            description: article.description || "",
            rule: describeCalculationRule(version?.calculationRule),
        });
    }
    refSheet.getRow(1).font = { bold: true };
    templateSheet.getRow(1).font = { bold: true };
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=bulk-estamp-template.xlsx");
    await workbook.xlsx.write(res);
    return res.end();
});
