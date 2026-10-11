"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditWallet = creditWallet;
exports.debitWalletIfSufficient = debitWalletIfSufficient;
exports.getWalletBalance = getWalletBalance;
exports.getWalletSummary = getWalletSummary;
exports.reserveFunds = reserveFunds;
exports.releaseReservation = releaseReservation;
exports.chargeReservation = chargeReservation;
exports.reconcileWallets = reconcileWallets;
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const ApiError_1 = require("../utils/ApiError");
// How many recently applied ledger entry ids each wallet remembers. A retry
// of an interrupted entry happens within the same job tick / user retry, so
// this only needs to outlive that window; reconcileWallets() catches anything
// older.
const APPLIED_TX_MEMORY = 500;
async function getOrCreateWallet(organizationId) {
    // Upsert so two concurrent first-time callers cannot race into a
    // duplicate-key error on the unique organizationId index.
    return models_1.Wallet.findOneAndUpdate({ organizationId }, { $setOnInsert: { organizationId, balance: 0, reservedBalance: 0 } }, { upsert: true, new: true });
}
// ---------------------------------------------------------------------------
// Ledger-first money movement (crash-safe).
//
//   1. INSERT the ledger entry, marked pending, under its unique
//      idempotencyKey. Only one caller can ever own a key.
//   2. UPDATE the wallet, conditionally: the update also records the entry's
//      id in wallet.appliedTxIds and only matches if that id is NOT already
//      there - so the balance moves at most once per entry, even if step 2
//      runs twice.
//   3. FINALIZE the entry (balanceBefore/After, pending removed).
//
// A crash after 1 leaves a pending entry: the next call with the same key
// finds it and resumes at 2 (guarded) and 3. A crash after 2 leaves the
// wallet already moved: the resumed step 2 does not match (id recorded), so
// only 3 runs. Pending entries are never shown in the ledger and are counted
// separately by reconcileWallets().
// ---------------------------------------------------------------------------
async function applyLedgerEntry(params) {
    const { organizationId, type, amount, idempotencyKey, walletCondition = {}, walletInc } = params;
    await getOrCreateWallet(organizationId);
    let entry = await models_1.WalletTransaction.findOne({ idempotencyKey });
    if (entry && !entry.pending)
        return { success: true, transaction: entry, alreadyApplied: true };
    if (!entry) {
        try {
            entry = await models_1.WalletTransaction.create({
                organizationId,
                type,
                amount,
                balanceBefore: 0,
                balanceAfter: 0,
                referenceType: params.referenceType,
                referenceId: params.referenceId,
                idempotencyKey,
                description: params.description,
                createdBy: params.createdBy ?? null,
                pending: true,
            });
        }
        catch (err) {
            if (err?.code !== 11000)
                throw err;
            // Someone else owns this key - resume (or report) their entry.
            entry = await models_1.WalletTransaction.findOne({ idempotencyKey });
            if (!entry.pending)
                return { success: true, transaction: entry, alreadyApplied: true };
        }
    }
    // Step 2: move the wallet at most once for this entry.
    const before = await models_1.Wallet.findOneAndUpdate({ organizationId, appliedTxIds: { $ne: entry._id }, ...walletCondition }, { $inc: { ...walletInc, version: 1 }, $push: { appliedTxIds: { $each: [entry._id], $slice: -APPLIED_TX_MEMORY } } }, { new: false });
    let balanceBefore;
    if (before) {
        balanceBefore = before.balance;
    }
    else {
        const wallet = await models_1.Wallet.findOne({ organizationId }).select("+appliedTxIds balance");
        const alreadyMoved = (wallet?.appliedTxIds || []).some((id) => id.toString() === entry._id.toString());
        if (!alreadyMoved) {
            // The condition (e.g. sufficient balance) failed: nothing moved,
            // so the pending entry must not survive.
            await models_1.WalletTransaction.deleteOne({ _id: entry._id, pending: true });
            return { success: false, reason: params.failureReason || "CONDITION_FAILED" };
        }
        // Moved by an earlier, interrupted attempt; reconstruct the figures.
        balanceBefore = wallet.balance - (walletInc.balance || 0);
    }
    // Step 3: finalize. Conditional on still pending so it is idempotent.
    const finalized = await models_1.WalletTransaction.findOneAndUpdate({ _id: entry._id, pending: true }, { $set: { balanceBefore, balanceAfter: balanceBefore + (walletInc.balance || 0) }, $unset: { pending: "" } }, { new: true });
    return { success: true, transaction: finalized || (await models_1.WalletTransaction.findById(entry._id)) };
}
// Credits a wallet. Idempotent on idempotencyKey: the same key can never
// credit twice (that is what prevents double-crediting a payment).
async function creditWallet(params) {
    if (!Number.isFinite(params.amount) || params.amount <= 0)
        throw ApiError_1.ApiError.badRequest("Invalid amount", "INVALID_AMOUNT");
    const result = await applyLedgerEntry({ ...params, type: shared_1.WalletTransactionType.CREDIT, walletInc: { balance: params.amount } });
    return result.transaction;
}
// Debits a wallet ONLY if balance >= amount, atomically, so concurrent
// debits can never drive it negative. Idempotent on idempotencyKey.
async function debitWalletIfSufficient(params) {
    const result = await applyLedgerEntry({
        ...params,
        type: shared_1.WalletTransactionType.DEBIT,
        walletCondition: { balance: { $gte: params.amount } },
        walletInc: { balance: -params.amount },
        failureReason: "INSUFFICIENT_BALANCE",
    });
    return result.success ? { success: true, transaction: result.transaction } : { success: false, reason: "INSUFFICIENT_BALANCE" };
}
async function getWalletBalance(organizationId) {
    const wallet = await getOrCreateWallet(organizationId);
    return wallet.balance;
}
// balance, reservedBalance and availableBalance (= balance - reserved).
async function getWalletSummary(organizationId) {
    const wallet = await getOrCreateWallet(organizationId);
    const reservedBalance = wallet.reservedBalance || 0;
    return {
        balance: wallet.balance,
        reservedBalance,
        availableBalance: wallet.balance - reservedBalance,
        currency: wallet.currency,
    };
}
// Available = balance - reservedBalance, computed inside the query so the
// check and the increment happen in ONE atomic document update. $ifNull
// covers wallets created before reservedBalance existed.
function availableAtLeast(amount) {
    return { $expr: { $gte: [{ $subtract: ["$balance", { $ifNull: ["$reservedBalance", 0] }] }, amount] } };
}
// Holds `amount` against the organization's available balance. Succeeds
// only if available >= amount at write time, so N concurrent submits can
// never reserve more than the balance covers. No ledger entry: nothing has
// been spent yet.
async function reserveFunds(params) {
    if (!Number.isFinite(params.amount) || params.amount < 0)
        throw ApiError_1.ApiError.badRequest("Invalid amount", "INVALID_AMOUNT");
    await getOrCreateWallet(params.organizationId);
    if (params.amount === 0)
        return { success: true };
    const updated = await models_1.Wallet.findOneAndUpdate({ organizationId: params.organizationId, ...availableAtLeast(params.amount) }, { $inc: { reservedBalance: params.amount, version: 1 } }, { new: true });
    return updated ? { success: true, wallet: updated } : { success: false, reason: "INSUFFICIENT_BALANCE" };
}
// Gives back a reservation (cancel, or the downward half of a modify).
// Conditional on reservedBalance >= amount so it can never go negative.
async function releaseReservation(params) {
    if (!params.amount || params.amount <= 0)
        return { success: true };
    const updated = await models_1.Wallet.findOneAndUpdate({ organizationId: params.organizationId, reservedBalance: { $gte: params.amount } }, { $inc: { reservedBalance: -params.amount, version: 1 } }, { new: true });
    return updated ? { success: true, wallet: updated } : { success: false, reason: "RESERVATION_MISMATCH" };
}
// Converts a reservation into a real DEBIT: balance and reservedBalance both
// drop by `amount` in one atomic, at-most-once wallet update, recorded by
// exactly one ledger entry under `idempotencyKey`. If the balance no longer
// covers the amount (e.g. an admin adjusted it), nothing changes and
// SHORTFALL is returned - the reservation stays in place.
async function chargeReservation(params) {
    const result = await applyLedgerEntry({
        ...params,
        type: shared_1.WalletTransactionType.DEBIT,
        walletCondition: { balance: { $gte: params.amount }, reservedBalance: { $gte: params.amount } },
        walletInc: { balance: -params.amount, reservedBalance: -params.amount },
        failureReason: "SHORTFALL",
    });
    if (!result.success)
        return { success: false, reason: "SHORTFALL" };
    return { success: true, transaction: result.transaction, alreadyCharged: !!result.alreadyApplied };
}
// Report-only consistency check. For every wallet (or one organization):
//   - balance vs the signed sum of its finalized ledger entries
//     (CREDIT/REFUND +, DEBIT -; ADJUSTMENT entries use balanceAfter -
//     balanceBefore, since their direction is not implied by the type)
//   - reservedBalance vs the sum of reservedAmount over its requests still
//     RESERVED or SHORTFALL
//   - pending (interrupted) ledger entries
// Returns only wallets with a difference unless `includeAll` is set. Never
// modifies anything. Note: wallets funded before the ledger existed (e.g.
// seeded opening balances) legitimately show a difference.
async function reconcileWallets({ organizationId, includeAll = false } = {}) {
    const walletFilter = organizationId ? { organizationId } : {};
    const wallets = await models_1.Wallet.find(walletFilter).select("organizationId balance reservedBalance");
    const orgIds = wallets.map((w) => w.organizationId);
    const [ledger, pending, reserved] = await Promise.all([
        models_1.WalletTransaction.aggregate([
            { $match: { organizationId: { $in: orgIds }, pending: { $ne: true } } },
            {
                $group: {
                    _id: "$organizationId",
                    sum: {
                        $sum: {
                            $switch: {
                                branches: [
                                    { case: { $in: ["$type", ["CREDIT", "REFUND"]] }, then: "$amount" },
                                    { case: { $eq: ["$type", "DEBIT"] }, then: { $multiply: ["$amount", -1] } },
                                ],
                                default: { $subtract: ["$balanceAfter", "$balanceBefore"] },
                            },
                        },
                    },
                },
            },
        ]),
        models_1.WalletTransaction.aggregate([{ $match: { organizationId: { $in: orgIds }, pending: true } }, { $group: { _id: "$organizationId", count: { $sum: 1 } } }]),
        models_1.EStampRequest.aggregate([
            { $match: { organizationId: { $in: orgIds }, chargeStatus: { $in: ["RESERVED", "SHORTFALL"] } } },
            { $group: { _id: "$organizationId", sum: { $sum: "$reservedAmount" } } },
        ]),
    ]);
    const byId = (rows, field) => new Map(rows.map((r) => [r._id.toString(), r[field]]));
    const ledgerSum = byId(ledger, "sum");
    const pendingCount = byId(pending, "count");
    const reservedSum = byId(reserved, "sum");
    const report = wallets.map((w) => {
        const id = w.organizationId.toString();
        const sum = ledgerSum.get(id) || 0;
        const expectedReserved = reservedSum.get(id) || 0;
        const reservedNow = w.reservedBalance || 0;
        return {
            organizationId: id,
            balance: w.balance,
            ledgerSum: sum,
            balanceDifference: w.balance - sum,
            reservedBalance: reservedNow,
            reservedExpected: expectedReserved,
            reservedDifference: reservedNow - expectedReserved,
            pendingEntries: pendingCount.get(id) || 0,
        };
    });
    return includeAll ? report : report.filter((r) => r.balanceDifference !== 0 || r.reservedDifference !== 0 || r.pendingEntries > 0);
}
