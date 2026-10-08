"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentProvider = getPaymentProvider;
const env_1 = require("../../config/env");
const ApiError_1 = require("../../utils/ApiError");
const RazorpayPaymentProvider_1 = require("./RazorpayPaymentProvider");
const MockPaymentProvider_1 = require("./MockPaymentProvider");
// Registry/factory, mirroring services/estamp-providers. Real credentials
// configured -> always the real provider. No credentials -> mock, but ONLY
// outside production: a production deployment must never silently accept
// mock/fabricated payment success, so it fails loudly instead.
function getPaymentProvider() {
    if (env_1.env.RAZORPAY_KEY_ID && env_1.env.RAZORPAY_KEY_SECRET) {
        return new RazorpayPaymentProvider_1.RazorpayPaymentProvider();
    }
    if (env_1.env.NODE_ENV === "production") {
        throw ApiError_1.ApiError.internal("Payment provider is not configured (RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET missing) - refusing to process payments in production", "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
    return new MockPaymentProvider_1.MockPaymentProvider();
}
