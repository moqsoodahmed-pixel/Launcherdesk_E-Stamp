"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer = require("multer");
const ctrl = require("../../controllers/profile.controller");
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const rateLimiters_1 = require("../../middleware/rateLimiters");
const shared_1 = require("@launcherdesk/shared");
// Small, fixed ceiling (not the general document upload limit) - a logo is
// never a multi-megabyte certificate scan; FileService.uploadPublicImage
// enforces the real 2MB business limit regardless of this outer multer cap.
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = (0, express_1.Router)();
// Any authenticated user. Each handler only touches the caller's own data.
router.use(authenticate_1.authenticate);
router.get("/organization", ctrl.getMyOrganization);
router.patch("/", ctrl.updateMyProfile);
// Only the organization's own Super Admin may change its logo - every other
// tenant role (Admin, User) only ever reads it via GET /profile/organization
// above.
router.post("/organization/logo", rateLimiters_1.documentUploadLimiter, (0, authorize_1.requireRole)(shared_1.Role.SUPER_ADMIN), logoUpload.single("file"), ctrl.uploadMyOrganizationLogo);
router.delete("/organization/logo", (0, authorize_1.requireRole)(shared_1.Role.SUPER_ADMIN), ctrl.removeMyOrganizationLogo);
exports.default = router;