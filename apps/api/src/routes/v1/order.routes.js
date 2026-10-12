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
const ctrl = __importStar(require("../../controllers/order.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const shared_1 = require("@launcherdesk/shared");
const rateLimiters_1 = require("../../middleware/rateLimiters");
const fulfilmentMode_1 = require("../../middleware/fulfilmentMode");
const multer = require("multer");
const file_service_1 = require("../../services/file.service");
const validate_1 = require("../../middleware/validate");
const validation_1 = require("@launcherdesk/validation");
// Certificate upload for manual fulfilment: same outer size ceiling as
// /files/upload; FileService.validate enforces the live limit, MIME
// allowlist and executable-signature check.
const certificateUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: file_service_1.FileService.MULTER_CEILING_BYTES } });
const providerOnly = (0, fulfilmentMode_1.requireFulfilmentMode)("provider");
const manualOnly = (0, fulfilmentMode_1.requireFulfilmentMode)("manual");
// Only LauncherDesk staff ever fulfil orders - never a client role, even if
// it were granted ORDER_MANAGE.
const staffOnly = (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN, shared_1.Role.ASSISTANT_MASTER_ADMIN);
const router = (0, express_1.Router)();
// E-Stamp provider webhook - registered BEFORE authenticate below, so it is
// never subject to session authentication (the provider cannot present a
// LauncherDesk JWT). Its own signature verification is the only trust
// boundary for this route (see order.controller.providerWebhook).
router.post("/webhook/:provider", (0, fulfilmentMode_1.requireFulfilmentMode)("provider", { goneStatus: true }), ctrl.providerWebhook);
router.use(authenticate_1.authenticate);
router.get("/", (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_VIEW), ctrl.listOrders);
router.get("/summary", (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_VIEW), ctrl.getOrderSummary);
// Vendor dispatch/review (assigned assistant or Master Admin; scope checked
// in the controller). Registered before "/:id" so the literal paths win.
router.get("/vendors", staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), manualOnly, ctrl.listDispatchVendors);
router.post("/dispatch", staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), manualOnly, (0, validate_1.validateBody)(validation_1.dispatchOrdersSchema), ctrl.dispatchOrders);
router.post("/vendor-approve-many", staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), manualOnly, (0, validate_1.validateBody)(validation_1.vendorApproveManySchema), ctrl.vendorApproveMany);
router.get("/fulfilment-summary", staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_VIEW), ctrl.getFulfilmentSummary);
router.get("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_VIEW), ctrl.getOrder);
router.post("/:id/verify-documents", (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_VIEW), ctrl.verifyDocuments);
// Operational processing actions - permission-gated (ORDER_MANAGE), not
// role-only. Master Admin has it implicitly (all permissions); an Assistant
// Master Admin only if Master Admin explicitly grants it; no client role
// has ORDER_MANAGE by default.
router.post("/:id/process", (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), providerOnly, ctrl.processOrder);
router.post("/:id/sync", rateLimiters_1.providerSyncLimiter, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), providerOnly, ctrl.syncOrder);
router.post("/:id/retry", rateLimiters_1.providerSyncLimiter, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), providerOnly, ctrl.retryOrder);
// Manual fulfilment (assigned assistant or Master Admin; checked in the controller).
router.post("/:id/start", staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), manualOnly, ctrl.startFulfilment);
router.post("/:id/fulfil", rateLimiters_1.documentUploadLimiter, staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), manualOnly, certificateUpload.single("file"), ctrl.fulfilOrder);
router.post("/:id/fail", staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), manualOnly, ctrl.failOrder);
router.post("/:id/recall", staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), manualOnly, ctrl.recallOrder);
router.get("/:id/vendor-upload", staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), ctrl.getVendorUpload);
router.post("/:id/vendor-approve", staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), manualOnly, ctrl.vendorApproveOrder);
router.post("/:id/vendor-reject", staffOnly, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), manualOnly, (0, validate_1.validateBody)(validation_1.vendorRejectSchema), ctrl.vendorRejectOrder);
exports.default = router;
