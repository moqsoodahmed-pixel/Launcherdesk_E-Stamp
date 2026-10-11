"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateBalanceLedger = migrateBalanceLedger;
const db_1 = require("../config/db");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const logger_1 = require("../utils/logger");
// One-off, idempotent migration to the balance-ledger flow. Safe to run any
// number of times: every update only touches rows that do not have the new
// field yet, so nothing is ever charged or credited twice.
//
// Before this change, requests were DEBITED at submit and verified Razorpay
// payments auto-CREDITED the wallet. The code already treats a missing
// chargeStatus / balanceStatus as "charged" / "credited"; this script makes
// that explicit in the data:
//   1. EStampRequest without chargeStatus -> CHARGED (reservedAmount 0).
//   2. SUCCESS Payment without balanceStatus -> CREDITED when its ledger
//      credit (idempotency key payment:<id>) exists. If, unusually, no
//      credit exists, it becomes PENDING_CREDIT so an admin can credit it -
//      still protected by the same idempotency key.
//   3. Wallet without reservedBalance -> 0.
// It never creates or changes a WalletTransaction and never changes a
// wallet's balance.
async function migrateBalanceLedger() {
    const requests = await models_1.EStampRequest.updateMany({ chargeStatus: { $exists: false } }, { $set: { chargeStatus: "CHARGED", reservedAmount: 0 } });
    const wallets = await models_1.Wallet.updateMany({ reservedBalance: { $exists: false } }, { $set: { reservedBalance: 0 } });
    let paymentsCredited = 0;
    let paymentsPending = 0;
    const legacyPayments = models_1.Payment.find({ status: shared_1.PaymentStatus.SUCCESS, balanceStatus: { $exists: false } }).cursor();
    for await (const payment of legacyPayments) {
        const tx = await models_1.WalletTransaction.findOne({ idempotencyKey: `payment:${payment._id.toString()}`, pending: { $ne: true } }).select("_id createdAt");
        const update = tx
            ? { balanceStatus: "CREDITED", creditedAt: tx.createdAt, walletTransactionId: tx._id }
            : { balanceStatus: "PENDING_CREDIT" };
        const res = await models_1.Payment.updateOne({ _id: payment._id, balanceStatus: { $exists: false } }, { $set: update });
        if (res.modifiedCount) {
            if (tx)
                paymentsCredited += 1;
            else
                paymentsPending += 1;
        }
    }
    return {
        requestsMarkedCharged: requests.modifiedCount,
        walletsInitialized: wallets.modifiedCount,
        paymentsMarkedCredited: paymentsCredited,
        paymentsMarkedPendingCredit: paymentsPending,
    };
}
if (require.main === module) {
    (async () => {
        await (0, db_1.connectDB)();
        try {
            const result = await migrateBalanceLedger();
            logger_1.logger.info(`Balance ledger migration done: ${JSON.stringify(result)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
