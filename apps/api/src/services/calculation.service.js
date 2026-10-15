"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalculationService = void 0;
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
exports.CalculationService = {
    // Resolves the ArticleVersion that is actually effective at `asOf`
    // (defaults to now). This is NOT simply "the latest version" -
    // versionNumber can be ahead of effectiveFrom (e.g. Master Admin
    // pre-publishing a future rate change), so a future-dated version must
    // never be picked before its effectiveFrom, and an expired version
    // (effectiveTo in the past) must never be picked after it lapses.
    async resolveEffectiveVersion(articleId, asOf = new Date()) {
        return models_1.ArticleVersion.findOne({
            articleId,
            effectiveFrom: { $lte: asOf },
            $or: [{ effectiveTo: null }, { effectiveTo: { $gt: asOf } }],
        }).sort({ effectiveFrom: -1 });
    },
    async calculate(input) {
        const article = await models_1.Article.findOne({ _id: input.articleId, stateCode: input.stateCode.toUpperCase(), isActive: true });
        if (!article)
            throw ApiError_1.ApiError.badRequest("Article not found for the selected state", "ARTICLE_NOT_FOUND");
        const version = await this.resolveEffectiveVersion(article._id, input.asOf);
        if (!version)
            throw ApiError_1.ApiError.internal("Article has no active calculation rule configured");
        const rule = version.calculationRule;
        // manualStampDuty (bulk-upload only - see bulk-estamp.service.js) lets
        // the filer enter the duty amount directly instead of it being derived
        // from a %/slab formula against considerationPrice. A FIXED-rule
        // article is NEVER affected by this - its duty is always the
        // article's own fixed amount, exactly as when manualStampDuty is
        // absent, so a filer cannot override a fixed government rate by
        // typing a different number into the bulk template.
        const hasManualStampDuty = input.manualStampDuty !== undefined && input.manualStampDuty !== null;
        let perStampAmount = 0;
        switch (rule.type) {
            case "FIXED":
                perStampAmount = rule.fixedAmount ?? 0;
                break;
            case "PERCENTAGE":
                perStampAmount = hasManualStampDuty
                    ? Number(input.manualStampDuty) || 0
                    : (input.considerationPrice * (rule.percentage ?? 0)) / 100;
                break;
            case "SLAB": {
                if (hasManualStampDuty) {
                    perStampAmount = Number(input.manualStampDuty) || 0;
                }
                else {
                    const slab = (rule.slabs || []).find((s) => input.considerationPrice >= s.minValue && (s.maxValue === null || input.considerationPrice <= s.maxValue));
                    perStampAmount = slab?.amount ?? 0;
                }
                break;
            }
            case "CUSTOM":
                // No official formula is configured for this article - rather than
                // guess, the filer enters the real government-prescribed duty
                // themselves (the frontend labels this input "Stamp Duty", not
                // "Consideration Price", for exactly this rule type). A value of
                // 0 here means nothing has been entered yet, not a free stamp -
                // the preview/review screens already treat 0 as "At Actuals".
                perStampAmount = hasManualStampDuty ? Number(input.manualStampDuty) || 0 : Number(input.considerationPrice) || 0;
                break;
            default:
                throw ApiError_1.ApiError.internal("Unknown calculation rule type");
        }
        if (rule.minAmount !== undefined)
            perStampAmount = Math.max(perStampAmount, rule.minAmount);
        if (rule.maxAmount !== undefined)
            perStampAmount = Math.min(perStampAmount, rule.maxAmount);
        // additionalAmount (bulk-upload only) is a deliberate top-up on top of
        // the computed/fixed duty - e.g. to pay more than a FIXED article's
        // non-negotiable minimum - so it is added AFTER the min/max clamp and
        // is never itself clamped.
        const additionalAmount = Number(input.additionalAmount) || 0;
        const total = Math.round((perStampAmount * input.numberOfEStamps + additionalAmount) * 100) / 100;
        // The version NUMBER that was actually used, not article.currentVersion -
        // they can differ (a future-dated version bumps currentVersion
        // immediately but must not be usable for calculation until its
        // effectiveFrom arrives). This is what gets stored on the request for
        // permanent historical reference.
        return { amount: total, articleVersionUsed: version.versionNumber };
    },
};
