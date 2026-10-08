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
const ctrl = __importStar(require("../../controllers/report.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const requireFeatureEnabled_1 = require("../../middleware/requireFeatureEnabled");
const shared_1 = require("@launcherdesk/shared");
const router = (0, express_1.Router)();
router.use(authenticate_1.authenticate);
// Base gate for the entire reporting surface - matches the existing
// single-permission-per-route-group convention (see
// estamp-provider.routes.js). Three routes below layer an ADDITIONAL inline
// permission check on top of this (REPORT_FINANCIAL_VIEW for /financial,
// REPORT_GLOBAL_VIEW for /organizations, ESTAMP_PROVIDER_VIEW for
// /provider) - requirePermission() only supports a single permission per
// call (an AND, not an OR, if stacked), so those extra checks live inside
// the controller itself, the same pattern already used by
// file.controller.js's inline ORDER_MANAGE check for certificate uploads.
router.use((0, authorize_1.requirePermission)(shared_1.Permission.REPORT_VIEW));
// Phase 17 - REPORTS_ENABLED feature flag, checked AFTER the permission gate
// so an unpermitted actor still gets a 403 first. Default true, matching
// today's always-on behavior. Gates the whole reporting surface (dashboard/
// summary/requests/orders/financial/organizations/bulk/provider) with one
// honest 503, never a confusing 404.
router.use((0, requireFeatureEnabled_1.requireFeatureEnabled)("REPORTS_ENABLED", "Reports are currently disabled"));
router.get("/dashboard", ctrl.getDashboard);
// Phase 1 endpoint, preserved as-is for DashboardPage.jsx backward
// compatibility - see report.controller.js's getSummary for why its scope
// rule is intentionally NOT the same as every other route here.
router.get("/summary", ctrl.getSummary);
router.get("/requests", ctrl.getRequests);
router.get("/orders", ctrl.getOrders);
router.get("/financial", ctrl.getFinancial);
router.get("/organizations", ctrl.getOrganizations);
router.get("/bulk", ctrl.getBulk);
router.get("/recent-activity", ctrl.getRecentActivity);
router.get("/provider", ctrl.getProvider);
exports.default = router;
