"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ctrl = __importStar(require("../../controllers/article.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const validate_1 = require("../../middleware/validate");
const validation_1 = require("@launcherdesk/validation");
const shared_1 = require("@launcherdesk/shared");
const router = (0, express_1.Router)();
router.use(authenticate_1.authenticate);
router.get("/", (0, authorize_1.requirePermission)(shared_1.Permission.ARTICLE_VIEW), ctrl.listArticles);
// Must be registered before "/:id" - otherwise Express would try to treat
// "states" as an :id path param.
router.get("/states", (0, authorize_1.requirePermission)(shared_1.Permission.ARTICLE_VIEW), ctrl.listStates);
router.get("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.ARTICLE_VIEW), ctrl.getArticle);
// Article/rule management requires ARTICLE_MANAGE. Master Admin always has
// it (all-permissions rule); Assistant Master Admin only if explicitly
// granted by Master Admin - never automatically by role.
router.post("/", (0, authorize_1.requirePermission)(shared_1.Permission.ARTICLE_MANAGE), (0, validate_1.validateBody)(validation_1.createArticleSchema), ctrl.createArticle);
router.patch("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.ARTICLE_MANAGE), (0, validate_1.validateBody)(validation_1.updateArticleSchema), ctrl.updateArticle);
router.patch("/:id/status", (0, authorize_1.requirePermission)(shared_1.Permission.ARTICLE_MANAGE), (0, validate_1.validateBody)(validation_1.setArticleStatusSchema), ctrl.setArticleStatus);
router.post("/:id/versions", (0, authorize_1.requirePermission)(shared_1.Permission.ARTICLE_MANAGE), (0, validate_1.validateBody)(validation_1.addArticleVersionSchema), ctrl.addArticleVersion);
exports.default = router;
