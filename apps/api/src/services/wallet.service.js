"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditWallet = creditWallet;
exports.debitWalletIfSufficient = debitWalletIfSufficient;
exports.getWalletBalance = getWalletBalance;
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const ApiError_1 = require("../utils/ApiError");
async function getOrCreateWallet(organizationId) {
    let wallet = await models_1.Wallet.findOne({ organizationId });
    if (!wallet) {
        wallet = await models_1.Wallet.create({ organizationId, balance: 0 });
    }
    return wallet;
}
// Credits a wallet atomically. Idempotent on idempotencyKey - if a
// WalletTransaction with the same key already exists, this is a no-op,
// which is what prevents double-crediting a payment processed twice.
async function creditWallet(params) {
    const existing = await models_1.WalletTransaction.findOne({ idempotencyKey: params.idempotencyKey });
    if (existing)
        return existing;
    const wallet = await getOrCreateWallet(params.organizationId);
    // findOneAndUpdate with $inc is atomic at the document level in MongoDB,
    // avoiding read-modify-write race conditions between concurrent requests.
    const updated = await models_1.Wallet.findOneAndUpdate({ organizationId: params.organizationId }, { $inc: { balance: params.amount, version: 1 } }, { new: true });
    if (!updated)
        throw ApiError_1.ApiError.internal("Wallet update failed");
    try {
        return await models_1.WalletTransaction.create({
            organizationId: params.organizationId,
            type: shared_1.WalletTransactionType.CREDIT,
            amount: params.amount,
            balanceBefore: wallet.balance,
            balanceAfter: updated.balance,
            referenceType: params.referenceType,
            referenceId: params.referenceId,
            idempotencyKey: params.idempotencyKey,
            description: params.description,
            createdBy: params.createdBy,
        });
    }
    catch (err) {
        // Unique index violation on idempotencyKey means a concurrent request
        // already recorded this credit - roll back our increment to avoid double count.
        if (err?.code === 11000) {
            await models_1.Wallet.findOneAndUpdate({ organizationId: params.organizationId }, { $inc: { balance: -params.amount } });
            return models_1.WalletTransaction.findOne({ idempotencyKey: params.idempotencyKey });
        }
        throw err;
    }
}
// Debits a wallet atomically ONLY if sufficient balance exists, using a
// conditional update (balance >= amount) so concurrent debits cannot drive
// the balance negative (prevents race-condition double spending).
async function debitWalletIfSufficient(params) {
    const existing = await models_1.WalletTransaction.findOne({ idempotencyKey: params.idempotencyKey });
    if (existing)
        return { success: true, transaction: existing };
    const before = await getOrCreateWallet(params.organizationId);
    const updated = await models_1.Wallet.findOneAndUpdate({ organizationId: params.organizationId, balance: { $gte: params.amount } }, { $inc: { balance: -params.amount, version: 1 } }, { new: true });
    if (!updated) {
        return { success: false, reason: "INSUFFICIENT_BALANCE" };
    }
    try {
        const transaction = await models_1.WalletTransaction.create({
            organizationId: params.organizationId,
            type: shared_1.WalletTransactionType.DEBIT,
            amount: params.amount,
            balanceBefore: before.balance,
            balanceAfter: updated.balance,
            referenceType: params.referenceType,
            referenceId: params.referenceId,
            idempotencyKey: params.idempotencyKey,
            description: params.description,
            createdBy: params.createdBy,
        });
        return { success: true, transaction };
    }
    catch (err) {
        if (err?.code === 11000) {
            await models_1.Wallet.findOneAndUpdate({ organizationId: params.organizationId }, { $inc: { balance: params.amount } });
            const transaction = await models_1.WalletTransaction.findOne({ idempotencyKey: params.idempotencyKey });
            return { success: true, transaction: transaction };
        }
        throw err;
    }
}
async function getWalletBalance(organizationId) {
    const wallet = await getOrCreateWallet(organizationId);
    return wallet.balance;
}
