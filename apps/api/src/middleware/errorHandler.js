"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
exports.notFoundHandler = notFoundHandler;
const ApiError_1 = require("../utils/ApiError");
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
// Secure error handling: never leak stack traces or internal details in
// production responses; log server-side only.
function errorHandler(err, req, res, _next) {
    if (err instanceof ApiError_1.ApiError) {
        if (err.statusCode >= 500) {
            logger_1.logger.error(err.message, { path: req.path, code: err.code });
        }
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            code: err.code,
            // 4xx details are deliberately client-facing (Zod field errors,
            // the caller's own failed bulk batch, balance shortfall); only a
            // 5xx's details are treated as internal and hidden in production.
            details: env_1.env.NODE_ENV === "production" && err.statusCode >= 500 ? undefined : err.details,
        });
    }
    // A malformed id in the URL (e.g. /payments/abc) makes Mongoose throw a
    // CastError - that's "no such record", not a server fault.
    if (err?.name === "CastError" && err?.kind === "ObjectId") {
        return res.status(404).json({ success: false, message: "Not found", code: "NOT_FOUND" });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    logger_1.logger.error("Unhandled error", { path: req.path, message });
    return res.status(500).json({
        success: false,
        message: env_1.env.NODE_ENV === "production" ? "Internal server error" : message,
        code: "INTERNAL",
        stack: env_1.env.NODE_ENV === "production" ? undefined : err?.stack,
    });
}
function notFoundHandler(req, res) {
    res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}`, code: "NOT_FOUND" });
}
