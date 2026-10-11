"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../config/db");
const wallet_service_1 = require("../services/wallet.service");
const logger_1 = require("../utils/logger");
// Read-only: prints every wallet whose balance differs from its ledger, whose
// reservedBalance differs from its open reservations, or that has pending
// (interrupted) ledger entries. Exit code 2 when anything is reported, so it
// can run in a scheduled check. Never changes data.
if (require.main === module) {
    (async () => {
        await (0, db_1.connectDB)();
        let issues = [];
        try {
            issues = await (0, wallet_service_1.reconcileWallets)();
            if (issues.length === 0)
                logger_1.logger.info("Wallet reconciliation: every wallet matches its ledger and reservations.");
            else
                logger_1.logger.warn(`Wallet reconciliation: ${issues.length} wallet(s) need attention: ${JSON.stringify(issues)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
        if (issues.length)
            process.exit(2);
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
