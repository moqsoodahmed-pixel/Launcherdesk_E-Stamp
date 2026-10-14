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
const ctrl = __importStar(require("../../controllers/user.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const validate_1 = require("../../middleware/validate");
const validation_1 = require("@launcherdesk/validation");
const shared_1 = require("@launcherdesk/shared");
const router = (0, express_1.Router)();
router.use(authenticate_1.authenticate, (0, authorize_1.requireOrganizationAccess)());
router.post("/", (0, authorize_1.requirePermission)(shared_1.Permission.USER_CREATE), (0, validate_1.validateBody)(validation_1.createUserSchema), ctrl.createUser);
router.get("/", (0, authorize_1.requirePermission)(shared_1.Permission.USER_VIEW), ctrl.listUsers);
// Reveal a SYSTEM-GENERATED temporary password. Master Admin can reveal
// anyone's (platform-wide); Super Admin and Admin can reveal only someone
// they themselves had the authority to create, within their own
// organization - the controller enforces both the tenant-isolation and
// the role-authority check, this gate just keeps every other role out
// (never an Assistant Master Admin, a User, or a Vendor).
router.get("/:id/temporary-password", (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN, shared_1.Role.SUPER_ADMIN, shared_1.Role.ADMIN), require("../../middleware/rateLimiters").credentialRevealLimiter, ctrl.revealTemporaryPassword);
router.get("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.USER_VIEW), ctrl.getUser);
router.patch("/:id", (0, authorize_1.requirePermission)(shared_1.Permission.USER_MANAGE), (0, validate_1.validateBody)(validation_1.updateClientUserSchema), ctrl.updateUser);
router.patch("/:id/status", (0, authorize_1.requirePermission)(shared_1.Permission.USER_MANAGE), ctrl.updateUserStatus);
router.patch("/:id/role", (0, authorize_1.requirePermission)(shared_1.Permission.USER_MANAGE), (0, validate_1.validateBody)(validation_1.updateUserRoleSchema), ctrl.updateUserRole);
// A Super Admin/Admin sets a new, explicit password for an existing
// Admin's/User's account - the controller enforces the same tenant-
// isolation and role-authority rule as every other action in this file.
router.post("/:id/reset-password", (0, authorize_1.requirePermission)(shared_1.Permission.USER_MANAGE), require("../../middleware/rateLimiters").userPasswordResetLimiter, (0, validate_1.validateBody)(validation_1.resetUserPasswordSchema), ctrl.resetUserPassword);
// Master-Admin-only: create and manage Assistant Master Admin accounts.
// Registered with an explicit requireRole gate (not just permission checks)
// so an Assistant Master Admin can never reach these routes at all, no
// matter what permissions they hold - only Master Admin may mint or
// re-permission another internal admin account.
router.post("/assistant-admins", (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN), (0, validate_1.validateBody)(validation_1.createAssistantAdminSchema), ctrl.createAssistantAdmin);
router.patch("/:id/permissions", (0, authorize_1.requireRole)(shared_1.Role.MASTER_ADMIN), (0, validate_1.validateBody)(validation_1.updateAssistantAdminPermissionsSchema), ctrl.updateAssistantAdminPermissions);
exports.default = router;