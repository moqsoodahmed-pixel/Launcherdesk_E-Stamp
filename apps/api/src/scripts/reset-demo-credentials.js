"use strict";
// One-off operator script: wipes every User document in the TARGET database
// and recreates exactly one fresh account per role, all sharing the same
// password (meant for local/dev testing convenience, not production).
//
// Target database is taken from TARGET_MONGODB_URI (falls back to the
// project's own MONGODB_URI env var) - never hardcoded here, so this script
// carries no embedded secret and works against local Compass or Atlas by
// simply changing which URI is passed in at invocation time.
//
// Usage:
//   node src/scripts/reset-demo-credentials.js                  (uses .env MONGODB_URI - local)
//   TARGET_MONGODB_URI="mongodb+srv://..." node src/scripts/reset-demo-credentials.js   (Atlas)
require("dotenv").config();
const mongoose = require("mongoose");
const argon2 = require("argon2");

const TARGET_URI = process.env.TARGET_MONGODB_URI || process.env.MONGODB_URI;
const PASSWORD = process.env.RESET_PASSWORD || "Password123!";
const ORG_NAME = "LauncherDesk Demo Org";

async function main() {
    if (!TARGET_URI) {
        console.error("No target Mongo URI - set MONGODB_URI (.env) or TARGET_MONGODB_URI.");
        process.exit(1);
    }
    await mongoose.connect(TARGET_URI);
    const db = mongoose.connection.db;
    const users = db.collection("users");
    const orgs = db.collection("organizations");
    const wallets = db.collection("wallets");

    const deleted = await users.deleteMany({});
    console.log(`Deleted ${deleted.deletedCount} existing user(s).`);

    let org = await orgs.findOne({ name: ORG_NAME });
    if (!org) {
        const orgRes = await orgs.insertOne({
            name: ORG_NAME,
            contactEmail: "contact@launcherdeskdemo.local",
            contactPhone: "9999999999",
            status: "ACTIVE",
            isEstampServiceEnabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        org = { _id: orgRes.insertedId };
    }
    await wallets.updateOne(
        { organizationId: org._id },
        {
            $set: { balance: 5000, reservedBalance: 0, currency: "INR", updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
    );

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const now = new Date();
    const common = {
        passwordHash,
        isActive: true,
        mustChangePassword: false,
        lastOtpVerifiedAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
        tokenVersion: 0,
        permissions: [],
        createdAt: now,
        updatedAt: now,
    };

    const accounts = [
        { name: "Master Admin", email: "masteradmin@launcherdesk.com", role: "MASTER_ADMIN", organizationId: null },
        { name: "Assistant Master Admin", email: "assistantadmin@launcherdesk.com", role: "ASSISTANT_MASTER_ADMIN", organizationId: null },
        { name: "Super Admin", email: "superadmin@launcherdesk.com", role: "SUPER_ADMIN", organizationId: org._id },
        { name: "Admin", email: "admin@launcherdesk.com", role: "ADMIN", organizationId: org._id },
        { name: "User", email: "user@launcherdesk.com", role: "USER", organizationId: org._id },
    ];

    let assistantId = null;
    for (const acc of accounts) {
        const ins = await users.insertOne({ ...common, ...acc });
        if (acc.role === "ASSISTANT_MASTER_ADMIN") {
            assistantId = ins.insertedId;
        }
    }
    if (assistantId) {
        await orgs.updateMany({}, { $set: { assignedAssistantId: assistantId } });
    }

    console.log(`Created ${accounts.length} fresh account(s) in organization "${ORG_NAME}" (${org._id}).`);
    console.log("--------------------------------------------------");
    for (const acc of accounts) {
        console.log(`${acc.role.padEnd(22)} ${acc.email}  /  ${PASSWORD}`);
    }
    console.log("--------------------------------------------------");

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("Reset failed:", err.message);
    process.exit(1);
});
