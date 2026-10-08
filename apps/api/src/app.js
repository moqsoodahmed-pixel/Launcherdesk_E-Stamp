"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const morgan_1 = __importDefault(require("morgan"));
const express_mongo_sanitize_1 = __importDefault(require("express-mongo-sanitize"));
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./config/env");
const errorHandler_1 = require("./middleware/errorHandler");
const rateLimiters_1 = require("./middleware/rateLimiters");
const v1_1 = __importDefault(require("./routes/v1"));
const logger_1 = require("./utils/logger");
function createApp() {
    const app = (0, express_1.default)();
    app.disable("x-powered-by");
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)({
        origin: env_1.env.FRONTEND_URL,
        credentials: true,
    }));
    // Captures the exact raw request bytes alongside the parsed JSON body.
    // Razorpay's webhook signature is an HMAC over the RAW body - re-serializing
    // the parsed JSON would not reliably reproduce the same bytes (key order,
    // whitespace, number formatting), so the webhook route verifies against
    // this buffer rather than JSON.stringify(req.body).
    app.use(express_1.default.json({ limit: "2mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
    app.use(express_1.default.urlencoded({ extended: true }));
    app.use((0, cookie_parser_1.default)());
    app.use((0, express_mongo_sanitize_1.default)()); // strips $/. operators from user input - NoSQL injection protection
    app.use((0, morgan_1.default)(env_1.env.NODE_ENV === "production" ? "combined" : "dev", {
        stream: { write: (msg) => logger_1.logger.info(msg.trim()) },
    }));
    app.use(rateLimiters_1.globalApiLimiter);
    // Phase 20 - report actual Mongo connection state alongside the static
    // "ok"/env body that already existed, rather than a bare liveness check
    // that says "ok" even when the database is unreachable. mongoose's
    // readyState is a simple in-memory flag (no extra DB round-trip), so this
    // stays cheap enough to hit on every load-balancer/uptime-monitor probe.
    // `status` only degrades to "degraded" when the DB is not connected -
    // never a new dependency, never new infrastructure, just an honest read
    // of state this app already tracks.
    app.get("/health", (_req, res) => {
        const READY_STATES = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
        const dbState = READY_STATES[mongoose_1.default.connection.readyState] || "unknown";
        res.json({
            status: dbState === "connected" ? "ok" : "degraded",
            env: env_1.env.NODE_ENV,
            db: dbState,
        });
    });
    app.use("/api/v1", v1_1.default);
    app.use(errorHandler_1.notFoundHandler);
    app.use(errorHandler_1.errorHandler);
    return app;
}
