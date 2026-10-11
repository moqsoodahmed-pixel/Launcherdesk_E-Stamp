"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ctrl = require("../../controllers/profile.controller");
const authenticate_1 = require("../../middleware/authenticate");
const router = (0, express_1.Router)();
// Any authenticated user. Each handler only touches the caller's own data.
router.use(authenticate_1.authenticate);
router.get("/organization", ctrl.getMyOrganization);
router.patch("/", ctrl.updateMyProfile);
exports.default = router;