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
const router = (0, express_1.Router)();
// E-Stamp provider webhook - registered BEFORE authenticate below, so it is
// never subject to session authentication (the provider cannot present a
// LauncherDesk JWT). Its own signature verification is the only trust
// boundary for this route (see order.controller.providerWebhook).
router.post("/webhook/:provider", ctrl.providerWebhook);
router.use(authenticate_1.authenticate);
router.get("/", (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_VIEW), ctrl.listOrders);
router.get("/summary", (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_VIEW), ctrl.getOrderSummary);
router.get("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_VIEW), ctrl.getOrder);
// Operational processing actions - permission-gated (ORDER_MANAGE), not
// role-only. Master Admin has it implicitly (all permissions); an Assistant
// Master Admin only if Master Admin explicitly grants it; no client role
// has ORDER_MANAGE by default.
router.post("/:id/process", (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), ctrl.processOrder);
router.post("/:id/sync", rateLimiters_1.providerSyncLimiter, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), ctrl.syncOrder);
router.post("/:id/retry", rateLimiters_1.providerSyncLimiter, (0, authorize_1.requirePermission)(shared_1.Permission.ORDER_MANAGE), ctrl.retryOrder);
exports.default = router;
