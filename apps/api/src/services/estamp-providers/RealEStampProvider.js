"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealEStampProvider = void 0;
const ApiError_1 = require("../../utils/ApiError");
// Placeholder adapter boundary for the REAL external E-Stamp provider.
//
// The actual provider's API specification, authentication scheme, request/
// response payload shapes, status vocabulary, and certificate delivery
// mechanism are NOT currently available to this codebase. Fabricating any
// of that here would mean silently pretending a real government E-Stamp was
// issued when none was - which this project must never do.
//
// This class exists so that:
//   1. The rest of the application (estamp-request.service.js, routes,
//      controllers) can be written against a stable interface today.
//   2. Switching ESTAMP_PROVIDER away from "mock" is a real, deliberate
//      configuration step, not an accident.
//   3. When the real provider's specification and credentials become
//      available, only THIS file needs to be filled in - issueEStamp/
//      checkStatus below, using ESTAMP_API_BASE_URL/API_KEY/API_SECRET from
//      config/env.js - nothing else in the business logic should need to
//      change.
//
// Until then, every method here fails loudly and explicitly rather than
// making a fabricated HTTP call to an invented endpoint.
class RealEStampProvider {
    issueEStamp() {
        throw ApiError_1.ApiError.internal("Real E-Stamp provider integration is not yet implemented - the provider's API specification and credentials have not been supplied. Configure ESTAMP_PROVIDER=mock for development/testing.", "ESTAMP_PROVIDER_NOT_CONFIGURED");
    }
    checkStatus() {
        throw ApiError_1.ApiError.internal("Real E-Stamp provider integration is not yet implemented - the provider's API specification and credentials have not been supplied.", "ESTAMP_PROVIDER_NOT_CONFIGURED");
    }
    verifyWebhookSignature() {
        throw ApiError_1.ApiError.notImplemented("Real E-Stamp provider webhook verification is not implemented - the provider's signature scheme has not been supplied.", "ESTAMP_PROVIDER_NOT_CONFIGURED");
    }
    // No real provider balance/usage endpoint specification exists yet -
    // fails clearly rather than fabricating a balance or calling an invented
    // URL. Callers (estamp-provider.service.js) must translate this into an
    // honest NOT_CONFIGURED/UNAVAILABLE status, never a balance of 0.
    getBalance() {
        throw ApiError_1.ApiError.notImplemented("Real E-Stamp provider balance API is not implemented - the provider's balance endpoint specification has not been supplied.", "ESTAMP_PROVIDER_NOT_CONFIGURED");
    }
    getUsage() {
        throw ApiError_1.ApiError.notImplemented("Real E-Stamp provider usage API is not implemented - the provider's usage endpoint specification has not been supplied.", "ESTAMP_PROVIDER_NOT_CONFIGURED");
    }
}
exports.RealEStampProvider = RealEStampProvider;
