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
            details: env_1.env.NODE_ENV === "production" ? undefined : err.details,
        });
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
