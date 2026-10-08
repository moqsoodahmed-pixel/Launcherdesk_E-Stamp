"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArticleVersion = exports.Article = void 0;
const mongoose_1 = require("mongoose");
const articleSchema = new mongoose_1.Schema({
    stateCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    articleCode: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    currentVersion: { type: Number, default: 1 },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
articleSchema.index({ stateCode: 1, articleCode: 1 }, { unique: true });
// Supports the Master Admin article list's state + active/inactive filter.
articleSchema.index({ stateCode: 1, isActive: 1 });
const articleVersionSchema = new mongoose_1.Schema({
    articleId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Article", required: true, index: true },
    versionNumber: { type: Number, required: true },
    calculationRule: { type: mongoose_1.Schema.Types.Mixed, required: true },
    effectiveFrom: { type: Date, required: true, default: () => new Date() },
    effectiveTo: { type: Date, default: null },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
articleVersionSchema.index({ articleId: 1, versionNumber: 1 }, { unique: true });
// Supports CalculationService resolving "the version effective right now" -
// most recent effectiveFrom for a given article.
articleVersionSchema.index({ articleId: 1, effectiveFrom: -1 });
exports.Article = (0, mongoose_1.model)("Article", articleSchema);
exports.ArticleVersion = (0, mongoose_1.model)("ArticleVersion", articleVersionSchema);
