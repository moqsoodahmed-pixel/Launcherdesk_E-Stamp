"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
const email_providers_1 = require("./email-providers");
const email_templates_1 = require("./email-templates");
// Centralized email dispatch. Every EmailService.sendX method below renders
// a template (services/email-templates) and goes through this one function,
// which:
//   1. is idempotent when an eventKey is supplied (a retried business event -
//      payment webhook, provider status sync, etc. - must not send the same
//      email twice; enforced by EmailLog's unique index, not by a fragile
//      in-memory check),
//   2. never throws - a notification/email failure must never break the
//      business operation that triggered it (see callers, none of which
//      await-and-propagate a failure from these methods),
//   3. never logs the rendered HTML/OTP/token, only template name + subject
//      + recipient + delivery status.
async function dispatch(to, templateName, data, eventKey) {
    // The entire function is best-effort: nothing in here is ever allowed to
    // propagate and break the caller's business operation (an OTP send
    // failing must not block login; a payment-success email failing must
    // not undo a successful payment - see file header).
    try {
        const { subject, html } = (0, email_templates_1.renderTemplate)(templateName, data);
        const logKey = eventKey ? `${eventKey}:${to}` : undefined;
        if (logKey) {
            const existing = await models_1.EmailLog.findOne({ eventKey: logKey });
            if (existing) {
                // Already sent for this exact business event + recipient - a
                // retried webhook/sync must not resend it.
                return existing;
            }
        }
        let log;
        try {
            log = await models_1.EmailLog.create({ eventKey: logKey, template: templateName, to, subject, status: "QUEUED" });
        }
        catch (err) {
            if (err?.code === 11000) {
                // Lost a race to a concurrent sender for the same event - the
                // winner already has it (or is sending it), do not send again.
                return models_1.EmailLog.findOne({ eventKey: logKey });
            }
            throw err;
        }
        try {
            const provider = (0, email_providers_1.getEmailProvider)();
            const result = await provider.send({ to, subject, html });
            log.status = result.status;
            log.provider = result.source;
            log.sentAt = new Date();
            await log.save();
        }
        catch (err) {
            log.status = "FAILED";
            log.errorMessage = err?.message ? String(err.message).slice(0, 300) : "Unknown email provider error";
            await log.save().catch(() => { });
            logger_1.logger.error("[email.service] Failed to send email", { template: templateName, error: log.errorMessage });
        }
        return log;
    }
    catch (err) {
        logger_1.logger.error("[email.service] Unexpected error dispatching email", { template: templateName, error: err?.message });
        return null;
    }
}
exports.EmailService = {
    async sendLoginOTP(to, code) {
        await dispatch(to, "otp", { code, purpose: "login" });
    },
    async sendPasswordResetOTP(to, code) {
        await dispatch(to, "otp", { code, purpose: "password reset" });
    },
    async sendRequestCreatedEmail(to, requestNumber) {
        await dispatch(to, "requestCreated", { requestNumber });
    },
    async sendPaymentSuccessEmail(to, amount, eventKey) {
        await dispatch(to, "paymentSuccess", { amount }, eventKey);
    },
    async sendPaymentFailedEmail(to, amount, eventKey) {
        await dispatch(to, "paymentFailed", { amount }, eventKey);
    },
    async sendRequestStatusEmail(to, requestNumber, status) {
        await dispatch(to, "requestStatus", { requestNumber, status });
    },
    async sendOrderIssuedEmail(to, orderNumber, eventKey) {
        await dispatch(to, "orderIssued", { orderNumber }, eventKey);
    },
    async sendOrderFailedEmail(to, orderNumber, reason, eventKey) {
        await dispatch(to, "orderFailed", { orderNumber, reason }, eventKey);
    },
    async sendEStampReadyEmail(to, orderNumber, eventKey) {
        await dispatch(to, "certificateAvailable", { orderNumber }, eventKey);
    },
    async sendEStampDownloadNotification(to, orderNumber) {
        await dispatch(to, "certificateDownloaded", { orderNumber });
    },
    async sendSecurityAlertEmail(to, message) {
        await dispatch(to, "securityAlert", { message });
    },
    async sendAssistantAdminActivityAlert(to, message) {
        await dispatch(to, "assistantActivity", { message });
    },
};
