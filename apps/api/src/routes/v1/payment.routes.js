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
const ctrl = __importStar(require("../../controllers/payment.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const validate_1 = require("../../middleware/validate");
const validation_1 = require("@launcherdesk/validation");
const shared_1 = require("@launcherdesk/shared");
const rateLimiters_1 = require("../../middleware/rateLimiters");
const router = (0, express_1.Router)();
// Razorpay server-to-server webhook - deliberately registered BEFORE
// `router.use(authenticate)` below, so it is never subject to session
// authentication (Razorpay cannot present a LauncherDesk JWT). Its own
// signature verification (PaymentService.handleWebhook) is the only trust
// boundary for this route.
router.post("/webhook", ctrl.razorpayWebhook);
router.use(authenticate_1.authenticate);
router.post("/razorpay/order", rateLimiters_1.paymentLimiter, (0, authorize_1.requirePermission)(shared_1.Permission.PAYMENT_MANAGE), (0, validate_1.validateBody)(validation_1.createRazorpayOrderSchema), ctrl.createRazorpayOrder);
router.post("/razorpay/verify", rateLimiters_1.paymentLimiter, (0, authorize_1.requirePermission)(shared_1.Permission.PAYMENT_MANAGE), (0, validate_1.validateBody)(validation_1.verifyRazorpayPaymentSchema), ctrl.verifyRazorpayPayment);
router.get("/", (0, authorize_1.requirePermission)(shared_1.Permission.PAYMENT_VIEW), ctrl.listPayments);
router.get("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.PAYMENT_VIEW), ctrl.getPayment);
exports.default = router;
