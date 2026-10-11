"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDraftPolicies = seedDraftPolicies;
const db_1 = require("../config/db");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const logger_1 = require("../utils/logger");
// Safe to run on an existing database (unlike seed.js, which stops as soon
// as a Master Admin exists). For every policy type that has NO version at
// all, creates a DRAFT version 0.1 with clearly-marked placeholder text.
// Nothing is published: a Master Admin replaces the text and publishes it
// from Manage Policies. Never invents legal language.
const DRAFT_CONTENT = "DRAFT - REPLACE BEFORE LAUNCH.\n\nThis is placeholder text, not a real policy. Replace it with your approved legal text, then publish it from Manage Policies.";
async function seedDraftPolicies() {
    const master = await models_1.User.findOne({ role: shared_1.Role.MASTER_ADMIN }).select("_id");
    if (!master)
        throw new Error("No Master Admin exists - run the main seed first.");
    const created = [];
    for (const type of Object.values(models_1.PolicyType)) {
        const exists = await models_1.Policy.exists({ type });
        if (exists)
            continue;
        await models_1.Policy.create({
            type,
            version: "0.1",
            title: `${type.charAt(0)}${type.slice(1).toLowerCase()} Policy (Draft, replace before launch)`,
            content: DRAFT_CONTENT,
            status: models_1.PolicyStatus.DRAFT,
            createdBy: master._id,
        });
        created.push(type);
    }
    return created;
}
if (require.main === module) {
    (async () => {
        await (0, db_1.connectDB)();
        try {
            const created = await seedDraftPolicies();
            logger_1.logger.info(created.length ? `Created DRAFT policies: ${created.join(", ")}. Replace the text and publish them from Manage Policies.` : "Every policy type already has a version - nothing created.");
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
