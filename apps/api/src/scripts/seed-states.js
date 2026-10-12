"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedStates = seedStates;
const db_1 = require("../config/db");
const models_1 = require("../models");
const indianStates_1 = require("../utils/indianStates");
const logger_1 = require("../utils/logger");
// One-off, idempotent seed: populates the State master table from the same
// standard Indian state/UT reference used elsewhere (indianStates.js) - pure
// geographic naming, not stamp-duty data. Safe to re-run; an existing code
// is never overwritten.
async function seedStates() {
    let created = 0;
    for (const [code, name] of Object.entries(indianStates_1.STATE_CODE_TO_NAME)) {
        const res = await models_1.State.updateOne({ code }, { $setOnInsert: { code, name, isActive: true } }, { upsert: true });
        if (res.upsertedCount)
            created += 1;
    }
    return { created, total: Object.keys(indianStates_1.STATE_CODE_TO_NAME).length };
}
if (require.main === module) {
    (async () => {
        await (0, db_1.connectDB)();
        try {
            const result = await seedStates();
            logger_1.logger.info(`State master seed done: ${JSON.stringify(result)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
