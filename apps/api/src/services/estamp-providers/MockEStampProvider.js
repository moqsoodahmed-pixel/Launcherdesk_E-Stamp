"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockEStampProvider = void 0;
const crypto_1 = require("crypto");
const logger_1 = require("../../utils/logger");
const env_1 = require("../../config/env");
const MOCK_WEBHOOK_SECRET = "mock_estamp_webhook_secret_dev_only";
// DEV/TEST-ONLY adapter used when no real E-Stamp provider credentials/API
// docs are available yet. Clearly marked - does NOT talk to any real
// government or third-party system, and does not fabricate certificate
// numbers, seals, QR codes, or any official security element. It never
// produces a downloadable certificate artifact (see file.controller/
// EStampDocument) - only a simulated business-level status, which is exactly
// as far as a mock can honestly go without a real provider specification.
class MockEStampProvider {
    // params.idempotencyKey is the stable EStampOrder._id - a real provider
    // that supports idempotency keys would receive the same value, so a
    // retried submission (same order, same key) can be recognized as the
    // same attempt rather than a new one. The mock derives its reference
    // deterministically from that key so repeated calls with the same key
    // return the SAME reference (never a fresh one from Date.now()).
    async issueEStamp(params) {
        logger_1.logger.warn("[MockEStampProvider] Using mock E-Stamp provider - NOT a real government E-Stamp", {
            requestId: params.requestId,
            idempotencyKey: params.idempotencyKey,
        });
        const reference = `MOCK-REF-${params.idempotencyKey || params.requestId}`;
        return {
            providerReference: reference,
            status: "PENDING", // requires a later checkStatus (sync) confirmation, like a real async provider
            rawResponse: { mock: true, note: "Replace with real provider adapter before production use" },
        };
    }
    // Simulates a later, independent confirmation of a previously-submitted
    // order (what syncEStampOrderStatus/polling is for). Deterministic on
    // the reference alone, purely so tests can exercise both the success and
    // failure paths without any hidden mock state: a reference ending in
    // "-SIMFAIL" (a mock-only, test-authored convention) reports FAILED,
    // everything else reports ISSUED. Never returns a certificate artifact.
    async checkStatus(providerReference) {
        if (!providerReference) {
            return { status: "UNKNOWN" };
        }
        if (providerReference.endsWith("-SIMFAIL")) {
            return { status: "FAILED", rawResponse: { mock: true, reason: "Simulated provider rejection" } };
        }
        return { status: "ISSUED", rawResponse: { mock: true, note: "Simulated confirmation - no real certificate artifact exists" } };
    }
    // Mock/test-only HMAC scheme - NOT a real provider's actual webhook
    // signature scheme (which is unknown - see RealEStampProvider). Uses
    // ESTAMP_PROVIDER_WEBHOOK_SECRET if set, else a fixed dev-only fallback
    // so tests can construct genuinely valid AND genuinely invalid signatures.
    verifyWebhookSignature(rawBody, signature) {
        const secret = env_1.env.ESTAMP_PROVIDER_WEBHOOK_SECRET || MOCK_WEBHOOK_SECRET;
        const expected = (0, crypto_1.createHmac)("sha256", secret).update(rawBody).digest("hex");
        const bufA = Buffer.from(expected, "utf8");
        const bufB = Buffer.from(signature || "", "utf8");
        if (bufA.length !== bufB.length)
            return false;
        return (0, crypto_1.timingSafeEqual)(bufA, bufB);
    }
    // Deterministic, clearly-labeled TEST/DEV values - never presented as a
    // real provider account balance. There is no real provider balance
    // endpoint specification to normalize against yet, so this shape
    // (available/currency/unit) is a best-guess normalized structure the
    // real adapter can later map its actual response onto.
    async getBalance() {
        logger_1.logger.warn("[MockEStampProvider] Returning mock E-Stamp provider balance - NOT a real account balance");
        return {
            available: 100000,
            currency: "INR",
            unit: "AMOUNT",
            source: "mock",
            rawResponse: { mock: true, note: "No real provider balance API is configured" },
        };
    }
    async getUsage() {
        logger_1.logger.warn("[MockEStampProvider] Returning mock E-Stamp provider usage - NOT real provider-side usage data");
        return {
            source: "mock",
            rawResponse: { mock: true, note: "This provider has no real usage API configured - internal usage is derived from EStampOrder instead, see estamp-provider.service.js" },
        };
    }
}
exports.MockEStampProvider = MockEStampProvider;
