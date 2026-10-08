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
const ctrl = __importStar(require("../../controllers/settings.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const validate_1 = require("../../middleware/validate");
const shared_1 = require("@launcherdesk/shared");
const validation_1 = require("@launcherdesk/validation");
const router = (0, express_1.Router)();
router.use(authenticate_1.authenticate);
// Phase 17 - fixes the previous open-read bug (GET / used to have NO
// permission check beyond `authenticate`, so any logged-in USER of any
// tenant could list every platform-wide setting). Both routes now require
// the already-existing (previously unused) SETTINGS_VIEW/SETTINGS_MANAGE
// permissions instead of a hardcoded requireRole(MASTER_ADMIN) check.
router.get("/", (0, authorize_1.requirePermission)(shared_1.Permission.SETTINGS_VIEW), ctrl.listSettings);
router.get("/:key", (0, authorize_1.requirePermission)(shared_1.Permission.SETTINGS_VIEW), ctrl.getSetting);
router.patch("/:key", (0, authorize_1.requirePermission)(shared_1.Permission.SETTINGS_MANAGE), (0, validate_1.validateBody)(validation_1.updateSettingSchema), ctrl.updateSetting);
exports.default = router;
