"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BulkEStampService = void 0;
const mongoose_1 = require("mongoose");
const xlsx_1 = require("xlsx");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const validation_1 = require("@launcherdesk/validation");
const settings_service_1 = require("./settings.service");
const calculation_service_1 = require("./calculation.service");
const wallet_service_1 = require("./wallet.service");
const estamp_request_service_1 = require("./estamp-request.service");
const ApiError_1 = require("../utils/ApiError");
const audit_service_1 = require("./audit.service");
const notification_service_1 = require("./notification.service");
const fileSignature_1 = require("../utils/fileSignature");
const indianStates_1 = require("../utils/indianStates");
const estampPricing_1 = require("../utils/estampPricing");
// Phase 11 - Bulk E-Stamp Request Management.
//
// Core reuse principle: this module NEVER calculates, debits a wallet, or
// creates an EStampRequest/EStampOrder itself. Every actually-charged row
// goes through EStampRequestService.createRequest() exactly once, with a
// deterministic idempotencyKey (`bulk:<batchId>:row:<rowNumber>`) - the
// SAME double-submission-safe, atomically-reserved path a single-request
// creation uses. This file only adds: file parsing, per-row validation,
// duplicate-suspicion flagging, the upfront wallet-sum gate, and batch/item
// bookkeeping around that one call.
// Only accepted upload mimetypes - never trust a file extension alone.
const ALLOWED_MIME_TYPES = [
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
// The bulk-upload template's field names, in the exact order the CSV
// template is generated in. Required fields mirror createEStampRequestSchema
// minus idempotencyKey (bulk derives its own); propertyDescription is the
// only optional column. extraFields is deliberately NOT part of the
// spreadsheet template - state-specific extensible data entry is out of
// scope for a flat CSV/XLSX row in this phase.
const REQUIRED_FIELDS = [
    "stateCode",
    "articleId",
    "firstParty",
    "secondParty",
    "descriptionOfDocument",
    "considerationPrice",
    "stampDutyPaidBy",
    "numberOfEStamps",
];
const OPTIONAL_FIELDS = ["propertyDescription"];
const ALL_TEMPLATE_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
function isInternalRole(role) {
    return role === shared_1.Role.MASTER_ADMIN || role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
async function nextBatchNumber() {
    // Same simple, safe-enough approach as estamp-request.service.js's
    // nextSequenceNumber - not shared directly since that function isn't
    // exported, and duplicating a 4-line helper is cheaper than introducing
    // a cross-service coupling for it.
    const year = new Date().getFullYear();
    const rand = Math.floor(Math.random() * 900000 + 100000);
    return `LDE-BULK-${year}-${rand}`;
}
// Loads a batch, enforcing the identical tenant-isolation "not found" shape
// (missing vs. belongs-to-another-org) as every other tenant-scoped lookup
// in this codebase (see estamp-request.service.js's loadOwnedOrder).
async function loadOwnedBatch(batchId, organizationId, actorRole) {
    if (!mongoose_1.Types.ObjectId.isValid(batchId)) {
        throw ApiError_1.ApiError.notFound("Batch not found");
    }
    const batch = await models_1.BulkEStampBatch.findById(batchId);
    if (!batch || (!isInternalRole(actorRole) && batch.organizationId.toString() !== String(organizationId))) {
        throw ApiError_1.ApiError.notFound("Batch not found");
    }
    return batch;
}
function normalizeHeader(cell) {
    return String(cell ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
// Human-readable header text accepted alongside each canonical field name -
// matches the downloadTemplate-generated "Template" sheet's headers (see
// bulk-estamp.controller.js TEMPLATE_COLUMNS) while keeping every canonical
// name itself valid too, for backward compatibility with any template
// already in the wild or produced programmatically.
const FIELD_ALIASES = {
    stateCode: ["state", "state code", "statecode"],
    articleId: ["article", "article id", "article code", "article name", "articleid"],
    firstParty: ["first party", "first party name", "firstparty", "party 1", "party1", "1st party"],
    secondParty: ["second party", "second party name", "secondparty", "party 2", "party2", "2nd party"],
    descriptionOfDocument: ["description of document", "document description", "description", "descriptionofdocument", "doc description"],
    propertyDescription: ["property description", "property details", "property", "propertydescription"],
    considerationPrice: ["consideration price", "consideration amount", "consideration value", "price", "amount", "considerationprice"],
    // "stamp duty"/"stampduty" deliberately NOT aliased here - that header is
    // the informational duty-amount column on the Template sheet (see
    // bulk-estamp.controller.js), a different field from who pays it.
    stampDutyPaidBy: ["stamp duty paid by", "duty paid by", "paid by", "stampdutypaidby"],
    numberOfEStamps: ["number of e-stamps", "number of estamps", "number of e stamps", "no of e-stamps", "no of estamps", "no. of e-stamps", "numberofestamps", "quantity", "count"],
};
// Builds { canonicalField -> columnIndex }, plus lists of missing/duplicate
// canonical fields. Header matching is case-insensitive/trimmed but must
// resolve to exactly one column per canonical field.
function matchHeaders(headerRow) {
    const columnIndexByField = {};
    const duplicateFields = new Set();
    (headerRow || []).forEach((cell, idx) => {
        const raw = String(cell ?? "").trim();
        if (!raw) return;
        const normalized = normalizeHeader(cell);
        const compact = normalized.replace(/[^a-z0-9]/g, "");

        const field = ALL_TEMPLATE_FIELDS.find((f) => {
            const fLower = f.toLowerCase();
            const fCompact = fLower.replace(/[^a-z0-9]/g, "");
            if (fLower === normalized || fCompact === compact) return true;
            const aliases = FIELD_ALIASES[f] || [];
            return aliases.some(a => a === normalized || a.replace(/[^a-z0-9]/g, "") === compact);
        });

        if (!field)
            return; // unrecognized extra column - ignored, never stored
        if (columnIndexByField[field] !== undefined) {
            duplicateFields.add(field);
            return;
        }
        columnIndexByField[field] = idx;
    });
    const missingFields = REQUIRED_FIELDS.filter((f) => columnIndexByField[f] === undefined);
    return { columnIndexByField, missingFields, duplicateFields: Array.from(duplicateFields) };
}
function isBlankRow(row) {
    return !row || row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}
// Cells that already parsed as a JS number (from XLSX numeric cells, or
// SheetJS's own CSV numeric-guessing) are passed through untouched; a
// numeric-looking string is coerced; anything else is left as-is for zod to
// reject with a clear validation error. Never `eval`, never treated as a
// formula - a leading `=`/`+`/`-`/`@` stays inert literal text either way.
function coerceNumeric(value) {
    if (typeof value === "number")
        return value;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        return Number(value);
    }
    return value;
}
function rowToInputData(row, columnIndexByField) {
    const data = {};
    for (const field of ALL_TEMPLATE_FIELDS) {
        const idx = columnIndexByField[field];
        if (idx === undefined)
            continue;
        let value = row[idx];
        if (typeof value === "string")
            value = value.trim();
        if (value === "" || value === undefined)
            value = null;
        if (field === "considerationPrice" || field === "numberOfEStamps") {
            value = value === null ? value : coerceNumeric(value);
        }
        data[field] = value;
    }
    return data;
}
function duplicateKey(inputData) {
    const parts = ["stateCode", "articleId", "firstParty", "secondParty", "considerationPrice"].map((f) => inputData[f]);
    if (parts.some((p) => p === null || p === undefined || p === ""))
        return null;
    return parts.map((p) => String(p).trim().toUpperCase()).join("||");
}
// Same safeguard as the New Request wizard's First/Second Party buttons
// (and the client's own "Edit details" screen): "Stamp Duty Paid By" must
// name an actual party on the document, never arbitrary free text a
// spreadsheet column could otherwise carry through uncaught. A row whose
// payer doesn't match either party - a typo, a stray value from a wrong
// column, or someone who isn't actually a party to the document - is
// rejected with a clear, per-row reason instead of being silently accepted.
function payerMatchesAParty(row) {
    const payer = typeof row.stampDutyPaidBy === "string" ? row.stampDutyPaidBy.trim() : "";
    return payer === String(row.firstParty || "").trim() || payer === String(row.secondParty || "").trim();
}
exports.BulkEStampService = {
    async uploadBatch(input) {
        const { organizationId, createdBy, actorRole, fileBuffer, mimeType, originalFileName, req } = input;
        if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
            throw ApiError_1.ApiError.badRequest("Unsupported file type. Please upload a CSV or XLSX file.", "INVALID_FILE_TYPE");
        }
        // Phase 19 - same executable-byte-signature denylist as file.service.js:
        // the declared mimetype is client-controlled, so a renamed executable
        // claiming "text/csv"/"application/vnd...sheet" must still be rejected.
        if ((0, fileSignature_1.isExecutableSignature)(fileBuffer)) {
            throw ApiError_1.ApiError.badRequest("File content does not match an allowed file type.", "INVALID_FILE_TYPE");
        }
        // Phase 28 - read once per upload (not per check site below) so a
        // concurrent settings change can't make the two checks inconsistent
        // with each other within the same request; this is the live,
        // DB-backed limit (SettingsService itself fails safe to the
        // registry/env default on any read error, same as every other
        // runtime-wired setting).
        const maxRows = await settings_service_1.SettingsService.getBulkEstampMaxRows();
        let workbook;
        try {
            workbook = xlsx_1.read(fileBuffer, { type: "buffer" });
        }
        catch (err) {
            throw ApiError_1.ApiError.badRequest("Unable to parse the uploaded file. Please ensure it is a valid CSV or XLSX file.", "INVALID_FILE");
        }
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw ApiError_1.ApiError.badRequest("The uploaded file has no readable sheet.", "INVALID_FILE");
        }
        // In multi-sheet workbooks (e.g. generated templates containing Template,
        // ArticleLists, Article Reference), dynamically find the sheet that actually
        // contains the required bulk data columns, or is explicitly named "Template".
        let sheet = null;
        let selectedSheetName = workbook.SheetNames[0];

        // 1. Pass: Scan sheets for the one with 100% matched required headers
        for (const name of workbook.SheetNames) {
            const candidate = workbook.Sheets[name];
            if (!candidate) continue;
            const previewRows = xlsx_1.utils.sheet_to_json(candidate, { header: 1, raw: true, defval: null });
            if (previewRows && previewRows.length > 0) {
                const { missingFields } = matchHeaders(previewRows[0]);
                if (missingFields.length === 0) {
                    sheet = candidate;
                    selectedSheetName = name;
                    break;
                }
            }
        }

        // 2. Pass: If no sheet matched 100%, prefer a sheet named "Template"
        if (!sheet) {
            const templateName = workbook.SheetNames.find((n) => String(n).trim().toLowerCase() === "template");
            if (templateName && workbook.Sheets[templateName]) {
                sheet = workbook.Sheets[templateName];
                selectedSheetName = templateName;
            }
        }

        // 3. Pass: Fallback to the first sheet
        if (!sheet) {
            sheet = workbook.Sheets[selectedSheetName];
        }

        if (!sheet) {
            throw ApiError_1.ApiError.badRequest("The uploaded file has no readable sheet.", "INVALID_FILE");
        }
        // Phase 19 - a cheap, pre-materialization dimension sanity check.
        // xlsx.read() above has already decompressed/parsed the whole
        // workbook into cell objects (that cost cannot be avoided without
        // replacing the parser), but sheet_to_json() below still has to walk
        // every cell in the sheet's declared range to build the row array -
        // reject a pathologically large declared range (e.g. a small,
        // extreme-compression-ratio "zip bomb"-shaped .xlsx, or a sheet with
        // an absurd column count) BEFORE paying that materialization cost,
        // rather than only catching an oversized row count after the fact.
        const sheetRange = sheet["!ref"] ? xlsx_1.utils.decode_range(sheet["!ref"]) : null;
        if (sheetRange) {
            const rowCount = sheetRange.e.r - sheetRange.s.r + 1;
            const colCount = sheetRange.e.c - sheetRange.s.c + 1;
            const MAX_SAFE_ROWS = maxRows + 1000; // header row + generous buffer above the real business limit checked precisely below
            const MAX_SAFE_COLS = 200; // the template only ever needs ~9 columns
            if (rowCount > MAX_SAFE_ROWS || colCount > MAX_SAFE_COLS) {
                throw ApiError_1.ApiError.badRequest("The uploaded file's dimensions are too large to process.", "INVALID_FILE");
            }
        }
        // header:1 -> array-of-arrays, so header matching/duplicate detection is
        // fully under our control rather than relying on SheetJS's own
        // object-keying (which would silently collapse duplicate headers).
        const rawRows = xlsx_1.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
        const fileType = /\.csv$/i.test(originalFileName || "") ? "CSV" : "XLSX";
        const batchNumber = await nextBatchNumber();
        const batch = await models_1.BulkEStampBatch.create({
            batchNumber,
            organizationId,
            createdBy,
            fileName: originalFileName,
            fileType,
            status: shared_1.BulkBatchStatus.UPLOADED,
        });
        await (0, audit_service_1.recordAudit)({
            actorId: createdBy, actorRole: actorRole || "UNKNOWN", organizationId,
            action: shared_1.AuditAction.BULK_BATCH_UPLOADED, entityType: "BulkEStampBatch", entityId: batch._id.toString(),
            metadata: { batchNumber, fileName: originalFileName, fileType }, req,
        });
        // Structural failures below (empty file, bad headers, row count
        // exceeded) reject the WHOLE batch - never "some rows are wrong", that
        // is a legitimate PREVIEW_READY outcome handled further down.
        async function failStructurally(message) {
            batch.status = shared_1.BulkBatchStatus.FAILED;
            batch.errorSummary = message;
            await batch.save();
            await (0, audit_service_1.recordAudit)({
                actorId: createdBy, actorRole: actorRole || "UNKNOWN", organizationId,
                action: shared_1.AuditAction.BULK_BATCH_FAILED, entityType: "BulkEStampBatch", entityId: batch._id.toString(),
                metadata: { batchNumber: batch.batchNumber, reason: message }, req,
            });
            // Carries the created batch in `details` so the caller/UI can still
            // show what went wrong (and fetch it again via GET /:batchId) - note
            // that the global error handler strips `details` in production,
            // same as every other ApiError in this codebase; batchId is also in
            // the message text itself as a fallback.
            throw ApiError_1.ApiError.badRequest(`${message} (batch ${batch.batchNumber})`, "BULK_BATCH_STRUCTURAL_FAILURE", { batchId: batch._id.toString(), batch });
        }
        if (rawRows.length === 0) {
            await failStructurally("The uploaded file is empty.");
        }
        const headerRow = rawRows[0];
        const { columnIndexByField, missingFields, duplicateFields } = matchHeaders(headerRow);
        if (missingFields.length > 0) {
            await failStructurally(`Missing required column(s): ${missingFields.join(", ")}.`);
        }
        if (duplicateFields.length > 0) {
            await failStructurally(`Duplicate column(s) for: ${duplicateFields.join(", ")}.`);
        }
        const dataRows = rawRows.slice(1).filter((row) => !isBlankRow(row));
        if (dataRows.length > maxRows) {
            await failStructurally(`The file contains ${dataRows.length} rows, exceeding the maximum of ${maxRows} rows per batch.`);
        }
        batch.status = shared_1.BulkBatchStatus.VALIDATING;
        await batch.save();
        // Build every item's inputData first (so duplicate-suspect detection
        // can compare across the whole batch), THEN validate each row.
        const rowInputs = dataRows.map((row) => rowToInputData(row, columnIndexByField));
        // The downloadTemplate-generated sheet puts a full state name in the
        // State column and "<code> - <title>" in the Article column (see
        // bulk-estamp.controller.js) rather than the raw stateCode/articleId
        // this service has always stored - resolve both back to their real
        // values here, once, before anything else touches them. A value that
        // doesn't resolve (unknown state name, unmatched article text) is
        // left exactly as typed, so the existing zod/ObjectId validation
        // below still rejects it with its normal, clear error - this step
        // only ever helps a valid human-entered value, never masks a bad one.
function calculateEstampRowPricing(calcDuty, considerationPrice, numberOfEStamps = 1) {
    const qty = Math.max(1, Number(numberOfEStamps) || 1);
    let duty = Number(calcDuty) || 0;
    if (duty === 0) {
        const consideration = Number(considerationPrice) || 0;
        if (consideration > 0) {
            let perStamp = 100;
            if (consideration <= 5000) {
                perStamp = 100;
            } else if (consideration <= 50000) {
                perStamp = 200;
            } else if (consideration <= 500000) {
                perStamp = 500;
            } else {
                perStamp = Math.min(100000, Math.max(500, Math.round(consideration * 0.001)));
            }
            duty = perStamp * qty;
        } else {
            duty = 100 * qty;
        }
    }
    // Shared with the single-request preview so both flows quote the same
    // published pricing from one place (see utils/estampPricing.js). `duty`
    // is always > 0 by this point thanks to the fallback above, so the
    // helper's "unknown duty" null total never applies here.
    const { convenienceFee, procurementFee, feeTotal, gst, totalAmount } = (0, estampPricing_1.calculateEstampFees)(duty);
    return {
        stampDuty: duty,
        convenienceFee,
        procurementFee,
        feeTotal,
        gst,
        totalAmount,
    };
}
        const activeArticles = await models_1.Article.find({ isActive: true }).select("stateCode articleCode title").lean();
        const articleIdByStateAndCode = new Map();
        const articleMapById = new Map();
        for (const a of activeArticles) {
            articleMapById.set(a._id.toString(), a);
            const state = a.stateCode.toUpperCase();
            const code = a.articleCode.toUpperCase();
            const title = (a.title || "").toUpperCase().trim();
            articleIdByStateAndCode.set(`${state}|${code}`, a._id.toString());
            articleIdByStateAndCode.set(`${state}|${code.replace(/[^A-Z0-9]/g, "")}`, a._id.toString());
            if (title) {
                articleIdByStateAndCode.set(`${state}|${title}`, a._id.toString());
                articleIdByStateAndCode.set(`${state}|${code} - ${title}`, a._id.toString());
            }
        }
        for (const data of rowInputs) {
            if (data.stateCode) {
                data.stateCode = (0, indianStates_1.resolveStateCode)(data.stateCode);
            }
            if (data.articleId && !mongoose_1.Types.ObjectId.isValid(String(data.articleId))) {
                const rawArticle = String(data.articleId).trim();
                const state = String(data.stateCode || "").toUpperCase();
                const parts = rawArticle.split(" - ");
                const code = parts[0].trim().toUpperCase();
                const titlePart = parts.length > 1 ? parts.slice(1).join(" - ").trim().toUpperCase() : "";
                let resolved = articleIdByStateAndCode.get(`${state}|${code}`);
                if (!resolved) {
                    resolved = articleIdByStateAndCode.get(`${state}|${rawArticle.toUpperCase()}`);
                }
                if (!resolved && titlePart) {
                    resolved = articleIdByStateAndCode.get(`${state}|${titlePart}`);
                }
                if (!resolved) {
                    resolved = articleIdByStateAndCode.get(`${state}|${code.replace(/[^A-Z0-9]/g, "")}`);
                }
                if (!resolved) {
                    // Try matching rawArticle without hyphens
                    resolved = articleIdByStateAndCode.get(`${state}|${rawArticle.replace(/[^A-Z0-9]/g, "")}`);
                }
                if (resolved)
                    data.articleId = resolved;
            }
        }
        const duplicateKeys = new Map();
        rowInputs.forEach((data, idx) => {
            const key = duplicateKey(data);
            if (!key)
                return;
            if (!duplicateKeys.has(key))
                duplicateKeys.set(key, []);
            duplicateKeys.get(key).push(idx);
        });
        const suspectIndexes = new Set();
        for (const indexes of duplicateKeys.values()) {
            if (indexes.length > 1)
                indexes.forEach((i) => suspectIndexes.add(i));
        }
        let validCount = 0;
        let invalidCount = 0;
        let estimatedTotal = 0;
        let estimatedDutyTotal = 0;
        let estimatedConvTotal = 0;
        let estimatedProcTotal = 0;
        let estimatedGstTotal = 0;
        // A plain for-loop (not .map) because valid rows need an awaited
        // CalculationService.calculate() call each - storing calculatedAmount
        // here (rather than leaving it null until confirm) is what lets the
        // preview screen show a real per-row and total estimate. confirmBatch
        // below NEVER trusts this stored value for the actual financial
        // decision - it always recalculates from scratch at confirm time.
        const itemsToInsert = [];
        for (let idx = 0; idx < rowInputs.length; idx += 1) {
            const inputData = rowInputs[idx];
            const rowNumber = idx + 1; // 1-based data-row number, header row excluded
            const validationErrors = [];
            let calculatedDuty = 0;
            let articleVersionUsed;
            const result = validation_1.bulkEStampRowSchema.safeParse(inputData);
            if (!result.success) {
                for (const issue of result.error.issues) {
                    validationErrors.push(`${issue.path.join(".") || "row"}: ${issue.message}`);
                }
            }
            else if (!mongoose_1.Types.ObjectId.isValid(result.data.articleId)) {
                validationErrors.push("articleId: must be a valid article identifier");
            }
            else if (!payerMatchesAParty(result.data)) {
                validationErrors.push("stampDutyPaidBy: must exactly match the First Party or Second Party name for this row");
            }
            else {
                try {
                    const calc = await calculation_service_1.CalculationService.calculate({
                        stateCode: result.data.stateCode,
                        articleId: result.data.articleId,
                        considerationPrice: result.data.considerationPrice,
                        numberOfEStamps: result.data.numberOfEStamps,
                    });
                    calculatedDuty = calc.amount;
                    articleVersionUsed = calc.articleVersionUsed;
                }
                catch (err) {
                    validationErrors.push(`articleId: ${err?.message || "Unable to calculate stamp duty for this row"}`);
                }
            }
            const isValid = validationErrors.length === 0;
            let pricing = null;
            if (isValid) {
                validCount += 1;
                pricing = calculateEstampRowPricing(calculatedDuty, result.data.considerationPrice, result.data.numberOfEStamps);
                estimatedDutyTotal += pricing.stampDuty;
                estimatedConvTotal += pricing.convenienceFee;
                estimatedProcTotal += pricing.procurementFee;
                estimatedGstTotal += pricing.gst;
                estimatedTotal += pricing.totalAmount;
            }
            else {
                invalidCount += 1;
            }
            const art = result.success ? articleMapById.get(String(result.data.articleId)) : null;
            itemsToInsert.push({
                batchId: batch._id,
                organizationId,
                rowNumber,
                status: isValid ? "VALID" : "INVALID",
                inputData,
                validationErrors,
                calculatedAmount: pricing ? pricing.stampDuty : undefined,
                stampDuty: pricing ? pricing.stampDuty : undefined,
                convenienceFee: pricing ? pricing.convenienceFee : 0,
                procurementFee: pricing ? pricing.procurementFee : 0,
                gst: pricing ? pricing.gst : 0,
                totalAmount: pricing ? pricing.totalAmount : undefined,
                articleDetails: {
                    code: art?.articleCode || "",
                    title: art?.title || "",
                },
                articleVersionUsed,
                isDuplicateSuspect: suspectIndexes.has(idx),
                idempotencyKey: `bulk:${batch._id.toString()}:row:${rowNumber}`,
            });
        }
        if (itemsToInsert.length > 0) {
            await models_1.BulkEStampBatchItem.insertMany(itemsToInsert);
        }
        batch.totalRows = itemsToInsert.length;
        // Pre-confirm estimate only (sum over currently-VALID rows) - always
        // overwritten with the actual created-rows total once confirmBatch runs.
        batch.totalStampDuty = estimatedDutyTotal;
        batch.totalConvenienceFee = estimatedConvTotal;
        batch.totalProcurementFee = estimatedProcTotal;
        batch.totalGst = estimatedGstTotal;
        batch.totalPayableAmount = estimatedTotal;
        batch.validRows = validCount;
        batch.invalidRows = invalidCount;
        batch.status = shared_1.BulkBatchStatus.PREVIEW_READY;
        await batch.save();
        await (0, audit_service_1.recordAudit)({
            actorId: createdBy, actorRole: actorRole || "UNKNOWN", organizationId,
            action: shared_1.AuditAction.BULK_BATCH_VALIDATED, entityType: "BulkEStampBatch", entityId: batch._id.toString(),
            metadata: { batchNumber: batch.batchNumber, totalRows: batch.totalRows, validRows: validCount, invalidRows: invalidCount },
            req,
        });
        return { batch, items: itemsToInsert.length };
    },
    async listBatches(organizationId, actorRole, { page = 1, limit = 20, status } = {}) {
        const filter = {};
        if (organizationId)
            filter.organizationId = organizationId;
        if (status)
            filter.status = status;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
        const [items, total] = await Promise.all([
            models_1.BulkEStampBatch.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
            models_1.BulkEStampBatch.countDocuments(filter),
        ]);
        return { items, total, page: pageNum, limit: limitNum };
    },
    // getBatchPreview and getBatchDetail intentionally share this single
    // implementation - the preview endpoint is just the detail endpoint at
    // an earlier lifecycle stage; calculatedAmount for VALID rows is
    // whatever the validate step stored (see uploadBatch) - confirmBatch
    // below is the ONLY place that ever recalculates fresh, since prices/
    // rules can change between preview and confirm.
    async getBatchDetail(batchId, organizationId, actorRole, { page = 1, limit = 50 } = {}) {
        const batch = await loadOwnedBatch(batchId, organizationId, actorRole);
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 50));
        const [rawItems, itemsTotal] = await Promise.all([
            models_1.BulkEStampBatchItem.find({ batchId: batch._id }).sort({ rowNumber: 1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
            models_1.BulkEStampBatchItem.countDocuments({ batchId: batch._id }),
        ]);

        // Auto-enrich items if missing articleDetails or fees (e.g. previously uploaded batches)
        const missingArticleIds = rawItems
            .filter((it) => !it.articleDetails?.title && it.inputData?.articleId && mongoose_1.Types.ObjectId.isValid(String(it.inputData.articleId)))
            .map((it) => it.inputData.articleId);

        const articlesById = new Map();
        if (missingArticleIds.length > 0) {
            const arts = await models_1.Article.find({ _id: { $in: missingArticleIds } }).select("articleCode title").lean();
            arts.forEach((a) => articlesById.set(a._id.toString(), a));
        }

        const items = rawItems.map((it) => {
            let artCode = it.articleDetails?.code || "";
            let artTitle = it.articleDetails?.title || "";
            if (!artTitle && it.inputData?.articleId) {
                const found = articlesById.get(String(it.inputData.articleId));
                if (found) {
                    artCode = found.articleCode;
                    artTitle = found.title;
                }
            }
            let pricing = {
                stampDuty: it.stampDuty,
                convenienceFee: it.convenienceFee,
                procurementFee: it.procurementFee,
                gst: it.gst,
                totalAmount: it.totalAmount,
            };
            if (it.status === "VALID" && (!it.totalAmount || it.calculatedAmount === 0)) {
                pricing = calculateEstampRowPricing(it.stampDuty || it.calculatedAmount, it.inputData?.considerationPrice, it.inputData?.numberOfEStamps);
            }
            return {
                ...it,
                calculatedAmount: pricing.stampDuty ?? it.calculatedAmount,
                stampDuty: pricing.stampDuty ?? it.stampDuty,
                convenienceFee: pricing.convenienceFee ?? it.convenienceFee ?? 0,
                procurementFee: pricing.procurementFee ?? it.procurementFee ?? 0,
                gst: pricing.gst ?? it.gst ?? 0,
                totalAmount: pricing.totalAmount ?? it.totalAmount,
                articleDetails: {
                    code: artCode,
                    title: artTitle,
                },
            };
        });

        const batchObj = batch.toObject ? batch.toObject() : batch;
        if (!batchObj.totalPayableAmount && batchObj.validRows > 0) {
            const allValid = await models_1.BulkEStampBatchItem.find({ batchId: batch._id, status: "VALID" }).lean();
            let sumDuty = 0;
            let sumConv = 0;
            let sumProc = 0;
            let sumGst = 0;
            let sumTotal = 0;
            for (const v of allValid) {
                const p = calculateEstampRowPricing(v.stampDuty || v.calculatedAmount, v.inputData?.considerationPrice, v.inputData?.numberOfEStamps);
                sumDuty += p.stampDuty;
                sumConv += p.convenienceFee;
                sumProc += p.procurementFee;
                sumGst += p.gst;
                sumTotal += p.totalAmount;
            }
            batchObj.totalStampDuty = sumDuty;
            batchObj.totalConvenienceFee = sumConv;
            batchObj.totalProcurementFee = sumProc;
            batchObj.totalGst = sumGst;
            batchObj.totalPayableAmount = sumTotal;
        }

        return { batch: batchObj, items, itemsTotal, page: pageNum, limit: limitNum };
    },
    async getBatchPreview(batchId, organizationId, actorRole, pagination) {
        return this.getBatchDetail(batchId, organizationId, actorRole, pagination);
    },
    async cancelBatch(batchId, organizationId, actorId, actorRole, req) {
        const existing = await loadOwnedBatch(batchId, organizationId, actorRole);
        const CANCELLABLE = [shared_1.BulkBatchStatus.UPLOADED, shared_1.BulkBatchStatus.VALIDATING, shared_1.BulkBatchStatus.PREVIEW_READY];
        const claimed = await models_1.BulkEStampBatch.findOneAndUpdate({ _id: existing._id, status: { $in: CANCELLABLE } }, { status: shared_1.BulkBatchStatus.CANCELLED }, { new: true });
        if (!claimed) {
            throw ApiError_1.ApiError.conflict("Cannot cancel a batch that has already been confirmed", "INVALID_STATE_TRANSITION");
        }
        await (0, audit_service_1.recordAudit)({
            actorId, actorRole: actorRole || "UNKNOWN", organizationId: claimed.organizationId.toString(),
            action: shared_1.AuditAction.BULK_BATCH_CANCELLED, entityType: "BulkEStampBatch", entityId: claimed._id.toString(),
            metadata: { batchNumber: claimed.batchNumber }, req,
        });
        return claimed;
    },
    // The heart of Phase 11. See module header + the confirm-time gate
    // comment below for the safety design; nothing here debits a wallet or
    // creates an EStampRequest/EStampOrder directly - every charged row goes
    // through EStampRequestService.createRequest() exactly once.
    async confirmBatch(batchId, organizationId, actorId, actorRole, req) {
        const existing = await loadOwnedBatch(batchId, organizationId, actorRole);
        // Idempotent / concurrency-safe no-op: anything other than
        // PREVIEW_READY means this batch was already claimed for confirmation
        // (by this call, an earlier call, or a concurrent one) - re-report its
        // current, authoritative state rather than reprocessing it.
        if (existing.status !== shared_1.BulkBatchStatus.PREVIEW_READY) {
            return { batch: existing, alreadyProcessed: true };
        }
        // Atomic claim - only the caller that wins this transition proceeds
        // (mirrors EStampRequestService.processOrder's CREATED -> SUBMITTING
        // claim). A losing concurrent call falls through to the branch above
        // on ITS read, or lands here and sees matchedCount 0.
        const claimed = await models_1.BulkEStampBatch.findOneAndUpdate({ _id: existing._id, status: shared_1.BulkBatchStatus.PREVIEW_READY }, { status: shared_1.BulkBatchStatus.PROCESSING }, { new: true });
        if (!claimed) {
            const current = await models_1.BulkEStampBatch.findById(existing._id);
            return { batch: current, alreadyProcessed: true };
        }
        await (0, audit_service_1.recordAudit)({
            actorId, actorRole: actorRole || "UNKNOWN", organizationId: claimed.organizationId.toString(),
            action: shared_1.AuditAction.BULK_BATCH_CONFIRMED, entityType: "BulkEStampBatch", entityId: claimed._id.toString(),
            metadata: { batchNumber: claimed.batchNumber }, req,
        });
        const validItems = await models_1.BulkEStampBatchItem.find({ batchId: claimed._id, status: "VALID" }).sort({ rowNumber: 1 });
        // Re-validate + re-calculate every currently-VALID row FROM SCRATCH -
        // never trust anything stored from the validate step for a financial
        // decision. A row that fails here (e.g. its article was deactivated
        // between preview and confirm) becomes FAILED with a reason and is
        // simply excluded from the sum below - it never blocks other rows.
        const recalculated = [];
        let reValidationFailures = 0;
        for (const item of validItems) {
            try {
                const parsed = validation_1.bulkEStampRowSchema.parse(item.inputData);
                if (!mongoose_1.Types.ObjectId.isValid(parsed.articleId)) {
                    throw ApiError_1.ApiError.badRequest("articleId is not a valid identifier", "ARTICLE_NOT_FOUND");
                }
                if (!payerMatchesAParty(parsed)) {
                    throw ApiError_1.ApiError.badRequest("stampDutyPaidBy must exactly match the First Party or Second Party name for this row", "VALIDATION_ERROR");
                }
                const { amount, articleVersionUsed } = await calculation_service_1.CalculationService.calculate({
                    stateCode: parsed.stateCode,
                    articleId: parsed.articleId,
                    considerationPrice: parsed.considerationPrice,
                    numberOfEStamps: parsed.numberOfEStamps,
                });
                recalculated.push({ item, parsed, amount, articleVersionUsed });
            }
            catch (err) {
                item.status = "FAILED";
                item.failureReason = err?.message ? String(err.message).slice(0, 500) : "Re-validation failed at confirm time";
                await item.save();
                reValidationFailures += 1;
            }
        }
        const requiredTotal = recalculated.reduce((sum, r) => sum + r.amount, 0);
        // Available = balance - amounts already reserved by requests still in
        // their window. Each row then reserves its own amount atomically via
        // createRequest, so this gate is a fast all-or-nothing pre-check only.
        const currentBalance = (await (0, wallet_service_1.getWalletSummary)(claimed.organizationId)).availableBalance;
        if (recalculated.length > 0 && requiredTotal > currentBalance) {
            // Upfront all-or-nothing gate: the common insufficient-funds case
            // fails cleanly with ZERO side effects on the wallet/requests -
            // nothing is created, nothing is debited. The batch/items are still
            // updated to FAILED so the outcome is tracked and visible, even
            // though the HTTP response itself is a 400.
            for (const { item } of recalculated) {
                item.status = "FAILED";
                item.failureReason = "Batch rejected: insufficient organization wallet balance";
                await item.save();
            }
            claimed.createdRequests = 0;
            claimed.failedRows = reValidationFailures + recalculated.length;
            claimed.totalStampDuty = 0;
            claimed.status = shared_1.BulkBatchStatus.FAILED;
            claimed.errorSummary = `Insufficient wallet balance: required ${requiredTotal}, available ${currentBalance}.`;
            await claimed.save();
            await this._finalizeAudit(claimed, actorId, actorRole, req);
            await this._notifyBatchOutcome(claimed, actorId, actorRole);
            throw ApiError_1.ApiError.badRequest(claimed.errorSummary, "INSUFFICIENT_BALANCE", {
                batchId: claimed._id.toString(),
                required: requiredTotal,
                available: currentBalance,
            });
        }
        let createdRequests = 0;
        let creationFailures = 0;
        let totalStampDuty = 0;
        for (const { item, parsed, amount, articleVersionUsed } of recalculated) {
            const idempotencyKey = item.idempotencyKey || `bulk:${claimed._id.toString()}:row:${item.rowNumber}`;
            try {
                const { request, order } = await estamp_request_service_1.EStampRequestService.createRequest({
                    organizationId: claimed.organizationId,
                    createdBy: actorId,
                    actorRole,
                    stateCode: parsed.stateCode,
                    articleId: parsed.articleId,
                    firstParty: parsed.firstParty,
                    secondParty: parsed.secondParty,
                    descriptionOfDocument: parsed.descriptionOfDocument,
                    propertyDescription: parsed.propertyDescription,
                    considerationPrice: parsed.considerationPrice,
                    stampDutyPaidBy: parsed.stampDutyPaidBy,
                    numberOfEStamps: parsed.numberOfEStamps,
                    idempotencyKey,
                    req,
                });
                item.status = "CREATED";
                item.requestId = request._id;
                item.orderId = order?._id;
                item.idempotencyKey = idempotencyKey;
                item.calculatedAmount = amount;
                item.articleVersionUsed = articleVersionUsed;
                await item.save();
                createdRequests += 1;
                totalStampDuty += amount;
            }
            catch (err) {
                // A genuine race (e.g. a concurrent spend depleted the balance
                // between the gate check above and this row) - this ONE row
                // fails, tracked with its reason; every other row still
                // proceeds. No compensating rollback of rows already created -
                // a partial-failure batch is an accepted, explicitly-tracked
                // outcome (see module header).
                item.status = "FAILED";
                item.idempotencyKey = idempotencyKey;
                item.failureReason = err?.message ? String(err.message).slice(0, 500) : "Failed to create E-Stamp request";
                await item.save();
                creationFailures += 1;
            }
        }
        claimed.createdRequests = createdRequests;
        claimed.failedRows = reValidationFailures + creationFailures;
        claimed.totalStampDuty = totalStampDuty;
        claimed.status = createdRequests > 0
            ? (claimed.failedRows > 0 ? shared_1.BulkBatchStatus.PARTIALLY_FAILED : shared_1.BulkBatchStatus.COMPLETED)
            : shared_1.BulkBatchStatus.FAILED;
        if (claimed.status === shared_1.BulkBatchStatus.FAILED && !claimed.errorSummary) {
            claimed.errorSummary = recalculated.length === 0
                ? "No valid rows were available to confirm."
                : "All rows failed during confirmation.";
        }
        await claimed.save();
        await this._finalizeAudit(claimed, actorId, actorRole, req);
        await this._notifyBatchOutcome(claimed, actorId, actorRole);
        const items = await models_1.BulkEStampBatchItem.find({ batchId: claimed._id }).sort({ rowNumber: 1 });
        return { batch: claimed, items };
    },
    // Shared tail-end bookkeeping for confirmBatch's two exit paths
    // (gate-rejected and loop-completed) - kept in one place so both record
    // the identical audit/notification contract.
    async _finalizeAudit(claimed, actorId, actorRole, req) {
        const action = claimed.createdRequests > 0 ? shared_1.AuditAction.BULK_BATCH_COMPLETED : shared_1.AuditAction.BULK_BATCH_FAILED;
        await (0, audit_service_1.recordAudit)({
            actorId, actorRole: actorRole || "UNKNOWN", organizationId: claimed.organizationId.toString(),
            action, entityType: "BulkEStampBatch", entityId: claimed._id.toString(),
            metadata: {
                batchNumber: claimed.batchNumber,
                status: claimed.status,
                createdRequests: claimed.createdRequests,
                failedRows: claimed.failedRows,
            },
            req,
        });
    },
    // ONE notification + email per batch (never one per row - a 500-row batch
    // must not send 500 emails): to the person who uploaded it, and to the
    // staff who must fulfil it (every Master Admin plus the client's assigned
    // Assistant Master Admin).
    async _notifyBatchOutcome(claimed, actorId, actorRole) {
        const summary = `Batch ${claimed.batchNumber}: ${claimed.createdRequests} created, ${claimed.failedRows} failed out of ${claimed.totalRows} row(s).`;
        const creator = await models_1.User.findById(claimed.createdBy).select("role email");
        if (creator) {
            const title = "Bulk E-Stamp batch processed";
            await (0, notification_service_1.notifyUser)({
                recipientId: claimed.createdBy.toString(),
                recipientRole: creator.role,
                type: shared_1.NotificationType.ESTAMP_STATUS,
                title,
                message: summary,
                organizationId: claimed.organizationId.toString(),
                relatedActorId: actorId,
                entityType: "BulkEStampBatch",
                entityId: claimed._id,
                eventKey: `bulk-batch:${claimed._id.toString()}:confirmed`,
                email: creator.email
                    ? { to: creator.email, method: "sendOrderStatusEmail", args: [{ title, message: summary, status: claimed.status, portalPath: `/estamps/bulk/${claimed._id.toString()}` }] }
                    : undefined,
            });
        }
        if (claimed.createdRequests > 0) {
            const org = await models_1.Organization.findById(claimed.organizationId).select("name");
            const title = `Bulk E-Stamp order placed: ${claimed.createdRequests} e-stamp(s)`;
            const message = `${org?.name || "A client"} placed bulk batch ${claimed.batchNumber} - ${claimed.createdRequests} e-stamp request(s) created.`;
            const staffParams = {
                type: shared_1.NotificationType.ESTAMP_STATUS,
                title,
                message,
                organizationId: claimed.organizationId.toString(),
                relatedActorId: actorId,
                entityType: "BulkEStampBatch",
                entityId: claimed._id,
                eventKey: `bulk-batch:${claimed._id.toString()}:staff`,
                email: { method: "sendOrderStatusEmail", args: [{ title, message, status: "Placed", portalPath: "/orders" }] },
            };
            await (0, notification_service_1.notifyAllMasterAdmins)(staffParams);
            await (0, notification_service_1.notifyAssignedAssistant)(claimed.organizationId, staffParams);
        }
        if (actorRole === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
            await (0, notification_service_1.notifyAllMasterAdmins)({
                type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
                title: "Bulk E-Stamp batch confirmed",
                message: `Assistant Master Admin confirmed bulk batch ${claimed.batchNumber} (${claimed.createdRequests} created, ${claimed.failedRows} failed).`,
                relatedActorId: actorId,
                organizationId: claimed.organizationId.toString(),
            });
        }
    },
};
