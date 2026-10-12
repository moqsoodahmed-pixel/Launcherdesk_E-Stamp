"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedEstampPackages = seedEstampPackages;
const db_1 = require("../config/db");
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
// One-off, idempotent seed matching the packages that used to be hardcoded
// client-side in BuyMoreModal.jsx, so moving the catalog server-side changes
// nothing visible on first deploy. Safe to run any number of times - an
// existing key is never overwritten.
const DEFAULT_PACKAGES = [
    {
        key: "starter",
        name: "Starter E-Stamp Pack",
        description: "Ideal for small teams with occasional stamping needs.",
        stampsCount: 25,
        price: 500,
        features: ["25 E-Stamps included", "Email support", "Standard processing queue"],
        validityDays: null,
        recommended: false,
        sortOrder: 1,
    },
    {
        key: "pro",
        name: "Pro Business Bundle",
        description: "Most popular choice for routine corporate and legal agreements.",
        stampsCount: 100,
        price: 1500,
        features: ["100 E-Stamps included", "Priority email support", "Standard processing queue"],
        validityDays: null,
        recommended: true,
        sortOrder: 2,
    },
    {
        key: "enterprise",
        name: "Enterprise Bundle",
        description: "High-volume bulk processing with priority queue fulfilment.",
        stampsCount: 500,
        price: 6000,
        features: ["500 E-Stamps included", "Priority processing queue", "Dedicated support SLA"],
        validityDays: null,
        recommended: false,
        sortOrder: 3,
    },
];
async function seedEstampPackages() {
    let created = 0;
    for (const pkg of DEFAULT_PACKAGES) {
        const res = await models_1.EstampPackage.updateOne({ key: pkg.key }, { $setOnInsert: pkg }, { upsert: true });
        if (res.upsertedCount)
            created += 1;
    }
    return { created, skipped: DEFAULT_PACKAGES.length - created };
}
if (require.main === module) {
    (async () => {
        await (0, db_1.connectDB)();
        try {
            const result = await seedEstampPackages();
            logger_1.logger.info(`E-Stamp package seed done: ${JSON.stringify(result)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
