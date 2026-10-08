"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockEmailProvider = void 0;
const logger_1 = require("../../utils/logger");
// DEV/TEST-ONLY adapter used when no real email provider credentials are
// configured. Never used in production (see getEmailProvider). Does NOT
// send anything - clearly logs that this is a mock so a developer can never
// mistake it for a real delivered email.
class MockEmailProvider {
    async send(params) {
        logger_1.logger.warn("[MockEmailProvider] Email provider not configured - NOT actually sending", {
            to: params.to,
            subject: params.subject,
        });
        return { status: "SENT", providerMessageId: null, source: "mock" };
    }
}
exports.MockEmailProvider = MockEmailProvider;
