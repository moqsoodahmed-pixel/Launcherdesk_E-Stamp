"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSetting = exports.getSetting = exports.listSettings = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const settings_service_1 = require("../services/settings.service");
// GET /settings?category=BUSINESS|FEATURE_FLAG - SETTINGS_VIEW required (see
// routes/v1/settings.routes.js). Fixes the previous "any authenticated user
// of any role can list every platform setting" hole - this route now sits
// behind requirePermission(Permission.SETTINGS_VIEW) instead of bare
// `authenticate`.
exports.listSettings = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { category } = req.query;
    const settings = await settings_service_1.SettingsService.listSettings({ category });
    return (0, ApiResponse_1.ok)(res, settings);
});
exports.getSetting = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const setting = await settings_service_1.SettingsService.getSetting(req.params.key);
    return (0, ApiResponse_1.ok)(res, setting);
});
// PATCH /settings/:key - SETTINGS_MANAGE required. Unlike the previous
// PUT /settings (arbitrary {key, value, description} straight from
// req.body), `key` is taken ONLY from the URL param and validated against
// the settingsRegistry allowlist server-side (settings.service.js is the
// real authority) - the request body only ever carries {value,
// expectedVersion} and is additionally bounded by updateSettingSchema
// (.strict()) at the validation layer.
exports.updateSetting = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { value, expectedVersion } = req.body;
    const setting = await settings_service_1.SettingsService.updateSetting({
        key: req.params.key,
        value,
        expectedVersion,
        actorId: req.user.id,
        actorRole: req.user.role,
        req,
    });
    return (0, ApiResponse_1.ok)(res, setting);
});
