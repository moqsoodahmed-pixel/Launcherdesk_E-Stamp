"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMP_PASSWORD_TTL_MS = void 0;
exports.getKey = getKey;
exports.isEnabled = isEnabled;
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.storeTemporaryPassword = storeTemporaryPassword;
exports.purgeTemporaryPassword = purgeTemporaryPassword;
exports.purgeExpiredTemporaryPasswords = purgeExpiredTemporaryPasswords;
exports.passwordStateOf = passwordStateOf;
exports.generateTemporaryPassword = generateTemporaryPassword;
const crypto_1 = require("crypto");
const env_1 = require("../config/env");
const logger_1 = require("./logger");
// Reversible storage for SYSTEM-GENERATED TEMPORARY passwords only, so a
// Master Admin can hand one over until the user sets their own. A password a
// user chose is never passed here - every change/reset purges the value.
// AES-256-GCM, a random 12-byte IV per value, the user id as associated data
// (a ciphertext copied onto another user fails to decrypt). Without a valid
// CREDENTIAL_ENCRYPTION_KEY the feature is simply off: nothing is stored and
// reveal answers "not available".
exports.TEMP_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let warned = false;
function getKey() {
    const raw = env_1.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!raw)
        return null;
    try {
        const key = Buffer.from(raw, "base64");
        return key.length === 32 ? key : null;
    }
    catch {
        return null;
    }
}
function isEnabled() {
    const enabled = !!getKey();
    if (!enabled && !warned) {
        warned = true;
        logger_1.logger.warn("[credentials] CREDENTIAL_ENCRYPTION_KEY is missing or not 32 bytes (base64) - temporary passwords are shown once only and cannot be revealed later.");
    }
    return enabled;
}
// Same generator and strength as every existing temporary password.
function generateTemporaryPassword() {
    return (0, crypto_1.randomBytes)(9).toString("base64url");
}
function encrypt(userId, plaintext, key = getKey()) {
    if (!key)
        return null;
    const iv = (0, crypto_1.randomBytes)(12);
    const cipher = (0, crypto_1.createCipheriv)("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(String(userId)));
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
    return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), createdAt: new Date() };
}
// Throws on a wrong key, wrong user id or any tampering.
function decrypt(userId, enc, key = getKey()) {
    if (!key)
        throw new Error("Credential encryption is not configured");
    const decipher = (0, crypto_1.createDecipheriv)("aes-256-gcm", key, Buffer.from(enc.iv, "base64"));
    decipher.setAAD(Buffer.from(String(userId)));
    decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
// Stores (or replaces) the user's revealable temporary password. A no-op
// when the feature is off. `tempPasswordExpiresAt` is the only non-secret
// companion field, used for list badges without loading the ciphertext.
async function storeTemporaryPassword(userId, plaintext) {
    const { User } = require("../models");
    if (!isEnabled()) {
        await User.updateOne({ _id: userId }, { $unset: { initialPasswordEnc: "", tempPasswordExpiresAt: "" } });
        return false;
    }
    const enc = encrypt(userId, plaintext);
    await User.updateOne({ _id: userId }, { $set: { initialPasswordEnc: enc, tempPasswordExpiresAt: new Date(enc.createdAt.getTime() + exports.TEMP_PASSWORD_TTL_MS) } });
    return true;
}
async function purgeTemporaryPassword(userId) {
    const { User } = require("../models");
    await User.updateOne({ _id: userId }, { $unset: { initialPasswordEnc: "", tempPasswordExpiresAt: "" } });
}
// Hourly job + lazy check on read.
async function purgeExpiredTemporaryPasswords(now = new Date()) {
    const { User } = require("../models");
    const res = await User.updateMany({ tempPasswordExpiresAt: { $lte: now } }, { $unset: { initialPasswordEnc: "", tempPasswordExpiresAt: "" } });
    return res.modifiedCount || 0;
}
function passwordStateOf(user, now = Date.now()) {
    return user?.tempPasswordExpiresAt && new Date(user.tempPasswordExpiresAt).getTime() > now ? "TEMPORARY" : "SET_BY_USER";
}
