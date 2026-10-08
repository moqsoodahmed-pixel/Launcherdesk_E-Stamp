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
const ctrl = __importStar(require("../../controllers/estamp-request.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const validate_1 = require("../../middleware/validate");
const validation_1 = require("@launcherdesk/validation");
const shared_1 = require("@launcherdesk/shared");
const router = (0, express_1.Router)();
router.use(authenticate_1.authenticate);
router.post("/", (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_CREATE), (0, validate_1.validateBody)(validation_1.createEStampRequestSchema), ctrl.createRequest);
// Preview only - never creates a request, debits the wallet, or touches an
// order. Gated the same as creation since it's part of the same flow.
router.post("/calculate", (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_CREATE), (0, validate_1.validateBody)(validation_1.calculatePreviewSchema), ctrl.previewCalculation);
router.get("/", (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_VIEW), ctrl.listRequests);
router.get("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_VIEW), ctrl.getRequest);
router.patch("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_MODIFY), (0, validate_1.validateBody)(validation_1.updateEStampRequestSchema), ctrl.modifyRequest);
router.post("/:id/cancel", (0, authorize_1.requirePermission)(shared_1.Permission.ESTAMP_CANCEL), ctrl.cancelRequest);
exports.default = router;
