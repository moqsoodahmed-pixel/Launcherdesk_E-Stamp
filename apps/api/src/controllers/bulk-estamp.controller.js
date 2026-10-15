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
const orgAccess_1 = require("../utils/orgAccess");
const mongoose_1 = require("mongoose");
function isInternalActor(req) {
    return req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
// Action routes (upload/confirm/cancel): organizationId is ALWAYS the
// authenticated tenant actor's own organization. Internal roles act on
// behalf of a client org and must pass it explicitly on upload; on confirm/cancel
// the existing batch already belongs to its organization. An Assistant
// Master Admin may only act on an organization assigned to them - a Master
// Admin may act on any organization.
async function resolveActionOrgId(req) {
    if (isInternalActor(req)) {
        const organizationId = req.body?.organizationId || req.query?.organizationId;
        if (!organizationId)
            throw ApiError_1.ApiError.badRequest("organizationId is required when acting as an internal admin");
        await (0, orgAccess_1.assertCanActOnOrganization)(req, organizationId);
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
    const organizationId = await resolveActionOrgId(req);
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
    const isInternal = isInternalActor(req);
    const filter = {};
    if (isInternal) {
        await (0, orgAccess_1.scopeOrganizationFilter)(req, filter, req.query.organizationId);
    } else {
        filter.organizationId = req.user.organizationId;
    }
    const { page, limit, status } = req.query;
    const result = await bulk_estamp_service_1.BulkEStampService.listBatches(filter.organizationId, req.user.role, { page, limit, status });
    return (0, ApiResponse_1.ok)(res, result);
});
exports.getBatchDetail = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveViewOrgId(req);
    const { page, limit } = req.query;
    const result = await bulk_estamp_service_1.BulkEStampService.getBatchDetail(req.params.batchId, organizationId, req.user.role, { page, limit });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN && result?.batch?.organizationId) {
        await (0, orgAccess_1.assertCanActOnOrganization)(req, result.batch.organizationId);
    }
    return (0, ApiResponse_1.ok)(res, result);
});
exports.getBatchPreview = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = resolveViewOrgId(req);
    const { page, limit } = req.query;
    const result = await bulk_estamp_service_1.BulkEStampService.getBatchPreview(req.params.batchId, organizationId, req.user.role, { page, limit });
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN && result?.batch?.organizationId) {
        await (0, orgAccess_1.assertCanActOnOrganization)(req, result.batch.organizationId);
    }
    return (0, ApiResponse_1.ok)(res, result);
});
// Resolves the organizationId for a confirm/cancel action on an EXISTING
// batch. The batch's own organizationId is the source of truth (never a
// client-supplied value) - an internal actor must be assigned to that real
// organization, checked BEFORE any mutation happens. A Master Admin may act
// on any organization; an Assistant Master Admin only on one assigned to
// them (see orgAccess.assertCanActOnOrganization).
async function resolveExistingBatchOrgId(req) {
    if (!isInternalActor(req))
        return req.user.organizationId;
    if (!mongoose_1.Types.ObjectId.isValid(req.params.batchId))
        throw ApiError_1.ApiError.notFound("Batch not found");
    const batch = await models_1.BulkEStampBatch.findById(req.params.batchId).select("organizationId");
    if (!batch)
        throw ApiError_1.ApiError.notFound("Batch not found");
    await (0, orgAccess_1.assertCanActOnOrganization)(req, batch.organizationId);
    return batch.organizationId;
}
exports.confirmBatch = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = await resolveExistingBatchOrgId(req);
    const result = await bulk_estamp_service_1.BulkEStampService.confirmBatch(req.params.batchId, organizationId, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, result);
});
exports.cancelBatch = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const organizationId = await resolveExistingBatchOrgId(req);
    const batch = await bulk_estamp_service_1.BulkEStampService.cancelBatch(req.params.batchId, organizationId, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, batch);
});
// Human-facing template headers. matchHeaders() in bulk-estamp.service.js
// recognizes these (and the original canonical field names, for backward
// compatibility with any template already in the wild) via FIELD_ALIASES.
const TEMPLATE_COLUMNS = [
    { header: "State", field: "stateCode", width: 28 },
    { header: "Article", field: "articleId", width: 48 },
    // The real stamp duty to charge, read by matchHeaders()/rowToInputData()
    // (bulk-estamp.service.js). Auto-filled by formula and, via this sheet's
    // data validation, locked to that exact amount for a FIXED-rule article -
    // the server also independently ignores whatever is typed here for a
    // FIXED article and always uses its real fixed amount, so this cannot be
    // bypassed even by pasting over the validation. For every other rule
    // type, the filler types the duty amount directly - there is no
    // consideration-price-to-%/slab calculation for a bulk row.
    { header: "Stamp Duty", field: "stampDuty", width: 16 },
    // Optional top-up on top of a FIXED-rule article's non-negotiable base
    // duty (or on top of any other row's entered duty) - the only way to pay
    // MORE than a fixed rate without being rejected by the Stamp Duty
    // column's own validation.
    { header: "Additional Amount (Optional)", field: "additionalAmount", width: 26 },
    { header: "First Party", field: "firstParty", width: 20 },
    { header: "Second Party", field: "secondParty", width: 20 },
    { header: "Description of Document", field: "descriptionOfDocument", width: 30 },
    { header: "Property Description", field: "propertyDescription", width: 30 },
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
// The duty amount alone, as a plain number a filler can read at a glance
// (and that Excel can still treat as numeric if they copy it elsewhere) -
// never text like "Rs.X" or "At Actuals". Only a FIXED rule has one exact
// number; every other rule (CUSTOM/PERCENTAGE/SLAB) genuinely has no single
// number to show without the real consideration price, so the cell is left
// blank rather than guessed - see "Stamp Duty Rule" for the full rule text.
function describeStampDuty(rule) {
    return rule?.type === "FIXED" ? Number(rule.fixedAmount ?? 0) : null;
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
    // Without this, Excel shows the LAST CACHED result for every formula
    // cell below - and ExcelJS never writes one unless told to - so the
    // Stamp Duty column opened blank until the user manually forced a
    // recalculation (Ctrl+Alt+F9). This tells Excel to recalculate every
    // formula the moment the file opens, cached result or not.
    workbook.calcProperties = { fullCalcOnLoad: true };
    // "Template" - the sheet a user actually fills in. Added first so Excel opens this tab by default!
    const templateSheet = workbook.addWorksheet("Template");
    templateSheet.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.field, width: c.width }));
    const exampleArticle = articles[0];
    const exampleDuty = exampleArticle ? describeStampDuty(latestVersionByArticle.get(exampleArticle._id.toString())?.calculationRule) : null;
    templateSheet.addRow({
        stateCode: exampleArticle ? (0, indianStates_1.stateNameForCode)(exampleArticle.stateCode) : "",
        articleId: exampleArticle ? `${exampleArticle.articleCode} - ${exampleArticle.title}` : "",
        stampDuty: "",
        additionalAmount: 0,
        firstParty: "Alice",
        secondParty: "Bob",
        descriptionOfDocument: "Sale agreement",
        propertyDescription: "Flat No. 101, Example Apartments",
        stampDutyPaidBy: "Alice",
        numberOfEStamps: 1,
    });

    // "ArticleLists" holds:
    // - Row 1: state full names (columns 1..N)
    // - Row 2+: the articles for that state
    const listSheet = workbook.addWorksheet("ArticleLists", { state: "veryHidden" });
    const stateFullNames = stateCodes.map((c) => (0, indianStates_1.stateNameForCode)(c));
    stateCodes.forEach((stateCode, colIdx) => {
        const col = colIdx + 1;
        const articlesForState = articlesByState.get(stateCode) || [];
        listSheet.getCell(1, col).value = (0, indianStates_1.stateNameForCode)(stateCode);
        articlesForState.forEach((article, rowIdx) => {
            listSheet.getCell(rowIdx + 2, col).value = `${article.articleCode} - ${article.title}`;
        });
        const colLetter = listSheet.getColumn(col).letter;
        if (articlesForState.length > 0) {
            const rangeStr = `ArticleLists!$${colLetter}$2:$${colLetter}$${articlesForState.length + 1}`;
            // Register under code e.g. ART_AN
            workbook.definedNames.add(rangeStr, definedNameForStateCode(stateCode));
            // Also register under sanitized full state name e.g. ART_ANDAMAN_AND_NICOBAR_ISLANDS
            const fullName = (0, indianStates_1.stateNameForCode)(stateCode);
            const sanitizedFullName = `ART_${String(fullName).toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
            if (sanitizedFullName !== definedNameForStateCode(stateCode)) {
                workbook.definedNames.add(rangeStr, sanitizedFullName);
            }
        }
    });

    // Defined name for state list so dataValidation never exceeds Excel's 255-char string literal limit
    if (stateCodes.length > 0) {
        const lastColLetter = listSheet.getColumn(stateCodes.length).letter;
        workbook.definedNames.add(`ArticleLists!$A$1:$${lastColLetter}$1`, "STATE_NAMES_LIST");
    }

    const LAST_ROW = 500; // room to fill in batch rows
    const stateFormula = stateFullNames.length > 0 && stateFullNames.join(",").length <= 250
        ? `"${stateFullNames.join(",")}"`
        : "=STATE_NAMES_LIST";
    const additionalAmountLetter = templateSheet.getColumn("additionalAmount").letter;
    // Looks up the chosen State+Article Code against the "Article Reference"
    // sheet's own Stamp Duty column (computed server-side, never guessed
    // here) - blank for anything other than a FIXED-rule article, since only
    // a FIXED rule has one single, non-negotiable number. Reused both to
    // auto-fill column C's suggested value AND, below, to validate that a
    // FIXED-rule row's Stamp Duty cannot be edited away from it.
    const dutyLookup = (row) => `IFERROR(INDEX('Article Reference'!$E:$E,SUMPRODUCT(('Article Reference'!$A:$A=$A${row})*('Article Reference'!$B:$B=LEFT($B${row},IFERROR(FIND(" - ",$B${row})-1,0)))*ROW('Article Reference'!$A:$A))),"")`;
    for (let row = 2; row <= LAST_ROW; row += 1) {
        if (stateFullNames.length > 0) {
            templateSheet.getCell(`A${row}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: [stateFormula],
                showErrorMessage: false,
            };
        }
        // Dependent dropdown: looks up the ArticleLists named range matching
        // whichever state was chosen in column A of this same row.
        templateSheet.getCell(`B${row}`).dataValidation = {
            type: "list",
            allowBlank: true,
            formulae: [`INDIRECT("ART_"&SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(UPPER($A${row})," ","_"),"-","_"),"'","_"),"&","_"),",","_"))`],
            showErrorMessage: false,
        };
        const formulaCell = {
            formula: dutyLookup(row),
        };
        // Row 2 is the only row with a known answer up front (the
        // pre-filled example article) - give it a cached result too, so it
        // still shows correctly even in a viewer that doesn't honor
        // fullCalcOnLoad and recalculate formulas on open.
        if (row === 2 && exampleDuty !== null) {
            formulaCell.result = exampleDuty;
        }
        templateSheet.getCell(`C${row}`).value = formulaCell;
        // A FIXED-rule article's duty cannot be changed here - Excel rejects
        // any typed value that doesn't match the looked-up fixed amount
        // (blank is allowed while the row is still being filled in). This is
        // a convenience guard rail only; the server independently ignores
        // whatever is submitted for a FIXED article and always recalculates
        // from its real fixed amount, so this cannot be bypassed by
        // disabling or pasting over this validation.
        templateSheet.getCell(`C${row}`).dataValidation = {
            type: "custom",
            allowBlank: true,
            formulae: [`OR(${dutyLookup(row)}="",$C${row}=${dutyLookup(row)})`],
            showErrorMessage: true,
            errorStyle: "stop",
            errorTitle: "Fixed stamp duty cannot be changed",
            error: "This article has a fixed government duty rate and cannot be edited here. To pay more than the fixed amount, use the \"Additional Amount\" column instead.",
        };
        // Additional Amount: always optional, never negative.
        templateSheet.getCell(`${additionalAmountLetter}${row}`).dataValidation = {
            type: "decimal",
            operator: "greaterThanOrEqual",
            allowBlank: true,
            formulae: [0],
            showErrorMessage: true,
            errorStyle: "stop",
            errorTitle: "Invalid amount",
            error: "Additional Amount must be zero or a positive number.",
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
        { header: "Stamp Duty", key: "duty", width: 16 },
        { header: "Stamp Duty Rule", key: "rule", width: 28 },
    ];
    for (const article of articles) {
        const version = latestVersionByArticle.get(article._id.toString());
        refSheet.addRow({
            state: (0, indianStates_1.stateNameForCode)(article.stateCode),
            code: article.articleCode,
            title: article.title,
            description: article.description || "",
            duty: describeStampDuty(version?.calculationRule),
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
