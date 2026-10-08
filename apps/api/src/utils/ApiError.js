"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
class ApiError extends Error {
    constructor(statusCode, message, code, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        Error.captureStackTrace?.(this, this.constructor);
    }
    static badRequest(message, code, details) {
        return new ApiError(400, message, code, details);
    }
    static unauthorized(message = "Unauthorized") {
        return new ApiError(401, message, "UNAUTHORIZED");
    }
    static forbidden(message = "Forbidden") {
        return new ApiError(403, message, "FORBIDDEN");
    }
    static notFound(message = "Not found") {
        return new ApiError(404, message, "NOT_FOUND");
    }
    static conflict(message, code = "CONFLICT", details) {
        return new ApiError(409, message, code, details);
    }
    static tooMany(message = "Too many requests") {
        return new ApiError(429, message, "RATE_LIMITED");
    }
    static notImplemented(message = "Not implemented", code = "NOT_IMPLEMENTED") {
        return new ApiError(501, message, code);
    }
    static serviceUnavailable(message = "Service unavailable", code = "SERVICE_UNAVAILABLE") {
        return new ApiError(503, message, code);
    }
    static internal(message = "Internal server error") {
        return new ApiError(500, message, "INTERNAL");
    }
}
exports.ApiError = ApiError;
