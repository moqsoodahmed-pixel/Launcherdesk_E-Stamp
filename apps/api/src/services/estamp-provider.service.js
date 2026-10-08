"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EStampProviderService = void 0;
const mongoose_1 = require("mongoose");
const models_1 = require("../models");
const env_1 = require("../config/env");
const estamp_providers_1 = require("./estamp-providers");
const notification_service_1 = require("./notification.service");
const ApiError_1 = require("../utils/ApiError");
const shared_1 = require("@launcherdesk/shared");
const settings_service_1 = require("./settings.service");
// Phase 17 - was a hardcoded `366` literal duplicated independently in
// report.service.js's MAX_REPORT_RANGE_DAYS. Both now read the SAME live
// REPORT_MAX_DATE_RANGE_DAYS setting (settings.service.js), unifying what
// used to be two copies of one constant that could silently drift.
// Calls the provider abstraction and normalizes whatever happens into one of
// four honest states - NEVER a fabricated balance. "Unavailable"/"error" are
// distinct from a real zero balance, and are never conflated with it.
async function fetchProviderBalance() {
    let provider;
    try {
        provider = (0, estamp_providers_1.getEStampProvider)();
    }
    catch (err) {
        // getEStampProvider() itself throws when production has no real
        // provider configured (fail-closed) - that IS "not configured", not
        // a fetch error.
        return { status: "NOT_CONFIGURED", source: "error", errorMessage: safeMessage(err) };
    }
    try {
        const result = await provider.getBalance();
        return {
            status: "AVAILABLE",
            available: result.available,
            currency: result.currency,
            unit: result.unit,
            source: result.source || (provider.constructor?.name === "MockEStampProvider" ? "mock" : "real"),
        };
    }
    catch (err) {
        if (err?.code === "ESTAMP_PROVIDER_NOT_CONFIGURED") {
            return { status: "NOT_CONFIGURED", source: "error", errorMessage: safeMessage(err) };
        }
        return { status: "ERROR", source: "error", errorMessage: safeMessage(err) };
    }
}
// Only ever a short, safe, human-readable message - never a raw provider
// payload, stack trace, or anything that could carry a credential/secret.
function safeMessage(err) {
    const message = err?.message ? String(err.message) : "Unknown provider error";
    return message.slice(0, 300);
}
function toPublicSnapshot(snapshot) {
    if (!snapshot)
        return null;
    return {
        provider: snapshot.provider,
        status: snapshot.status,
        available: snapshot.available ?? null,
        currency: snapshot.currency ?? null,
        unit: snapshot.unit ?? null,
        source: snapshot.source,
        errorMessage: snapshot.errorMessage ?? null,
        fetchedAt: snapshot.fetchedAt,
    };
}
exports.EStampProviderService = {
    // Never calls the provider - serves the last fetched/refreshed snapshot,
    // or an honest "no fetch has ever been performed" state if none exists.
    async getLatestBalance() {
        const snapshot = await models_1.EStampProviderBalanceSnapshot.findOne().sort({ fetchedAt: -1 });
        if (!snapshot) {
            return { provider: env_1.env.ESTAMP_PROVIDER, status: "UNAVAILABLE", available: null, currency: null, unit: null, source: "none", errorMessage: "Balance has never been fetched. Use refresh to fetch it.", fetchedAt: null };
        }
        return toPublicSnapshot(snapshot);
    },
    // Explicitly triggers a provider call, stores the resulting snapshot
    // (successful or not - even a NOT_CONFIGURED/ERROR result is retained,
    // so history shows the provider was actually unavailable at that time
    // rather than silently skipping the record), and evaluates the
    // low-balance alert transition.
    async refreshBalance(actorId) {
        const previous = await models_1.EStampProviderBalanceSnapshot.findOne().sort({ fetchedAt: -1 });
        const result = await fetchProviderBalance();
        const snapshot = await models_1.EStampProviderBalanceSnapshot.create({
            provider: env_1.env.ESTAMP_PROVIDER,
            status: result.status,
            available: result.status === "AVAILABLE" ? result.available : undefined,
            currency: result.status === "AVAILABLE" ? result.currency : undefined,
            unit: result.status === "AVAILABLE" ? result.unit : undefined,
            source: result.source,
            errorMessage: result.errorMessage,
            fetchedAt: new Date(),
            fetchedBy: actorId || undefined,
        });
        await maybeNotifyLowBalance(previous, snapshot);
        return toPublicSnapshot(snapshot);
    },
    // Internal usage, derived entirely from EStampOrder/EStampRequest - this
    // is OUR data, not anything from the provider's own usage API (which
    // does not exist yet - see MockEStampProvider.getUsage/RealEStampProvider
    // for the placeholder interface method).
    async getUsage(filters) {
        const { from, to, organizationId, stateCode, articleId, status, groupBy } = filters;
        const now = new Date();
        const rangeTo = to ? new Date(to) : now;
        const rangeFrom = from ? new Date(from) : new Date(rangeTo.getTime() - 30 * 24 * 60 * 60 * 1000);
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
        // Explicit whitelist of matchable fields - never pass a client-supplied
        // filter object directly into MongoDB.
        const match = { createdAt: { $gte: rangeFrom, $lte: rangeTo } };
        if (organizationId)
            match.organizationId = new mongoose_1.Types.ObjectId(organizationId);
        if (stateCode)
            match.stateCode = String(stateCode).toUpperCase();
        if (articleId)
            match.articleId = new mongoose_1.Types.ObjectId(articleId);
        if (status && Object.values(shared_1.OrderStatus).includes(status))
            match.status = status;
        const totalsPipeline = [
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    issued: { $sum: { $cond: [{ $eq: ["$eStampStatus", shared_1.EStampOrderProcessingStatus.ISSUED] }, 1, 0] } },
                    processing: { $sum: { $cond: [{ $in: ["$eStampStatus", [shared_1.EStampOrderProcessingStatus.SUBMITTING, shared_1.EStampOrderProcessingStatus.SUBMITTED, shared_1.EStampOrderProcessingStatus.PROCESSING]] }, 1, 0] } },
                    failed: { $sum: { $cond: [{ $eq: ["$eStampStatus", shared_1.EStampOrderProcessingStatus.FAILED] }, 1, 0] } },
                    totalStampValue: { $sum: "$amount" },
                },
            },
        ];
        const [totalsResult] = await models_1.EStampOrder.aggregate(totalsPipeline);
        const totals = totalsResult
            ? { totalOrders: totalsResult.totalOrders, issued: totalsResult.issued, processing: totalsResult.processing, failed: totalsResult.failed, totalStampValue: totalsResult.totalStampValue }
            : { totalOrders: 0, issued: 0, processing: 0, failed: 0, totalStampValue: 0 };
        let breakdown = [];
        if (groupBy && ["organization", "state", "article"].includes(groupBy)) {
            const groupField = groupBy === "organization" ? "$organizationId" : groupBy === "state" ? "$stateCode" : "$articleId";
            const breakdownPipeline = [
                { $match: match },
                {
                    $group: {
                        _id: groupField,
                        totalOrders: { $sum: 1 },
                        issued: { $sum: { $cond: [{ $eq: ["$eStampStatus", shared_1.EStampOrderProcessingStatus.ISSUED] }, 1, 0] } },
                        processing: { $sum: { $cond: [{ $in: ["$eStampStatus", [shared_1.EStampOrderProcessingStatus.SUBMITTING, shared_1.EStampOrderProcessingStatus.SUBMITTED, shared_1.EStampOrderProcessingStatus.PROCESSING]] }, 1, 0] } },
                        failed: { $sum: { $cond: [{ $eq: ["$eStampStatus", shared_1.EStampOrderProcessingStatus.FAILED] }, 1, 0] } },
                        totalStampValue: { $sum: "$amount" },
                    },
                },
                { $sort: { totalOrders: -1 } },
            ];
            const rows = await models_1.EStampOrder.aggregate(breakdownPipeline);
            breakdown = rows.map((r) => ({ key: r._id, totalOrders: r.totalOrders, issued: r.issued, processing: r.processing, failed: r.failed, totalStampValue: r.totalStampValue }));
        }
        return { from: rangeFrom, to: rangeTo, totals, groupBy: groupBy || null, breakdown };
    },
};
// Edge-triggered: only notifies the FIRST time a refresh crosses from
// "not below threshold" (or unknown) to "below threshold". Repeated
// refreshes that stay below the threshold do not spam Master Admin again -
// this is intentionally simple (no scheduler, no dedup table) and relies
// entirely on comparing the two most recent snapshots.
async function maybeNotifyLowBalance(previous, current) {
    // Phase 17 - live setting (DB override if present and valid, else the
    // registry default which mirrors env.js's current default exactly).
    // Tri-state semantics preserved EXACTLY: null/undefined still means "no
    // threshold configured, never alert" - never coerced to/treated as 0.
    const threshold = await settings_service_1.SettingsService.getLowProviderBalanceThreshold();
    if (threshold === null || threshold === undefined)
        return;
    if (current.status !== "AVAILABLE" || current.available === undefined || current.available === null)
        return; // never alert on unavailable/error - that is not a "low balance"
    const currentlyLow = current.available <= threshold;
    if (!currentlyLow)
        return;
    const previouslyLow = previous && previous.status === "AVAILABLE" && previous.available !== undefined && previous.available !== null && previous.available <= threshold;
    if (previouslyLow)
        return; // already alerted on the previous refresh - no repeat spam
    await (0, notification_service_1.notifyAllMasterAdmins)({
        type: shared_1.NotificationType.SECURITY_ALERT,
        title: "E-Stamp provider balance is low",
        message: `The E-Stamp provider account balance (${current.available} ${current.currency || ""}) is at or below the configured threshold.`,
        metadata: { threshold, available: current.available, currency: current.currency },
    });
}
