"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrevoEmailProvider = void 0;
const env_1 = require("../../config/env");
// Talks to the REAL Brevo transactional email API. Never fabricates a
// delivery result - a resolved call means Brevo ACCEPTED the email for
// sending (status "SENT"), never that it was actually delivered/opened -
// this project has no delivery-confirmation webhook wired up, so it never
// claims more than it knows.
class BrevoEmailProvider {
    async send(params) {
        // Lazy require so the app still boots without the dependency configured.
        const SibApiV3Sdk = require("sib-api-v3-sdk");
        const client = SibApiV3Sdk.ApiClient.instance;
        client.authentications["api-key"].apiKey = env_1.env.BREVO_API_KEY;
        const api = new SibApiV3Sdk.TransactionalEmailsApi();
        const result = await api.sendTransacEmail({
            sender: { email: env_1.env.EMAIL_FROM || env_1.env.BREVO_SENDER_EMAIL, name: env_1.env.EMAIL_FROM_NAME || env_1.env.BREVO_SENDER_NAME },
            to: [{ email: params.to }],
            subject: params.subject,
            htmlContent: params.html,
        });
        return { status: "SENT", providerMessageId: result?.messageId || null, source: "brevo" };
    }
}
exports.BrevoEmailProvider = BrevoEmailProvider;
