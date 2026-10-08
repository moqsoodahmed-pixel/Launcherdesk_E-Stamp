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
const ctrl = __importStar(require("../../controllers/organization.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const validate_1 = require("../../middleware/validate");
const validation_1 = require("@launcherdesk/validation");
const shared_1 = require("@launcherdesk/shared");
const router = (0, express_1.Router)();
router.use(authenticate_1.authenticate, (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN, shared_1.Role.ASSISTANT_MASTER_ADMIN));
router.post("/", (0, authorize_1.requirePermission)(shared_1.Permission.CLIENT_MANAGE), (0, validate_1.validateBody)(validation_1.createOrganizationSchema), ctrl.createOrganization);
router.get("/", (0, authorize_1.requirePermission)(shared_1.Permission.CLIENT_VIEW), ctrl.listOrganizations);
router.get("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.CLIENT_VIEW), ctrl.getOrganization);
router.patch("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.CLIENT_MANAGE), (0, validate_1.validateBody)(validation_1.updateOrganizationSchema), ctrl.updateOrganization);
// Activate/deactivate/suspend/restrict and enabling E-Stamp service are
// reserved to Master Admin outright (not permission-delegable to Assistant
// Master Admin), per the authoritative role spec.
router.patch("/:id/status", (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN), ctrl.updateOrganizationStatus);
router.patch("/:id/estamp-service", (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN), ctrl.setEstampServiceEnabled);
// Provisions the organization's initial Super Admin. Delegable to Assistant
// Master Admin via CLIENT_MANAGE, same as organization create/edit.
router.post("/:id/super-admin", (0, authorize_1.requirePermission)(shared_1.Permission.CLIENT_MANAGE), (0, validate_1.validateBody)(validation_1.provisionSuperAdminSchema), ctrl.provisionSuperAdmin);
exports.default = router;