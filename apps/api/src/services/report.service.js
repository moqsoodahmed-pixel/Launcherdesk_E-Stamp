"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportService = void 0;
const mongoose_1 = require("mongoose");
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const shared_1 = require("@launcherdesk/shared");
const estamp_provider_service_1 = require("./estamp-provider.service");
const settings_service_1 = require("./settings.service");
// Phase 13 - Reports & Analytics. READ-ONLY over existing source-of-truth
// collections - no new analytics database/collection, no mutation of
// anything, no duplicate business logic. Order-analytics totals/breakdown
// are delegated to EStampProviderService.getUsage (already implements that
// exact aggregation) rather than re-implemented here.
//
// Same date-handling convention as the rest of the codebase (order.controller,
// estamp-provider.service): `new Date(x)` is parsed as-is (UTC if the string
// carries a `Z`/offset, or if date-only) and compared directly. No timezone
// concept is introduced by this phase - every boundary below is UTC.
//
// Phase 17 - was a hardcoded `366` literal duplicated independently in
// estamp-provider.service.js's MAX_USAGE_RANGE_DAYS. Both now read the SAME
// live REPORT_MAX_DATE_RANGE_DAYS setting (settings.service.js), unifying
// what used to be two copies of one constant that could silently drift.
function startOfUTCDay(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
function endOfUTCDay(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}
const DATE_PRESETS = ["today", "yesterday", "last7days", "last30days", "currentMonth", "previousMonth"];
function resolvePreset(preset, now) {
    switch (preset) {
        case "today":
            return { from: startOfUTCDay(now), to: now };
        case "yesterday": {
            const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            return { from: startOfUTCDay(y), to: endOfUTCDay(y) };
        }
        case "last7days":
            return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
        case "last30days":
            return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };
        case "currentMonth":
            return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)), to: now };
        case "previousMonth": {
            const firstOfCurrent = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
            const lastOfPrev = new Date(firstOfCurrent.getTime() - 1);
            const firstOfPrev = new Date(Date.UTC(lastOfPrev.getUTCFullYear(), lastOfPrev.getUTCMonth(), 1, 0, 0, 0, 0));
            return { from: firstOfPrev, to: lastOfPrev };
        }
        default:
            return null;
    }
}
// Single shared date-range validator/parser for the whole reporting surface -
// same error codes/messages/max-range as estamp-provider.service.js's
// getUsage, so the API is consistent whether you hit /reports/orders or
// /estamp-provider/usage. Supports either a named preset OR explicit
// from/to, never both silently mixed (preset wins if both are given).
async function resolveDateRange({ preset, from, to, defaultRangeDays = 30 }) {
    const now = new Date();
    if (preset) {
        if (!DATE_PRESETS.includes(preset)) {
            throw ApiError_1.ApiError.badRequest(`Invalid preset. Must be one of: ${DATE_PRESETS.join(", ")}`, "INVALID_DATE_RANGE");
        }
        return resolvePreset(preset, now);
    }
    const rangeTo = to ? new Date(to) : now;
    const rangeFrom = from ? new Date(from) : new Date(rangeTo.getTime() - defaultRangeDays * 24 * 60 * 60 * 1000);
    if (Number.isNaN(rangeFrom.getTime()) || Number.isNaN(rangeTo.getTime())) {
        throw ApiError_1.ApiError.badRequest("Invalid date range", "INVALID_DATE_RANGE");
    }
    if (rangeFrom.getTime() > rangeTo.getTime()) {
        throw ApiError_1.ApiError.badRequest("`from` must not be after `to`", "INVALID_DATE_RANGE");
    }
    const maxRangeDays = await settings_service_1.SettingsService.getReportMaxDateRangeDays();
    if (rangeTo.getTime() - rangeFrom.getTime() > maxRangeDays * 24 * 60 * 60 * 1000) {
        throw ApiError_1.ApiError.badRequest(`Date range cannot exceed ${maxRangeDays} days`, "RANGE_TOO_LARGE");
    }
    return { from: rangeFrom, to: rangeTo };
}
// Generic "validate and cast" helper for any client-supplied id destined for
// a $match - never trust an unvalidated string into a Mongo query.
function toObjectId(id, message, code) {
    if (!id)
        return undefined;
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw ApiError_1.ApiError.badRequest(message, code);
    }
    return new mongoose_1.Types.ObjectId(id);
}
function toOrgId(organizationId) {
    return toObjectId(organizationId, "Invalid organizationId", "INVALID_ORGANIZATION_ID");
}
function toArticleId(articleId) {
    return toObjectId(articleId, "Invalid articleId", "INVALID_ARTICLE_ID");
}
// Safe division - every rate in this module goes through this so a zero
// denominator is always `null`, never NaN/Infinity.
function safeRate(numerator, denominator) {
    if (!denominator)
        return null;
    return numerator / denominator;
}
exports.ReportService = {
    resolveDateRange,
    // Kept byte-for-byte compatible with the original inline /reports/summary
    // handler this phase refactors out of report.routes.js - DashboardPage.jsx
    // consumes this exact shape and is not being changed in this phase.
    async getLegacySummary({ organizationId }) {
        const filter = organizationId ? { organizationId: toOrgId(organizationId) } : {};
        const [totalRequests, totalOrders, statusCounts] = await Promise.all([
            models_1.EStampRequest.countDocuments(filter),
            models_1.EStampOrder.countDocuments(filter),
            models_1.EStampRequest.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
        ]);
        return { totalRequests, totalOrders, statusCounts };
    },
    // Cheap, role-scoped high-level counts for the new dashboard. The
    // controller decides which sections of this to actually hand back to a
    // given caller (e.g. `financial` is stripped unless the caller holds
    // REPORT_FINANCIAL_VIEW, `organizations` unless `isGlobal`) - this
    // function itself always computes the full shape so that gating logic
    // lives in exactly one place (the controller), not duplicated here.
    async getDashboardSummary({ organizationId, isGlobal }) {
        const filter = organizationId ? { organizationId: toOrgId(organizationId) } : {};
        const [requestStatusRows, orderStatusRows, successfulPayments, failedPayments, requestValueAgg, wallet, orgCounts] = await Promise.all([
            models_1.EStampRequest.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
            models_1.EStampOrder.aggregate([{ $match: filter }, { $group: { _id: "$eStampStatus", count: { $sum: 1 } } }]),
            models_1.Payment.aggregate([{ $match: { ...filter, status: shared_1.PaymentStatus.SUCCESS } }, { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
            models_1.Payment.countDocuments({ ...filter, status: shared_1.PaymentStatus.FAILED }),
            models_1.EStampRequest.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: "$calculatedStampDuty" }, count: { $sum: 1 } } }]),
            // A single "current balance" is only meaningful for one organization -
            // never summed/averaged across organizations for a global view (see
            // getOrganizationReport for the per-org breakdown instead).
            organizationId ? models_1.Wallet.findOne({ organizationId: toOrgId(organizationId) }) : Promise.resolve(null),
            isGlobal
                ? Promise.all([
                    models_1.Organization.countDocuments({}),
                    models_1.Organization.countDocuments({ status: shared_1.OrganizationStatus.ACTIVE }),
                ])
                : Promise.resolve(null),
        ]);
        const requestsTotal = requestStatusRows.reduce((sum, r) => sum + r.count, 0);
        const ordersTotal = orderStatusRows.reduce((sum, r) => sum + r.count, 0);
        const findCount = (rows, key) => rows.find((r) => r._id === key)?.count || 0;
        return {
            requests: {
                total: requestsTotal,
                byStatus: requestStatusRows.map((r) => ({ status: r._id, count: r.count })),
            },
            orders: {
                total: ordersTotal,
                issued: findCount(orderStatusRows, shared_1.EStampOrderProcessingStatus.ISSUED),
                processing: orderStatusRows
                    .filter((r) => [shared_1.EStampOrderProcessingStatus.SUBMITTING, shared_1.EStampOrderProcessingStatus.SUBMITTED, shared_1.EStampOrderProcessingStatus.PROCESSING].includes(r._id))
                    .reduce((sum, r) => sum + r.count, 0),
                failed: findCount(orderStatusRows, shared_1.EStampOrderProcessingStatus.FAILED),
            },
            financial: {
                successfulPaymentsAmount: successfulPayments[0]?.amount || 0,
                successfulPaymentsCount: successfulPayments[0]?.count || 0,
                failedPaymentsCount: failedPayments,
                currentWalletBalance: wallet ? wallet.balance : null,
                requestValueTotal: requestValueAgg[0]?.total || 0,
            },
            organizations: orgCounts ? { total: orgCounts[0], active: orgCounts[1], inactive: orgCounts[0] - orgCounts[1] } : null,
        };
    },
    // Status/state/article distribution, a daily creation trend, and two
    // rate metrics over EStampRequest within [from, to]. Cancellation rate's
    // denominator is "requests created in range" (never all-time); the
    // modification rate's numerator counts DISTINCT requests (created in
    // range) that have at least one ESTAMP_REQUEST_MODIFIED audit event -
    // EStampRequest itself has no "was modified" flag, so this is derived
    // via AuditLog rather than a second state field.
    async getRequestReport({ organizationId, from, to, preset }) {
        const range = await resolveDateRange({ preset, from, to });
        const match = { createdAt: { $gte: range.from, $lte: range.to } };
        if (organizationId)
            match.organizationId = toOrgId(organizationId);
        const [statusRows, stateRows, articleRows, dailyRows, idsInRange] = await Promise.all([
            models_1.EStampRequest.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
            models_1.EStampRequest.aggregate([{ $match: match }, { $group: { _id: "$stateCode", count: { $sum: 1 } } }]),
            models_1.EStampRequest.aggregate([{ $match: match }, { $group: { _id: "$articleId", count: { $sum: 1 } } }]),
            models_1.EStampRequest.aggregate([
                { $match: match },
                { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ]),
            models_1.EStampRequest.find(match).select("_id status").lean(),
        ]);
        const total = idsInRange.length;
        const cancelledCount = idsInRange.filter((r) => r.status === shared_1.EStampRequestStatus.CANCELLED).length;
        let modificationRate = null;
        if (total > 0) {
            const idStrings = idsInRange.map((r) => r._id.toString());
            const modifiedIds = await models_1.AuditLog.distinct("entityId", {
                action: shared_1.AuditAction.ESTAMP_REQUEST_MODIFIED,
                entityType: "EStampRequest",
                entityId: { $in: idStrings },
            });
            modificationRate = safeRate(modifiedIds.length, total);
        }
        return {
            from: range.from,
            to: range.to,
            total,
            statusDistribution: statusRows.map((r) => ({ status: r._id, count: r.count })),
            stateDistribution: stateRows.map((r) => ({ stateCode: r._id, count: r.count })),
            articleDistribution: articleRows.map((r) => ({ articleId: r._id, count: r.count })),
            dailyTrend: dailyRows.map((r) => ({ date: r._id, count: r.count })),
            cancellationRate: safeRate(cancelledCount, total),
            modificationRate,
        };
    },
    // Delegates the totals/breakdown pipeline entirely to
    // EStampProviderService.getUsage (same date validation, same explicit
    // match whitelist) - never re-implements that aggregation. Adds three
    // things getUsage does not compute: issuance success rate (denominator
    // is issued+failed, NEVER totalOrders - a large `processing` bucket
    // must not dilute this rate), retry-count stats, and timing metrics
    // computed only from orders that actually have both relevant
    // timestamps set.
    async getOrderReport({ organizationId, from, to, preset, groupBy, stateCode, articleId, status }) {
        let rangeArgs = { organizationId, stateCode, articleId, status, groupBy };
        if (preset) {
            const range = await resolveDateRange({ preset });
            rangeArgs = { ...rangeArgs, from: range.from.toISOString(), to: range.to.toISOString() };
        }
        else {
            rangeArgs = { ...rangeArgs, from, to };
        }
        const usage = await estamp_provider_service_1.EStampProviderService.getUsage(rangeArgs);
        // Re-derive the exact same explicit whitelist match getUsage used
        // internally (mirrors its own construction) so the supplementary
        // aggregates below are computed over the identical document set -
        // never a looser/different filter.
        const match = { createdAt: { $gte: usage.from, $lte: usage.to } };
        if (organizationId)
            match.organizationId = toOrgId(organizationId);
        if (stateCode)
            match.stateCode = String(stateCode).toUpperCase();
        if (articleId)
            match.articleId = toArticleId(articleId);
        if (status && Object.values(shared_1.OrderStatus).includes(status))
            match.status = status;
        const timingPipeline = (fromField, toField) => [
            { $match: { ...match, [fromField]: { $ne: null }, [toField]: { $ne: null } } },
            { $project: { diffMs: { $subtract: [`$${toField}`, `$${fromField}`] } } },
            { $group: { _id: null, avgMs: { $avg: "$diffMs" }, sampleSize: { $sum: 1 } } },
        ];
        const [retryAggResult, submittedToIssued, createdToSubmitted, createdToIssued] = await Promise.all([
            models_1.EStampOrder.aggregate([{ $match: match }, { $group: { _id: null, avgRetryCount: { $avg: "$retryCount" }, maxRetryCount: { $max: "$retryCount" } } }]),
            models_1.EStampOrder.aggregate(timingPipeline("submittedAt", "issuedAt")),
            models_1.EStampOrder.aggregate(timingPipeline("createdAt", "submittedAt")),
            models_1.EStampOrder.aggregate(timingPipeline("createdAt", "issuedAt")),
        ]);
        const toTimingResult = (rows) => {
            const row = rows[0];
            if (!row || !row.sampleSize)
                return { avgSeconds: null, sampleSize: 0 };
            return { avgSeconds: row.avgMs / 1000, sampleSize: row.sampleSize };
        };
        const retryAgg = retryAggResult[0];
        return {
            from: usage.from,
            to: usage.to,
            totals: usage.totals,
            groupBy: usage.groupBy,
            breakdown: usage.breakdown,
            // Denominator is deliberately issued+failed, NOT totals.totalOrders -
            // orders still `processing` haven't succeeded or failed yet and would
            // misleadingly dilute this rate if included.
            issuanceSuccessRate: safeRate(usage.totals.issued, usage.totals.issued + usage.totals.failed),
            retryStats: {
                avg: retryAgg ? retryAgg.avgRetryCount : 0,
                max: retryAgg ? retryAgg.maxRetryCount : 0,
            },
            timing: {
                submittedToIssuedSeconds: toTimingResult(submittedToIssued),
                createdToSubmittedSeconds: toTimingResult(createdToSubmitted),
                createdToIssuedSeconds: toTimingResult(createdToIssued),
            },
        };
    },
    // Financial sources are kept STRICTLY separate - never conflated into a
    // single "revenue" number (no such concept exists in this data model):
    //  - payments: actual Razorpay money-in events (Payment.status)
    //  - wallet: the CURRENT authoritative balance (Wallet.balance, never
    //    recomputed by summing transactions)
    //  - walletTransactions: ledger VOLUME within the range (never used for
    //    "current balance")
    //  - requestValue: sum of calculatedStampDuty on EStampRequest (what
    //    clients were charged/quoted for stamps - independent of whether a
    //    Payment or an order's own `amount` matches it)
    async getFinancialReport({ organizationId, from, to, preset }) {
        const range = await resolveDateRange({ preset, from, to });
        const match = { createdAt: { $gte: range.from, $lte: range.to } };
        if (organizationId)
            match.organizationId = toOrgId(organizationId);
        const [paymentRows, walletTxRows, requestValueAgg, wallet] = await Promise.all([
            models_1.Payment.aggregate([{ $match: match }, { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
            models_1.WalletTransaction.aggregate([{ $match: match }, { $group: { _id: "$type", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
            models_1.EStampRequest.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: "$calculatedStampDuty" }, count: { $sum: 1 } } }]),
            organizationId ? models_1.Wallet.findOne({ organizationId: toOrgId(organizationId) }) : Promise.resolve(null),
        ]);
        const findRow = (rows, key) => rows.find((r) => r._id === key);
        const successRow = findRow(paymentRows, shared_1.PaymentStatus.SUCCESS);
        const failedRow = findRow(paymentRows, shared_1.PaymentStatus.FAILED);
        const creditRow = findRow(walletTxRows, shared_1.WalletTransactionType.CREDIT);
        const debitRow = findRow(walletTxRows, shared_1.WalletTransactionType.DEBIT);
        return {
            from: range.from,
            to: range.to,
            payments: {
                successfulAmount: successRow?.amount || 0,
                successfulCount: successRow?.count || 0,
                failedAmount: failedRow?.amount || 0,
                failedCount: failedRow?.count || 0,
            },
            // Only meaningful for a single organization - a global financial
            // report has no single "current balance" (see getOrganizationReport
            // for the per-org breakdown). `null` also covers the (unusual)
            // case where the organization has no Wallet document yet -
            // never fabricated as a real zero balance, consistent with
            // getDashboardSummary's same convention.
            wallet: { currentBalance: organizationId ? (wallet ? wallet.balance : null) : null },
            walletTransactions: {
                totalCredits: creditRow?.amount || 0,
                totalDebits: debitRow?.amount || 0,
                creditCount: creditRow?.count || 0,
                debitCount: debitRow?.count || 0,
            },
            requestValue: {
                totalCalculatedStampDuty: requestValueAgg[0]?.total || 0,
                count: requestValueAgg[0]?.count || 0,
            },
        };
    },
    // MASTER_ADMIN / REPORT_GLOBAL_VIEW only (enforced by the controller) -
    // a paginated, per-organization roll-up. Explicit sort-field whitelist
    // and a bounded limit, matching order.controller.js's listOrders.
    async getOrganizationReport({ page = "1", limit = "20", sortBy = "createdAt", sortDir = "desc", status }) {
        const SORT_FIELDS = ["name", "createdAt", "status"];
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
        const sortField = SORT_FIELDS.includes(sortBy) ? sortBy : "createdAt";
        const sortOrder = sortDir === "asc" ? 1 : -1;
        const filter = {};
        if (status) {
            if (!Object.values(shared_1.OrganizationStatus).includes(status))
                throw ApiError_1.ApiError.badRequest("Invalid status filter", "INVALID_STATUS");
            filter.status = status;
        }
        const [orgs, total] = await Promise.all([
            models_1.Organization.find(filter)
                .sort({ [sortField]: sortOrder })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum),
            models_1.Organization.countDocuments(filter),
        ]);
        const orgIds = orgs.map((o) => o._id);
        const [requestCounts, orderCounts, wallets] = await Promise.all([
            models_1.EStampRequest.aggregate([{ $match: { organizationId: { $in: orgIds } } }, { $group: { _id: "$organizationId", count: { $sum: 1 } } }]),
            models_1.EStampOrder.aggregate([{ $match: { organizationId: { $in: orgIds } } }, { $group: { _id: "$organizationId", count: { $sum: 1 } } }]),
            models_1.Wallet.find({ organizationId: { $in: orgIds } }),
        ]);
        const requestCountMap = new Map(requestCounts.map((r) => [r._id.toString(), r.count]));
        const orderCountMap = new Map(orderCounts.map((r) => [r._id.toString(), r.count]));
        const walletMap = new Map(wallets.map((w) => [w.organizationId.toString(), w.balance]));
        const items = orgs.map((o) => ({
            _id: o._id,
            name: o.name,
            status: o.status,
            isEstampServiceEnabled: o.isEstampServiceEnabled,
            createdAt: o.createdAt,
            requestCount: requestCountMap.get(o._id.toString()) || 0,
            orderCount: orderCountMap.get(o._id.toString()) || 0,
            // null (never a fabricated 0) when this organization has no
            // Wallet document yet - same convention as getFinancialReport.
            walletBalance: walletMap.has(o._id.toString()) ? walletMap.get(o._id.toString()) : null,
        }));
        return { items, total, page: pageNum, limit: limitNum };
    },
    // Batch/row/created-request counts from BulkEStampBatch, scoped and
    // date-ranged the same way as every other report here. These
    // createdRequests/totalStampDuty figures are the SAME underlying
    // EStampRequest documents viewed through their batch provenance - they
    // are deliberately never added on top of getRequestReport's totals
    // anywhere (that would double-count requests that happen to have come
    // from a bulk batch).
    async getBulkReport({ organizationId, from, to, preset }) {
        const range = await resolveDateRange({ preset, from, to });
        const match = { createdAt: { $gte: range.from, $lte: range.to } };
        if (organizationId)
            match.organizationId = toOrgId(organizationId);
        const [statusRows, totalsAgg] = await Promise.all([
            models_1.BulkEStampBatch.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
            models_1.BulkEStampBatch.aggregate([
                {
                    $match: match,
                },
                {
                    $group: {
                        _id: null,
                        batchCount: { $sum: 1 },
                        totalRows: { $sum: "$totalRows" },
                        validRows: { $sum: "$validRows" },
                        invalidRows: { $sum: "$invalidRows" },
                        createdRequests: { $sum: "$createdRequests" },
                        failedRows: { $sum: "$failedRows" },
                        totalStampDuty: { $sum: "$totalStampDuty" },
                    },
                },
            ]),
        ]);
        const totals = totalsAgg[0] || { batchCount: 0, totalRows: 0, validRows: 0, invalidRows: 0, createdRequests: 0, failedRows: 0, totalStampDuty: 0 };
        return {
            from: range.from,
            to: range.to,
            statusDistribution: statusRows.map((r) => ({ status: r._id, count: r.count })),
            totals,
        };
    },
    // Phase 21 - dashboard "recent activity" widgets. No existing endpoint
    // returns recent requests/orders in this exact shape - a bounded, most-
    // recent-first slice with the organization's NAME already joined in for
    // a global (Master Admin / REPORT_GLOBAL_VIEW) caller. A tenant-scoped
    // caller never gets the $lookup at all (there is only ever one
    // organization in that result set, so the join would be pure waste, and
    // more importantly this keeps the query shape identical to every other
    // report here - filter-then-scope, never a looser one for a "safe"
    // case). Limit is hard-bounded server-side - never client-controlled
    // beyond this ceiling, matching getOrganizationReport/getProviderReport's
    // own bounded-list convention.
    async getRecentActivity({ organizationId, isGlobal, limit = 5 }) {
        const lim = Math.min(10, Math.max(1, parseInt(limit, 10) || 5));
        const filter = organizationId ? { organizationId: toOrgId(organizationId) } : {};
        const withOrgName = (pipeline) => {
            if (!isGlobal)
                return pipeline;
            return [
                ...pipeline,
                { $lookup: { from: "organizations", localField: "organizationId", foreignField: "_id", as: "organization" } },
                { $unwind: { path: "$organization", preserveNullAndEmptyArrays: true } },
            ];
        };
        const requestPipeline = withOrgName([
            { $match: filter },
            { $sort: { createdAt: -1 } },
            { $limit: lim },
        ]);
        requestPipeline.push({
            $project: {
                _id: 1,
                requestNumber: 1,
                status: 1,
                calculatedStampDuty: 1,
                createdAt: 1,
                organizationId: 1,
                organizationName: isGlobal ? "$organization.name" : { $literal: null },
            },
        });
        const orderPipeline = withOrgName([
            { $match: filter },
            { $sort: { createdAt: -1 } },
            { $limit: lim },
        ]);
        orderPipeline.push({
            $project: {
                _id: 1,
                orderNumber: 1,
                eStampStatus: 1,
                status: 1,
                amount: 1,
                createdAt: 1,
                organizationId: 1,
                organizationName: isGlobal ? "$organization.name" : { $literal: null },
            },
        });
        const [requests, orders] = await Promise.all([
            models_1.EStampRequest.aggregate(requestPipeline),
            models_1.EStampOrder.aggregate(orderPipeline),
        ]);
        return { requests, orders };
    },
    // Wraps EStampProviderService.getLatestBalance() (never calls the
    // provider - serves the last snapshot only) plus a bounded balance
    // history. NEVER triggers refreshBalance() - that is a mutating,
    // provider-calling action forbidden from a read-only report.
    async getProviderReport({ from, to } = {}) {
        const filter = {};
        if (from || to) {
            filter.fetchedAt = {};
            if (from) {
                const f = new Date(from);
                if (Number.isNaN(f.getTime()))
                    throw ApiError_1.ApiError.badRequest("Invalid date range", "INVALID_DATE_RANGE");
                filter.fetchedAt.$gte = f;
            }
            if (to) {
                const t = new Date(to);
                if (Number.isNaN(t.getTime()))
                    throw ApiError_1.ApiError.badRequest("Invalid date range", "INVALID_DATE_RANGE");
                filter.fetchedAt.$lte = t;
            }
            if (filter.fetchedAt.$gte && filter.fetchedAt.$lte && filter.fetchedAt.$gte.getTime() > filter.fetchedAt.$lte.getTime()) {
                throw ApiError_1.ApiError.badRequest("`from` must not be after `to`", "INVALID_DATE_RANGE");
            }
        }
        const [current, history] = await Promise.all([
            estamp_provider_service_1.EStampProviderService.getLatestBalance(),
            models_1.EStampProviderBalanceSnapshot.find(filter).sort({ fetchedAt: -1 }).limit(50),
        ]);
        return { current, history };
    },
};
