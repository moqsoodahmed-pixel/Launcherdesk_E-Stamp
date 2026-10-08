"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmailProvider = getEmailProvider;
const env_1 = require("../../config/env");
const ApiError_1 = require("../../utils/ApiError");
const BrevoEmailProvider_1 = require("./BrevoEmailProvider");
const MockEmailProvider_1 = require("./MockEmailProvider");
// Registry/factory, mirroring services/payment-providers and
// services/estamp-providers. Real credentials configured -> always the real
// provider. No credentials -> mock, but ONLY outside production: a
// production deployment must never silently "send" email through a mock
// that never actually delivers anything.
function getEmailProvider() {
    if (env_1.env.BREVO_API_KEY) {
        return new BrevoEmailProvider_1.BrevoEmailProvider();
    }
    if (env_1.env.NODE_ENV === "production") {
        throw ApiError_1.ApiError.internal("Email provider is not configured (BREVO_API_KEY missing) - refusing to silently mock email delivery in production", "EMAIL_PROVIDER_NOT_CONFIGURED");
    }
    return new MockEmailProvider_1.MockEmailProvider();
}
