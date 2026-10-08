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
const ctrl = __importStar(require("../../controllers/policy.controller"));
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const validate_1 = require("../../middleware/validate");
const validation_1 = require("@launcherdesk/validation");
const shared_1 = require("@launcherdesk/shared");
const router = (0, express_1.Router)();
// Phase 16 - EVERY other routes file in this codebase does router.use(authenticate)
// as its very first line, gating the WHOLE router. This is the one
// deliberate exception: GET /:type/current must be reachable with NO
// Authorization header at all (any visitor must be able to read the
// currently published Terms/Privacy/Refund policy before logging in or
// signing up). Rather than bypassing authenticate via a separate router
// mounted before /api/v1 (which would also work, mirroring /health in
// app.js), this file instead registers that one public route BEFORE calling
// authenticate on this router - Express matches/terminates on the first
// route whose method+path matches, so a request to GET /:type/current never
// reaches the authenticate layer below. Every other route in this file is
// registered AFTER router.use(authenticate) and is gated exactly like every
// other resource in this codebase.
router.get("/:type/current", ctrl.getCurrentPolicy);
router.use(authenticate_1.authenticate);
// Acceptance is a normal user action, not an admin action - any
// authenticated user, no special permission. Registered before the
// wildcard /:type/:version route below so it is never shadowed by it.
router.get("/acknowledgements/mine", ctrl.getMyAcknowledgements);
router.post("/acknowledge", (0, validate_1.validateBody)(validation_1.acknowledgePolicySchema), ctrl.acknowledgePolicy);
router.get("/:type/history", (0, authorize_1.requirePermission)(shared_1.Permission.POLICY_VIEW), ctrl.getPolicyHistory);
router.get("/:type/:version", (0, authorize_1.requirePermission)(shared_1.Permission.POLICY_VIEW), ctrl.getPolicyVersion);
router.post("/", (0, authorize_1.requirePermission)(shared_1.Permission.POLICY_MANAGE), (0, validate_1.validateBody)(validation_1.createPolicySchema), ctrl.createPolicyDraft);
router.post("/:id/publish", (0, authorize_1.requirePermission)(shared_1.Permission.POLICY_MANAGE), ctrl.publishPolicy);
exports.default = router;
