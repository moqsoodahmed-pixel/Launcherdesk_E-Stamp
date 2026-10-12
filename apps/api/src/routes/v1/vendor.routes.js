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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.vendorSelfRouter = exports.vendorAdminRouter = void 0;
const express_1 = require("express");
const multer = require("multer");
const ctrl = __importStar(require("../../controllers/vendor.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const validate_1 = require("../../middleware/validate");
const rateLimiters_1 = require("../../middleware/rateLimiters");
const validation_1 = require("@launcherdesk/validation");
const shared_1 = require("@launcherdesk/shared");
const file_service_1 = require("../../services/file.service");
// Same outer size ceiling as every other upload; FileService.validate
// enforces the live limit and the executable-signature check.
const certificateUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: file_service_1.FileService.MULTER_CEILING_BYTES } });
// /vendors - Master Admin manages vendor accounts.
const vendorAdminRouter = (0, express_1.Router)();
vendorAdminRouter.use(authenticate_1.authenticate, (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN));
vendorAdminRouter.get("/", ctrl.listVendors);
vendorAdminRouter.post("/", (0, validate_1.validateBody)(validation_1.createVendorSchema), ctrl.createVendor);
vendorAdminRouter.post("/:id/reset-password", rateLimiters_1.vendorAdminLimiter, ctrl.resetVendorPassword);
vendorAdminRouter.delete("/:id", rateLimiters_1.vendorAdminLimiter, ctrl.deleteVendor);
vendorAdminRouter.patch("/:id/status", (0, validate_1.validateBody)(validation_1.updateVendorStatusSchema), ctrl.updateVendorStatus);
exports.vendorAdminRouter = vendorAdminRouter;
// /vendor - the vendor's own surface. requireRole(VENDOR) here; every
// controller additionally scopes to vendorId = req.user.id.
const vendorSelfRouter = (0, express_1.Router)();
vendorSelfRouter.use(authenticate_1.authenticate, (0, authorize_1.requireRole)(shared_1.Role.VENDOR));
vendorSelfRouter.get("/orders", ctrl.listMyOrders);
vendorSelfRouter.get("/orders/summary", ctrl.getMySummary);
vendorSelfRouter.get("/orders/:id", ctrl.getMyOrder);
vendorSelfRouter.get("/orders/:id/files/:fileId", ctrl.getMyOrderFile);
vendorSelfRouter.post("/orders/:id/accept", ctrl.acceptMyOrder);
vendorSelfRouter.post("/orders/:id/upload", rateLimiters_1.vendorUploadLimiter, certificateUpload.single("file"), ctrl.uploadMyOrder);
vendorSelfRouter.post("/orders/:id/cannot-process", (0, validate_1.validateBody)(validation_1.vendorCannotProcessSchema), ctrl.cannotProcessMyOrder);
exports.vendorSelfRouter = vendorSelfRouter;
