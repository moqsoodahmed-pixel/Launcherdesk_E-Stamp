"use strict";
// One-off, operator-run, DESTRUCTIVE script: wipes all demo/transactional
// data from the TARGET database while preserving Master Admin and Assistant
// Master Admin user accounts (and their real passwords) untouched, and
// preserving reference/config collections (Article, ArticleVersion, State,
// SystemSetting, Policy, EstampPackage). Also resets the Counter collection
// so the next request/order/batch/invoice number issued after this run
// starts at 1 again (see ../utils/sequence.js).
//
// This is irreversible. No backup is taken by this script - the operator
// decided a backup was not needed for this run. Never logs a password or
// password hash.
//
// Target database is taken from TARGET_MONGODB_URI (falls back to the
// project's own MONGODB_URI env var) - never hardcoded here.
//
// Usage:
//   node src/scripts/reset-live-database.js                       (uses .env MONGODB_URI)
//   TARGET_MONGODB_URI="mongodb+srv://..." node src/scripts/reset-live-database.js
//
// Safety gate: requires CONFIRM=WIPE in the environment, so this can never
// be triggered by an accidental bare invocation.
require("dotenv").config();
const mongoose = require("mongoose");

const TARGET_URI = process.env.TARGET_MONGODB_URI || process.env.MONGODB_URI;

// Collections wiped entirely (all documents deleted).
const COLLECTIONS_TO_WIPE = [
    "organizations",
    "otps",
    "refreshtokens",
    "wallets",
    "wallettransactions",
    "payments",
    "estamprequests",
    "estamporders",
    "fileassets",
    "estampdocuments",
    "notifications",
    "auditlogs",
    "estampproviderbalancesnapshots",
    "emaillogs",
    "bulkestampbatches",
    "bulkestampbatchitems",
    "policyacknowledgements",
];

// Reference/config collections explicitly preserved - never touched here.
const COLLECTIONS_PRESERVED = [
    "articles",
    "articleversions",
    "states",
    "systemsettings",
    "policies",
    "estamppackages",
];

const PRESERVED_USER_ROLES = ["MASTER_ADMIN", "ASSISTANT_MASTER_ADMIN"];

// Core reset logic, factored out of main() so it can be exercised directly
// against a test database (see tests/reset-live-database.test.js) without
// spawning this file as a child process or depending on CONFIRM/env vars.
async function performReset(db) {
    const summary = {};

    for (const name of COLLECTIONS_TO_WIPE) {
        const collection = db.collection(name);
        const result = await collection.deleteMany({});
        summary[name] = result.deletedCount;
    }

    const users = db.collection("users");
    const preservedUsers = await users
        .find({ role: { $in: PRESERVED_USER_ROLES } }, { projection: { name: 1, email: 1, role: 1 } })
        .toArray();
    const deletedUsers = await users.deleteMany({ role: { $nin: PRESERVED_USER_ROLES } });
    summary.users = deletedUsers.deletedCount;

    const counters = db.collection("counters");
    const resetCounters = await counters.deleteMany({});
    summary.counters = resetCounters.deletedCount;

    return { summary, preservedUsers };
}
exports.performReset = performReset;
exports.COLLECTIONS_TO_WIPE = COLLECTIONS_TO_WIPE;
exports.COLLECTIONS_PRESERVED = COLLECTIONS_PRESERVED;
exports.PRESERVED_USER_ROLES = PRESERVED_USER_ROLES;

async function main() {
    if (!TARGET_URI) {
        console.error("No target Mongo URI - set MONGODB_URI (.env) or TARGET_MONGODB_URI.");
        process.exit(1);
    }
    if (process.env.CONFIRM !== "WIPE") {
        console.error("Refusing to run: set CONFIRM=WIPE in the environment to proceed.");
        console.error(`Target URI resolves to: ${TARGET_URI.replace(/\/\/.*@/, "//<redacted>@")}`);
        process.exit(1);
    }

    await mongoose.connect(TARGET_URI);
    const db = mongoose.connection.db;
    console.log(`Connected to database: ${db.databaseName}`);

    const { summary, preservedUsers } = await performReset(db);

    console.log("\n=== Reset summary (documents deleted per collection) ===");
    for (const [name, count] of Object.entries(summary)) {
        console.log(`  ${name}: ${count}`);
    }

    console.log("\n=== Preserved config/reference collections (untouched) ===");
    for (const name of COLLECTIONS_PRESERVED) {
        console.log(`  ${name}`);
    }

    console.log("\n=== Preserved user accounts (name / email / role only) ===");
    for (const u of preservedUsers) {
        console.log(`  ${u.name || "(no name)"} | ${u.email} | ${u.role}`);
    }
    console.log(`\nTotal preserved: ${preservedUsers.length}`);

    await mongoose.disconnect();
    console.log("\nDone.");
}

if (require.main === module) {
    main().catch((err) => {
        console.error("Reset failed:", err.message);
        process.exit(1);
    });
}
