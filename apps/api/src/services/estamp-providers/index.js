"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEStampProvider = getEStampProvider;
const env_1 = require("../../config/env");
const ApiError_1 = require("../../utils/ApiError");
const MockEStampProvider_1 = require("./MockEStampProvider");
const RealEStampProvider_1 = require("./RealEStampProvider");
// Registry/factory: add real provider classes here as they become available
// (e.g. "STOCKHOLDING", "SHCIL") and switch via ESTAMP_PROVIDER env var.
//
// Production safety: a production deployment must never silently process
// E-Stamp requests through the mock adapter and have that mistaken for a
// real government E-Stamp being issued - so "mock" (or an unset/unrecognized
// value, which would otherwise fall through to mock) is refused outright in
// production.
function getEStampProvider() {
    const provider = env_1.env.ESTAMP_PROVIDER;
    if (provider === "mock" || !provider) {
        if (env_1.env.NODE_ENV === "production") {
            throw ApiError_1.ApiError.internal("E-Stamp provider is set to \"mock\" (or unset) in production - refusing to fabricate E-Stamp issuance. Configure a real ESTAMP_PROVIDER.", "ESTAMP_PROVIDER_NOT_CONFIGURED");
        }
        return new MockEStampProvider_1.MockEStampProvider();
    }
    // Any non-"mock" provider name currently resolves to the placeholder
    // real adapter, which itself fails clearly (see RealEStampProvider) since
    // no real provider specification has been implemented yet.
    return new RealEStampProvider_1.RealEStampProvider();
}
