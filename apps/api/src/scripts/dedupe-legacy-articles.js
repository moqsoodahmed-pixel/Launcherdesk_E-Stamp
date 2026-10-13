"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dedupeLegacyArticles = dedupeLegacyArticles;
const db_1 = require("../config/db");
const models_1 = require("../models");

// Before the StampMitra audit import (commit e5c651b and the fix that
// followed it), Andaman, Delhi and Karnataka already had a handful of
// articles seeded under an older, inconsistent code scheme. Those old codes
// represent the exact same legal instrument as one of the audit-sourced
// codes below (same title, same state) and were never removed, so each of
// these three states' real catalog size (12 / 98 / 113 per the audit)
// appeared inflated by the leftover duplicates. Deactivating - never
// deleting - the legacy duplicate keeps history intact while stopping it
// from showing twice in the New Request / bulk-template dropdowns.
const LEGACY_DUPLICATE_CODES = {
    AN: [
        "ADOPTION-DEED",
        "CANCELLATION-DEED",
        "FAMILY-SETTLEMENT-DEED",
        "OTHERS",
        "PARTNERSHIP-DEED",
        "POWER-OF-ATTORNEY",
        "RE-CONVEYANCE-DEED",
        "RECTIFICATION-DEED",
        "RELEASE-DEED",
        "RELINQUISH-DEED",
        "SALE-GIFT-WILL-DEED",
        "TRUST-DEED",
    ],
    DL: [
        "23-A",
        "35(c)(i)",
        "4",
        "4-DECL",
        "5",
        "INDEMNITY-BOND",
        "POA-SPECIFIC",
        "RENT-RESIDENTIAL",
    ],
    // KA-G01 and KA-G02 don't exist; these are the two malformed/duplicate
    // codes found alongside the audit's correctly-formatted "40 (A)" and
    // "32-A (ii)" entries.
    KA: ["40(A)", "32-A(ii) 32-A (ii)"],
};

async function dedupeLegacyArticles() {
    let deactivatedCount = 0;
    for (const [stateCode, codes] of Object.entries(LEGACY_DUPLICATE_CODES)) {
        for (const articleCode of codes) {
            const result = await models_1.Article.updateOne({ stateCode, articleCode, isActive: true }, { $set: { isActive: false } });
            if (result.modifiedCount > 0) {
                deactivatedCount += result.modifiedCount;
            }
        }
    }
    return { deactivatedCount };
}

if (require.main === module) {
    (async () => {
        await (0, db_1.connectDB)();
        try {
            const res = await dedupeLegacyArticles();
            console.log("Dedupe result:", res);
        } finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
