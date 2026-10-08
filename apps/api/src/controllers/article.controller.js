"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setArticleStatus = exports.updateArticle = exports.addArticleVersion = exports.createArticle = exports.getArticle = exports.listArticles = exports.listStates = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const audit_service_1 = require("../services/audit.service");
const notification_service_1 = require("../services/notification.service");
const shared_1 = require("@launcherdesk/shared");
function isInternalActor(req) {
    return req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
async function notifyAssistantArticleAction(req, article, title, message) {
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, notification_service_1.notifyAllMasterAdmins)({
            type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
            title,
            message,
            relatedActorId: req.user.id,
        });
    }
}
// READ endpoints are available to all authenticated users (client roles get
// active-only, state-scoped, informational data only - never rule internals
// beyond what's needed to select an article and see its current rule).
// WRITE endpoints require the ARTICLE_MANAGE permission (Master Admin has it
// implicitly via the all-permissions rule; Assistant Master Admin only if
// explicitly granted - see permissions.js).
// Phase 22 - smallest possible backend extension: the E-Stamp request
// wizard needs the real list of states that currently have at least one
// active Article (rather than a hardcoded KA/MH/DL list on the frontend).
// Articles are platform-wide reference data (no organizationId on the
// model), so this is intentionally NOT tenant-scoped, matching
// listArticles' own active-only default for non-internal callers. Gated
// by the same ARTICLE_VIEW permission as every other read endpoint here.
exports.listStates = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const stateCodes = await models_1.Article.distinct("stateCode", { isActive: true });
    return (0, ApiResponse_1.ok)(res, stateCodes.sort());
});
exports.listArticles = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { stateCode, search } = req.query;
    const filter = {};
    const internal = isInternalActor(req);
    // Client roles only ever see active articles - an inactive one must not
    // even be discoverable for new request creation. Internal roles may
    // explicitly ask for inactive ones too (article management needs to see
    // everything), defaulting to active-only if unspecified.
    if (!internal) {
        filter.isActive = true;
    }
    else if (req.query.isActive !== undefined) {
        filter.isActive = req.query.isActive === "true";
    }
    if (stateCode)
        filter.stateCode = stateCode.toUpperCase();
    if (search)
        filter.title = { $regex: search, $options: "i" };
    if (internal && (req.query.page || req.query.limit)) {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const [items, total] = await Promise.all([
            models_1.Article.find(filter)
                .sort({ stateCode: 1, articleCode: 1 })
                .skip((page - 1) * limit)
                .limit(limit),
            models_1.Article.countDocuments(filter),
        ]);
        return (0, ApiResponse_1.ok)(res, { items, total, page, limit });
    }
    const articles = await models_1.Article.find(filter).sort({ stateCode: 1, articleCode: 1 });
    return (0, ApiResponse_1.ok)(res, articles);
});
exports.getArticle = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const article = await models_1.Article.findById(req.params.id);
    if (!article)
        throw ApiError_1.ApiError.notFound("Article not found");
    if (req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
        await (0, audit_service_1.recordAudit)({
            actorId: req.user.id,
            actorRole: req.user.role,
            organizationId: req.user.organizationId,
            action: shared_1.AuditAction.ARTICLE_ACCESSED,
            entityType: "Article",
            entityId: article._id.toString(),
            req,
        });
    }
    return (0, ApiResponse_1.ok)(res, article);
});
exports.createArticle = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { stateCode, articleCode, title, description, calculationRule } = req.body;
    let article;
    try {
        article = await models_1.Article.create({ stateCode, articleCode, title, description, createdBy: req.user.id, currentVersion: 1 });
    }
    catch (err) {
        if (err?.code === 11000) {
            throw ApiError_1.ApiError.conflict("An article with this code already exists for this state");
        }
        throw err;
    }
    await models_1.ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule, createdBy: req.user.id });
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.ARTICLE_MANAGED,
        entityType: "Article",
        entityId: article._id.toString(),
        metadata: { action: "created", stateCode: article.stateCode, articleCode: article.articleCode },
        req,
    });
    await notifyAssistantArticleAction(req, article, "Article created", `Assistant Master Admin created article ${article.articleCode} (${article.stateCode}).`);
    return (0, ApiResponse_1.created)(res, article);
});
// Edits Article-level metadata only (title/description) - never the
// calculation rule, which always goes through a new ArticleVersion instead
// so past calculations remain historically correct.
exports.updateArticle = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const article = await models_1.Article.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!article)
        throw ApiError_1.ApiError.notFound("Article not found");
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.ARTICLE_MANAGED,
        entityType: "Article",
        entityId: article._id.toString(),
        metadata: { action: "updated", updatedFields: Object.keys(req.body) },
        req,
    });
    await notifyAssistantArticleAction(req, article, "Article updated", `Assistant Master Admin updated article ${article.articleCode} (${article.stateCode}).`);
    return (0, ApiResponse_1.ok)(res, article);
});
// Activate/deactivate. Never deletes the record - historical requests keep
// referencing this article and its stored articleVersionUsed/calculatedStampDuty
// regardless of its current active state.
exports.setArticleStatus = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const article = await models_1.Article.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive }, { new: true });
    if (!article)
        throw ApiError_1.ApiError.notFound("Article not found");
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.ARTICLE_MANAGED,
        entityType: "Article",
        entityId: article._id.toString(),
        metadata: { action: article.isActive ? "activated" : "deactivated" },
        req,
    });
    await notifyAssistantArticleAction(req, article, article.isActive ? "Article activated" : "Article deactivated", `Assistant Master Admin ${article.isActive ? "activated" : "deactivated"} article ${article.articleCode} (${article.stateCode}).`);
    return (0, ApiResponse_1.ok)(res, article);
});
// Adds a new version (new calculation rule) rather than mutating history -
// keeps Articles versionable as required. effectiveFrom may be in the
// future; CalculationService will not use it until that date arrives.
exports.addArticleVersion = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const article = await models_1.Article.findById(req.params.id);
    if (!article)
        throw ApiError_1.ApiError.notFound("Article not found");
    const nextVersion = article.currentVersion + 1;
    const version = await models_1.ArticleVersion.create({
        articleId: article._id,
        versionNumber: nextVersion,
        calculationRule: req.body.calculationRule,
        effectiveFrom: req.body.effectiveFrom,
        effectiveTo: req.body.effectiveTo,
        createdBy: req.user.id,
    });
    article.currentVersion = nextVersion;
    await article.save();
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.ARTICLE_MANAGED,
        entityType: "Article",
        entityId: article._id.toString(),
        metadata: { action: "new_version", newVersion: nextVersion, effectiveFrom: version.effectiveFrom },
        req,
    });
    await notifyAssistantArticleAction(req, article, "Article rule version created", `Assistant Master Admin created a new calculation rule version for article ${article.articleCode} (${article.stateCode}).`);
    return (0, ApiResponse_1.ok)(res, article);
});
