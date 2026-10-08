"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const auth_service_1 = require("../services/auth.service");
const logger_1 = require("../utils/logger");
// Safe, synthetic development seed data only. No real personal information.
// Master Admin creation is NEVER exposed via public registration - this
// script is the only supported way to bootstrap the first Master Admin.
async function seed() {
    await (0, db_1.connectDB)();
    if (!env_1.env.SEED_MASTER_ADMIN_PASSWORD) {
        logger_1.logger.error("SEED_MASTER_ADMIN_PASSWORD is not set in the environment. Aborting seed for safety.");
        process.exit(1);
    }
    const existingMaster = await models_1.User.findOne({ role: shared_1.Role.MASTER_ADMIN });
    if (existingMaster) {
        logger_1.logger.info("Master Admin already exists - skipping seed.");
        await (0, db_1.disconnectDB)();
        return;
    }
    const masterPasswordHash = await auth_service_1.AuthService.hashPassword(env_1.env.SEED_MASTER_ADMIN_PASSWORD);
    const masterAdmin = await models_1.User.create({
        name: "Master Admin",
        email: env_1.env.SEED_MASTER_ADMIN_EMAIL,
        passwordHash: masterPasswordHash,
        role: shared_1.Role.MASTER_ADMIN,
        organizationId: null,
        lastOtpVerifiedAt: new Date(), // seed account starts pre-verified for convenience
    });
    const assistantPasswordHash = await auth_service_1.AuthService.hashPassword("ChangeMe!Assistant1");
    const assistantAdmin = await models_1.User.create({
        name: "Assistant Master Admin (Demo)",
        email: "assistant@launcherdesk.local",
        passwordHash: assistantPasswordHash,
        role: shared_1.Role.ASSISTANT_MASTER_ADMIN,
        organizationId: null,
        // Assistant Master Admin permissions are NOT auto-granted from role
        // defaults (see packages/shared/src/permissions.js) - Master Admin
        // must explicitly assign them. We seed this demo account with the
        // standard starting template so its access matches previous behavior.
        permissions: shared_1.DEFAULT_ROLE_PERMISSIONS[shared_1.Role.ASSISTANT_MASTER_ADMIN],
        createdBy: masterAdmin._id,
        mustChangePassword: true,
        lastOtpVerifiedAt: new Date(),
    });
    const org = await models_1.Organization.create({
        name: env_1.env.SEED_DEMO_ORG_NAME,
        contactEmail: "contact@democlient.local",
        contactPhone: "9999999999",
        status: shared_1.OrganizationStatus.ACTIVE,
        isEstampServiceEnabled: true,
        createdBy: masterAdmin._id,
    });
    await models_1.Wallet.create({ organizationId: org._id, balance: 5000 });
    const superAdminHash = await auth_service_1.AuthService.hashPassword("ChangeMe!SuperAdmin1");
    const superAdmin = await models_1.User.create({
        name: "Demo Super Admin",
        email: "superadmin@democlient.local",
        passwordHash: superAdminHash,
        role: shared_1.Role.SUPER_ADMIN,
        organizationId: org._id,
        createdBy: masterAdmin._id,
        mustChangePassword: true,
        lastOtpVerifiedAt: new Date(),
    });
    const adminHash = await auth_service_1.AuthService.hashPassword("ChangeMe!Admin1");
    await models_1.User.create({
        name: "Demo Admin",
        email: "admin@democlient.local",
        passwordHash: adminHash,
        role: shared_1.Role.ADMIN,
        organizationId: org._id,
        createdBy: superAdmin._id,
        mustChangePassword: true,
        lastOtpVerifiedAt: new Date(),
    });
    const userHash = await auth_service_1.AuthService.hashPassword("ChangeMe!User1");
    await models_1.User.create({
        name: "Demo Employee",
        email: "employee@democlient.local",
        passwordHash: userHash,
        role: shared_1.Role.USER,
        organizationId: org._id,
        createdBy: superAdmin._id,
        mustChangePassword: true,
        lastOtpVerifiedAt: new Date(),
    });
    // Sample state-wise Article: Karnataka Article 2(B), fixed-amount rule,
    // modeled loosely on the reference certificate's data structure only
    // (no real certificate numbers/seals/QR content is reproduced anywhere).
    const article = await models_1.Article.create({
        stateCode: "KA",
        articleCode: "2(B)",
        title: "Administration Bond - In any other case",
        description: "Karnataka stamp duty article for administration bonds.",
        createdBy: masterAdmin._id,
        currentVersion: 1,
    });
    await models_1.ArticleVersion.create({
        articleId: article._id,
        versionNumber: 1,
        calculationRule: { type: "FIXED", fixedAmount: 100, minAmount: 100 },
        createdBy: masterAdmin._id,
    });
    // Phase 16 - OPTIONAL demo policy content, skippable, not a hard
    // requirement of this script. No approved legal Terms/Privacy/Refund
    // text has been supplied anywhere in this repository - this seeds
    // exactly one clearly-marked placeholder per type so the public
    // current-policy endpoint isn't always empty in a fresh dev
    // environment. Never real/invented legal language.
    const existingPolicy = await models_1.Policy.findOne({});
    if (!existingPolicy) {
        const PLACEHOLDER_CONTENT = "Policy content pending legal/business approval.";
        const now = new Date();
        // PolicyType lives in apps/api/src/models/Policy.js (not
        // @launcherdesk/shared), re-exported through models/index.js.
        for (const type of Object.values(models_1.PolicyType)) {
            await models_1.Policy.create({
                type,
                version: "1.0",
                title: `${type.charAt(0)}${type.slice(1).toLowerCase()} Policy`,
                content: PLACEHOLDER_CONTENT,
                status: models_1.PolicyStatus.PUBLISHED,
                publishedAt: now,
                effectiveAt: now,
                publishedBy: masterAdmin._id,
                createdBy: masterAdmin._id,
            });
        }
        logger_1.logger.info("Seeded one PUBLISHED placeholder policy per type (TERMS/PRIVACY/REFUND) - content pending legal/business approval.");
    }
    logger_1.logger.info("Seed complete.");
    // Phase 19 - seeded demo accounts' temporary passwords are documented in
    // the project README/seed script source (not secrets - every one of them
    // forces a password change on first login), but they should not be
    // echoed into the runtime log stream, which may be captured/retained by
    // infrastructure with broader access than the source repo. Log only the
    // account identity; the operator can read the actual temporary password
    // from this script's source or the README.
    logger_1.logger.info(`Master Admin: ${masterAdmin.email} / (password from SEED_MASTER_ADMIN_PASSWORD env var)`);
    logger_1.logger.info(`Assistant Master Admin: ${assistantAdmin.email} / (see seed script/README for the default temporary password; must change on first login)`);
    logger_1.logger.info(`Super Admin: ${superAdmin.email} / (see seed script/README for the default temporary password; must change on first login)`);
    logger_1.logger.info(`Admin: admin@democlient.local / (see seed script/README for the default temporary password; must change on first login)`);
    logger_1.logger.info(`User: employee@democlient.local / (see seed script/README for the default temporary password; must change on first login)`);
    await (0, db_1.disconnectDB)();
}
seed().catch((err) => {
    logger_1.logger.error("Seed failed", { message: err.message });
    process.exit(1);
});