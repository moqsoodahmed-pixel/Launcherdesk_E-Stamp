"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dedupeLegacyArticles = dedupeLegacyArticles;
const db_1 = require("../config/db");
const models_1 = require("../models");

// Two sources of duplicate articles, both fixed the same way (deactivate,
// never delete, so history is preserved):
// 1. Before the StampMitra audit import, Andaman, Delhi and Karnataka
//    already had a handful of articles seeded under an older, inconsistent
//    code scheme, naming the exact same legal instrument as one of the
//    audit-sourced codes below.
// 2. The audit's own F15 finding documents Andhra Pradesh articles that are
//    duplicated under two code formats on the live competitor site itself
//    (e.g. "31(a)(iii)(a)" and "31 (a) (iii) (a)").
// Deactivating the duplicate - keeping the audit-preferred/spaced code -
// stops it from showing twice in the New Request / bulk-template dropdowns.
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
    // The StampMitra audit's own F15 finding documents these as duplicate
    // labels already present in Andhra Pradesh's live dropdown (the same
    // instrument listed twice, once with spaces in the code and once
    // without). Deactivating the no-space variant, keeping the spaced one
    // that matches the rest of AP's code formatting. NOTE: "41 (A) (b)" and
    // "41 (C) (b)" also share an identical short label in the audit, but
    // they are two distinct partnership sub-clauses, not a duplicate - F15
    // does not list them as one, so they are deliberately left alone here.
    AP: ["31(a)(iii)(a)", "31(a)(iii)(b)", "6(A)"],
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
