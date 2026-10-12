"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enableEstampServiceForActiveOrgs = enableEstampServiceForActiveOrgs;
const db_1 = require("../config/db");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const logger_1 = require("../utils/logger");
// Bulk version of Master Admin's existing "Enable E-Stamp Service" toggle
// (organization.controller.js's setEstampServiceEnabled) - flips the flag for
// every ACTIVE organization that doesn't already have it, instead of one at a
// time through the UI. PENDING_APPROVAL/SUSPENDED orgs are left untouched:
// approval must still happen through the normal workflow before an org can
// transact - this only catches already-approved orgs the flag was never set
// on.
//
// Usage: node src/scripts/enable-estamp-service-bulk.js
// Target database: uses TARGET_MONGODB_URI if set, else the usual MONGODB_URI
// (.env) - same convention as grant-permission.js/reset-demo-credentials.js:
//   TARGET_MONGODB_URI="<atlas-uri>" node src/scripts/enable-estamp-service-bulk.js
async function enableEstampServiceForActiveOrgs() {
    const filter = { status: shared_1.OrganizationStatus.ACTIVE, isEstampServiceEnabled: false };
    const matching = await models_1.Organization.find(filter).select("name").lean();
    const result = await models_1.Organization.updateMany(filter, { $set: { isEstampServiceEnabled: true } });
    return { matchedOrgs: matching.map((o) => ({ id: o._id.toString(), name: o.name })), modifiedCount: result.modifiedCount };
}
if (require.main === module) {
    (async () => {
        const targetUri = process.env.TARGET_MONGODB_URI;
        if (targetUri)
            process.env.MONGODB_URI = targetUri;
        await (0, db_1.connectDB)();
        try {
            const result = await enableEstampServiceForActiveOrgs();
            logger_1.logger.info(`Enabled E-Stamp service for ${result.modifiedCount} ACTIVE organization(s): ${JSON.stringify(result.matchedOrgs)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
