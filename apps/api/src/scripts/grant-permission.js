"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantPermission = grantPermission;
const db_1 = require("../config/db");
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
// General-purpose, idempotent permission grant for a single user by email.
// Adds a permission to that user's stored permissions array (merge, never
// overwrite) - the same operation available via Manage Admins -> Edit
// permissions in the UI, just scriptable for one-off fixes/automation.
//
// Usage: EMAIL="user@example.com" PERMISSION="order.manage" node src/scripts/grant-permission.js
// Target database: uses TARGET_MONGODB_URI if set, else the usual MONGODB_URI
// (.env) - same convention as reset-demo-credentials.js, so this can target
// a different environment (e.g. Atlas) without any code change:
//   EMAIL="jeevan@launcherdesk.com" PERMISSION="order.manage" TARGET_MONGODB_URI="<atlas-uri>" node src/scripts/grant-permission.js
async function grantPermission(email, permission) {
    const user = await models_1.User.findOne({ email });
    if (!user) {
        return { found: false };
    }
    const already = user.permissions.includes(permission);
    if (!already) {
        user.permissions.push(permission);
        await user.save();
    }
    return { found: true, alreadyHadIt: already, permissions: user.permissions };
}
if (require.main === module) {
    (async () => {
        const email = process.env.EMAIL;
        const permission = process.env.PERMISSION;
        if (!email || !permission) {
            logger_1.logger.error('Usage: EMAIL="user@example.com" PERMISSION="order.manage" node src/scripts/grant-permission.js');
            process.exit(1);
        }
        const targetUri = process.env.TARGET_MONGODB_URI;
        if (targetUri)
            process.env.MONGODB_URI = targetUri;
        await (0, db_1.connectDB)();
        try {
            const result = await grantPermission(email, permission);
            if (!result.found) {
                logger_1.logger.error(`No user found with email ${email}`);
                process.exit(1);
            }
            logger_1.logger.info(`${result.alreadyHadIt ? "Already had" : "Granted"} "${permission}" to ${email}. Full permission set: ${JSON.stringify(result.permissions)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
