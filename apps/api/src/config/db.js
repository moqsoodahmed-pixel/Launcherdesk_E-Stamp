"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
exports.disconnectDB = disconnectDB;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./env");
const logger_1 = require("../utils/logger");
async function connectDB() {
    mongoose_1.default.set("strictQuery", true);
    await mongoose_1.default.connect(env_1.env.MONGODB_URI);
    logger_1.logger.info("MongoDB connected");
    mongoose_1.default.connection.on("error", (err) => {
        logger_1.logger.error("MongoDB connection error", { error: err.message });
    });
    mongoose_1.default.connection.on("disconnected", () => {
        logger_1.logger.warn("MongoDB disconnected");
    });
}
async function disconnectDB() {
    await mongoose_1.default.disconnect();
}
