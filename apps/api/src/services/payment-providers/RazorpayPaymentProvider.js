"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RazorpayPaymentProvider = void 0;
const crypto_1 = require("crypto");
const env_1 = require("../../config/env");
// Talks to the REAL Razorpay API via the official SDK. Never fabricates a
// response - every value returned here comes from Razorpay itself or from
// a documented, official verification formula.
class RazorpayPaymentProvider {
    getClient() {
        const Razorpay = require("razorpay");
        return new Razorpay({ key_id: env_1.env.RAZORPAY_KEY_ID, key_secret: env_1.env.RAZORPAY_KEY_SECRET });
    }
    async createOrder(params) {
        const order = await this.getClient().orders.create({
            // Razorpay's API takes amounts in the smallest currency unit (paise
            // for INR) - integer-safe conversion, never floating-point.
            amount: Math.round(params.amount * 100),
            currency: params.currency || "INR",
            payment_capture: 1,
        });
        return { razorpayOrderId: order.id };
    }
    // Official Razorpay checkout signature formula:
    // HMAC_SHA256(order_id + "|" + payment_id, key_secret)
    verifyPaymentSignature(orderId, paymentId, signature) {
        const expected = (0, crypto_1.createHmac)("sha256", env_1.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
        return safeCompare(expected, signature);
    }
    // Official Razorpay webhook signature formula:
    // HMAC_SHA256(raw request body, webhook secret)
    verifyWebhookSignature(rawBody, signature) {
        if (!env_1.env.RAZORPAY_WEBHOOK_SECRET)
            return false;
        const expected = (0, crypto_1.createHmac)("sha256", env_1.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
        return safeCompare(expected, signature);
    }
    // Reconciliation safety net: asks Razorpay directly, server-to-server,
    // whether an order actually has a captured payment against it. This is
    // the only way to recover a payment that Razorpay genuinely captured but
    // that never reached us through either the browser's checkout-verify
    // call (closed tab, dropped network right after paying) or the webhook
    // (not registered, wrong secret, Razorpay-side delivery failure) - a real
    // gap: without this, captured money can sit invisible to the platform
    // forever with the Payment record stuck at CREATED.
    async fetchCapturedPayment(razorpayOrderId) {
        const payments = await this.getClient().orders.fetchPayments(razorpayOrderId);
        const captured = (payments?.items || []).find((p) => p.status === "captured");
        if (!captured)
            return null;
        return { razorpayPaymentId: captured.id, amount: captured.amount / 100, status: captured.status };
    }
}
exports.RazorpayPaymentProvider = RazorpayPaymentProvider;
function safeCompare(a, b) {
    const bufA = Buffer.from(a || "", "utf8");
    const bufB = Buffer.from(b || "", "utf8");
    if (bufA.length !== bufB.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(bufA, bufB);
}
