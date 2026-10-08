"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = void 0;
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const env_1 = require("../config/env");
const ApiError_1 = require("../utils/ApiError");
const wallet_service_1 = require("./wallet.service");
const payment_providers_1 = require("./payment-providers");
const notification_service_1 = require("./notification.service");
// Dedicated Razorpay payment service. The frontend NEVER determines payment
// success - only server-side signature verification (checkout flow) or
// server-side webhook signature verification does. The business logic here
// never talks to the Razorpay SDK directly - only through PaymentProvider,
// so tests never need real credentials and production never silently falls
// back to a mock.
async function creditWalletForPayment(payment, initiatedByUserId) {
    // Idempotency key = the payment's own _id. Whether this is reached via
    // the checkout verify route or a (possibly retried) webhook delivery,
    // the SAME key means the wallet is never credited twice for one payment.
    await (0, wallet_service_1.creditWallet)({
        organizationId: payment.organizationId.toString(),
        amount: payment.amount,
        referenceType: "PAYMENT",
        referenceId: payment._id.toString(),
        idempotencyKey: `payment:${payment._id.toString()}`,
        description: `Razorpay payment ${payment.razorpayPaymentId}`,
        createdBy: initiatedByUserId ?? payment.createdBy,
    });
}
// Centralized here (not in the controller) so BOTH the checkout-verify path
// and the webhook path notify exactly once per payment, regardless of which
// one actually performs the transition or how many times either is retried -
// eventKey makes this safe even under concurrent/duplicate delivery.
async function notifyPaymentOutcome(payment, outcome) {
    const user = await models_1.User.findById(payment.createdBy).select("role email");
    if (!user)
        return;
    const isSuccess = outcome === "success";
    await (0, notification_service_1.notifyUser)({
        recipientId: payment.createdBy.toString(),
        recipientRole: user.role,
        type: shared_1.NotificationType.PAYMENT,
        title: isSuccess ? "Payment successful" : "Payment failed",
        message: isSuccess
            ? `Your payment of ₹${payment.amount} was successful and your wallet has been credited.`
            : `Your payment of ₹${payment.amount} could not be completed.`,
        organizationId: payment.organizationId.toString(),
        entityType: "Payment",
        entityId: payment._id,
        eventKey: `payment:${payment._id.toString()}:${outcome}`,
        email: user.email ? { to: user.email, method: isSuccess ? "sendPaymentSuccessEmail" : "sendPaymentFailedEmail", args: [payment.amount] } : undefined,
    });
}
exports.PaymentService = {
    async createOrder(params) {
        if (!Number.isFinite(params.amount) || params.amount <= 0) {
            throw ApiError_1.ApiError.badRequest("Invalid payment amount", "INVALID_AMOUNT");
        }
        const provider = (0, payment_providers_1.getPaymentProvider)();
        const { razorpayOrderId } = await provider.createOrder({ organizationId: params.organizationId, amount: params.amount });
        const payment = await models_1.Payment.create({
            organizationId: params.organizationId,
            amount: params.amount,
            razorpayOrderId,
            status: shared_1.PaymentStatus.CREATED,
            createdBy: params.userId,
        });
        return { razorpayOrderId, amount: params.amount, paymentId: payment._id, keyId: env_1.env.RAZORPAY_KEY_ID || null };
    },
    // Verifies the Razorpay checkout signature server-side. Never trust a
    // frontend "payment succeeded" flag directly.
    async confirmPayment(params) {
        const payment = await models_1.Payment.findOne({ razorpayOrderId: params.razorpayOrderId });
        if (!payment)
            throw ApiError_1.ApiError.notFound("Payment order not found");
        if (payment.status === shared_1.PaymentStatus.SUCCESS) {
            // Idempotent: already processed (possibly by a webhook that arrived
            // first) - do not double-verify or double-credit.
            return payment;
        }
        const provider = (0, payment_providers_1.getPaymentProvider)();
        const isValid = provider.verifyPaymentSignature(params.razorpayOrderId, params.razorpayPaymentId, params.razorpaySignature);
        if (!isValid) {
            payment.status = shared_1.PaymentStatus.FAILED;
            payment.failureReason = "Signature verification failed";
            await payment.save();
            await notifyPaymentOutcome(payment, "failed");
            throw ApiError_1.ApiError.badRequest("Payment signature verification failed", "PAYMENT_VERIFICATION_FAILED");
        }
        payment.razorpayPaymentId = params.razorpayPaymentId;
        payment.status = shared_1.PaymentStatus.SUCCESS;
        payment.verifiedAt = new Date();
        await payment.save();
        await creditWalletForPayment(payment, params.userId);
        await notifyPaymentOutcome(payment, "success");
        return payment;
    },
    // Processes an inbound Razorpay webhook event. Uses the webhook's own
    // signature scheme (HMAC over the raw body with RAZORPAY_WEBHOOK_SECRET),
    // completely independent of the checkout signature used by confirmPayment
    // above - a webhook is a server-to-server call, never something the
    // browser can forge on the customer's behalf.
    async handleWebhook(rawBody, signatureHeader) {
        const provider = (0, payment_providers_1.getPaymentProvider)();
        if (!signatureHeader || !provider.verifyWebhookSignature(rawBody, signatureHeader)) {
            throw ApiError_1.ApiError.unauthorized("Invalid webhook signature");
        }
        const event = JSON.parse(rawBody.toString("utf8"));
        const eventType = event?.event;
        // Only these two events can ever move a payment forward - anything
        // else (refund events, other entities, etc.) is acknowledged but
        // otherwise ignored in this phase.
        if (eventType !== "payment.captured" && eventType !== "order.paid") {
            return { handled: false, reason: "ignored_event_type" };
        }
        const paymentEntity = event?.payload?.payment?.entity;
        const razorpayOrderId = paymentEntity?.order_id;
        const razorpayPaymentId = paymentEntity?.id;
        if (!razorpayOrderId || !razorpayPaymentId) {
            return { handled: false, reason: "missing_identifiers" };
        }
        const payment = await models_1.Payment.findOne({ razorpayOrderId });
        if (!payment) {
            // Unknown/foreign order id - never throw (Razorpay will retry a
            // failing webhook indefinitely); just acknowledge and move on.
            return { handled: false, reason: "unknown_payment" };
        }
        if (payment.status === shared_1.PaymentStatus.SUCCESS) {
            // Duplicate delivery of an event already processed - idempotent no-op.
            return { handled: true, alreadyProcessed: true, paymentId: payment._id };
        }
        if (paymentEntity.status === "failed") {
            payment.status = shared_1.PaymentStatus.FAILED;
            payment.failureReason = "Razorpay reported payment failure";
            await payment.save();
            await notifyPaymentOutcome(payment, "failed");
            return { handled: true, paymentId: payment._id, status: payment.status };
        }
        payment.razorpayPaymentId = razorpayPaymentId;
        payment.status = shared_1.PaymentStatus.SUCCESS;
        payment.verifiedAt = new Date();
        await payment.save();
        await creditWalletForPayment(payment);
        await notifyPaymentOutcome(payment, "success");
        return { handled: true, paymentId: payment._id, status: payment.status };
    },
};
