"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256Hex = sha256Hex;
exports.generateNumericCode = generateNumericCode;
exports.generateOpaqueToken = generateOpaqueToken;
const crypto_1 = __importDefault(require("crypto"));
// Used for hashing OTPs and reset codes - NOT for passwords (use argon2 for those).
function sha256Hex(value) {
    return crypto_1.default.createHash("sha256").update(value).digest("hex");
}
function generateNumericCode(length = 6) {
    const digits = "0123456789";
    let out = "";
    const bytes = crypto_1.default.randomBytes(length);
    for (let i = 0; i < length; i++) {
        out += digits[bytes[i] % digits.length];
    }
    return out;
}
function generateOpaqueToken(bytes = 32) {
    return crypto_1.default.randomBytes(bytes).toString("hex");
}
