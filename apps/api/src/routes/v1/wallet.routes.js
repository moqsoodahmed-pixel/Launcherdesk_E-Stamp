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
const ctrl = __importStar(require("../../controllers/wallet.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const shared_1 = require("@launcherdesk/shared");
const router = (0, express_1.Router)();
router.use(authenticate_1.authenticate);
router.get("/balance", ctrl.getBalance);
// The ledger exposes per-transaction detail, so it needs WALLET_VIEW (the
// plain balance stays available to request-creating roles, which read it on
// the New Request / Bulk Upload screens).
router.get("/transactions", (0, authorize_1.requirePermission)(shared_1.Permission.WALLET_VIEW), ctrl.listTransactions);
// Internal-only routes operating on a specific org's wallet. requireRole
// keeps this internal-only; requirePermission on top means an Assistant
// Master Admin only gets in if Master Admin actually granted the relevant
// wallet permission (Master Admin's own permission set always includes
// everything, so this is a no-op restriction for Master Admin).
router.get("/:organizationId/balance", (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN, shared_1.Role.ASSISTANT_MASTER_ADMIN), (0, authorize_1.requirePermission)(shared_1.Permission.WALLET_VIEW), ctrl.getBalance);
router.get("/:organizationId/transactions", (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN, shared_1.Role.ASSISTANT_MASTER_ADMIN), (0, authorize_1.requirePermission)(shared_1.Permission.WALLET_VIEW), ctrl.listTransactions);
router.post("/:organizationId/credit", (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN, shared_1.Role.ASSISTANT_MASTER_ADMIN), (0, authorize_1.requirePermission)(shared_1.Permission.WALLET_MANAGE), ctrl.manualCredit);
exports.default = router;