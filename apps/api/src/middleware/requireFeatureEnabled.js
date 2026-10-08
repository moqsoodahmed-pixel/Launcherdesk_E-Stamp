"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireFeatureEnabled = requireFeatureEnabled;
const ApiError_1 = require("../utils/ApiError");
const settings_service_1 = require("../services/settings.service");
// Phase 17 - gates an entire route surface behind a FEATURE_FLAG setting
// (BULK_ESTAMP_ENABLED/REPORTS_ENABLED). When the flag reads false, returns
// an honest 503 rather than letting the route 404/silently misbehave - the
// caller learns the feature is deliberately disabled, not that the endpoint
// doesn't exist. SettingsService.isFeatureEnabled already fails safe to the
// registry default (true for both flags) on a DB outage, so this can never
// itself become a false "everything is disabled" outage.
function requireFeatureEnabled(flagKey, message) {
    return async (req, _res, next) => {
        try {
            const enabled = await settings_service_1.SettingsService.isFeatureEnabled(flagKey);
            if (!enabled) {
                throw ApiError_1.ApiError.serviceUnavailable(message, "FEATURE_DISABLED");
            }
            next();
        }
        catch (err) {
            next(err);
        }
    };
}
