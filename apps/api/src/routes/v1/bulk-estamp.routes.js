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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const ctrl = __importStar(require("../../controllers/bulk-estamp.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const requireFeatureEnabled_1 = require("../../middleware/requireFeatureEnabled");
const shared_1 = require("@launcherdesk/shared");
const env_1 = require("../../config/env");
const rateLimiters_1 = require("../../middleware/rateLimiters");
// Same memoryStorage + fileSize-limit pattern as file.routes.js - never
// written to disk, size-capped via BULK_ESTAMP_MAX_FILE_SIZE_MB.
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: env_1.env.BULK_ESTAMP_MAX_FILE_SIZE_MB * 1024 * 1024 } });
// Phase 17 - BULK_ESTAMP_ENABLED feature flag. Placed AFTER each route's own
// requirePermission check (not as a single router.use) so an unpermitted
// actor still gets a 403 first - permission is the primary gate, the
// feature flag is a secondary, honest "this is currently switched off" - a
// clear 503, never a confusing 404. Default true, matching today's
// always-on behavior.
const bulkFeatureGate = (0, requireFeatureEnabled_1.requireFeatureEnabled)("BULK_ESTAMP_ENABLED", "Bulk E-Stamp is currently disabled");
const router = (0, express_1.Router)();
router.use(authenticate_1.authenticate);
// GET /template is intentionally ungated beyond authentication - it is a
// static, non-tenant-specific file with no organization data in it. Still
// subject to the feature flag, since there is no point handing out the
// template while the feature itself is switched off.
router.get("/template", bulkFeatureGate, ctrl.downloadTemplate);
// requirePermission requires ALL listed permissions (no OR support) - every
// bulk route is gated on ESTAMP_BULK_CREATE alone, the single permission
// this phase introduces (see packages/shared/src/permissions.js).
router.post("/upload", rateLimiters_1.bulkUploadLimiter, (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_BULK_CREATE), bulkFeatureGate, upload.single("file"), ctrl.uploadBatch);
router.get("/", (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_BULK_CREATE), bulkFeatureGate, ctrl.listBatches);
router.get("/:batchId", (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_BULK_CREATE), bulkFeatureGate, ctrl.getBatchDetail);
router.get("/:batchId/preview", (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_BULK_CREATE), bulkFeatureGate, ctrl.getBatchPreview);
router.post("/:batchId/confirm", rateLimiters_1.bulkUploadLimiter, (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_BULK_CREATE), bulkFeatureGate, ctrl.confirmBatch);
router.post("/:batchId/cancel", (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_BULK_CREATE), bulkFeatureGate, ctrl.cancelBatch);
exports.default = router;
