"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmtpEmailProvider = void 0;
const env_1 = require("../../config/env");
const logger_1 = require("../../utils/logger");

class SmtpEmailProvider {
    constructor() {
        const nodemailer = require("nodemailer");
        let transportConfig;

        if (env_1.env.GMAIL_USER && env_1.env.GMAIL_APP_PASSWORD) {
            transportConfig = {
                service: "gmail",
                auth: {
                    user: env_1.env.GMAIL_USER,
                    pass: env_1.env.GMAIL_APP_PASSWORD,
                },
            };
        } else if (env_1.env.SMTP_HOST) {
            transportConfig = {
                host: env_1.env.SMTP_HOST,
                port: env_1.env.SMTP_PORT || 587,
                secure: env_1.env.SMTP_SECURE || env_1.env.SMTP_PORT === 465,
                auth: {
                    user: env_1.env.SMTP_USER,
                    pass: env_1.env.SMTP_PASS,
                },
            };
        } else {
            // Default to Brevo SMTP Relay if BREVO_API_KEY is present
            transportConfig = {
                host: "smtp-relay.brevo.com",
                port: 587,
                secure: false,
                auth: {
                    user: env_1.env.SMTP_USER || env_1.env.BREVO_SENDER_EMAIL,
                    pass: env_1.env.SMTP_PASS || env_1.env.BREVO_API_KEY,
                },
            };
        }

        this.transporter = nodemailer.createTransport(transportConfig);
    }

    async send(params) {
        const fromEmail = env_1.env.EMAIL_FROM || env_1.env.BREVO_SENDER_EMAIL || env_1.env.GMAIL_USER || env_1.env.SMTP_USER || "no-reply@launcherdesk.com";
        const fromName = env_1.env.EMAIL_FROM_NAME || env_1.env.BREVO_SENDER_NAME || "LauncherDesk E-Stamping";

        try {
            const info = await this.transporter.sendMail({
                from: `"${fromName}" <${fromEmail}>`,
                to: params.to,
                subject: params.subject,
                html: params.html,
            });

            return {
                status: "SENT",
                providerMessageId: info.messageId || null,
                source: "smtp",
            };
        } catch (err) {
            logger_1.logger.error("[SmtpEmailProvider] Error sending email via SMTP", {
                to: params.to,
                error: err.message,
            });
            throw new Error(`SMTP email failed: ${err.message}`);
        }
    }
}

exports.SmtpEmailProvider = SmtpEmailProvider;
