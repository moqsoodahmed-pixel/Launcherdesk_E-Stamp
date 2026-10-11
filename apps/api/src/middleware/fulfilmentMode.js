"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireFulfilmentMode = requireFulfilmentMode;
const settings_service_1 = require("../services/settings.service");
const ApiError_1 = require("../utils/ApiError");
// Gates a route on the ESTAMP_FULFILMENT setting (read live, so a Master
// Admin override takes effect immediately).
//   requireFulfilmentMode("provider") - provider routes; in manual mode they
//     answer 409 MANUAL_FULFILMENT_ENABLED (or `goneStatus` 410 for webhooks)
//     and never instantiate a provider.
//   requireFulfilmentMode("manual") - manual fulfilment routes; 409 in
//     provider mode.
function requireFulfilmentMode(mode, { goneStatus = false } = {}) {
    return (req, _res, next) => {
        settings_service_1.SettingsService.getFulfilmentMode()
            .then((current) => {
            if (current === mode)
                return next();
            if (mode === "provider") {
                const err = goneStatus
                    ? new ApiError_1.ApiError(410, "Manual fulfilment is enabled - the E-Stamp provider integration is switched off", "MANUAL_FULFILMENT_ENABLED")
                    : ApiError_1.ApiError.conflict("Manual fulfilment is enabled - the E-Stamp provider integration is switched off", "MANUAL_FULFILMENT_ENABLED");
                return next(err);
            }
            return next(ApiError_1.ApiError.conflict("Provider fulfilment is enabled - manual fulfilment is switched off", "PROVIDER_FULFILMENT_ENABLED"));
        })
            .catch(next);
    };
}
