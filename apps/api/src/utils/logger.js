"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const env_1 = require("../config/env");
// IMPORTANT: never log passwords, OTP codes, tokens, or payment/API secrets.
// Callers must only pass sanitized metadata.
const REDACT_KEYS = ["password", "otp", "code", "token", "secret", "signature", "authorization"];
function redact(meta) {
    const out = {};
    for (const [k, v] of Object.entries(meta || {})) {
        if (REDACT_KEYS.some((r) => k.toLowerCase().includes(r))) {
            out[k] = "[REDACTED]";
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
const redactFormat = winston_1.default.format((info) => {
    const { level, message, timestamp, ...rest } = info;
    return { level, message, timestamp, ...redact(rest) };
});
exports.logger = winston_1.default.createLogger({
    level: env_1.env.NODE_ENV === "production" ? "info" : "debug",
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), redactFormat(), env_1.env.NODE_ENV === "production" ? winston_1.default.format.json() : winston_1.default.format.simple()),
    transports: [new winston_1.default.transports.Console()],
});
