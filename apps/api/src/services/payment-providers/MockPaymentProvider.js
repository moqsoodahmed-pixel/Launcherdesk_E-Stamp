"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockPaymentProvider = void 0;
const logger_1 = require("../../utils/logger");
// DEV/TEST-ONLY adapter used when no real Razorpay credentials are
// configured. Never selected in production (see getPaymentProvider) - does
// NOT talk to Razorpay and does not fabricate a "real" payment gateway
// response, it only produces internally-consistent mock identifiers so the
// rest of the flow (order -> checkout -> verify -> wallet credit) can be
// exercised in development and automated tests.
class MockPaymentProvider {
    async createOrder(params) {
        logger_1.logger.warn("[MockPaymentProvider] Using mock payment provider - NOT a real Razorpay order", {
            organizationId: params.organizationId,
        });
        return { razorpayOrderId: `mock_order_${Date.now()}_${Math.random().toString(36).slice(2)}` };
    }
    // Mirrors the real HMAC formula but with a fixed dev-only secret, so
    // tests can construct a genuinely valid (and genuinely invalid) signature
    // the same way the real provider would, rather than always accepting.
    verifyPaymentSignature(orderId, paymentId, signature) {
        const crypto = require("crypto");
        const expected = crypto.createHmac("sha256", "mock_secret_dev_only").update(`${orderId}|${paymentId}`).digest("hex");
        return expected === signature;
    }
    verifyWebhookSignature(rawBody, signature) {
        const crypto = require("crypto");
        const expected = crypto.createHmac("sha256", "mock_webhook_secret_dev_only").update(rawBody).digest("hex");
        return expected === signature;
    }
}
exports.MockPaymentProvider = MockPaymentProvider;
