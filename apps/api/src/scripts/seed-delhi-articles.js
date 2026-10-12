"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDelhiArticles = seedDelhiArticles;
const db_1 = require("../config/db");
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
// Adds Delhi articles using ONLY content explicitly stated in the two audit
// PDFs supplied for this platform (LauncherDesk_eStamp_UI_Behaviour_Audit.pdf
// and StampMitra_eStamp_UI_Behaviour_Audit.pdf). Every rate/code below is
// quoted or directly derived from one of those documents - nothing here is
// invented. Where a document type has no stated official rate anywhere in
// either PDF, it is seeded as CUSTOM (amount 0, Master Admin must set the
// real rule later) rather than guessing a number - same convention already
// used by CalculationService for an unconfigured rule.
//
// Sources, one per article:
// - Article 4 (Affidavit): LauncherDesk audit p.8 lists "Affidavit - Article 4"
//   for Delhi's document-type dropdown; StampMitra audit p.27 "Rates
//   Structure in Delhi" table gives "General Affidavit: Rs.10".
// - "4-DECL" (Declaration): LauncherDesk audit p.8 lists "Declaration -
//   Article 4" as a separate dropdown entry sharing the same Article 4 as
//   Affidavit. Re-coded "4-DECL" only because this schema requires a unique
//   articleCode per state - the real statutory number is the same Article 4.
// - Article 5 (General Agreement): LauncherDesk audit p.8/13 - no official
//   rate is stated anywhere in either PDF (the Rs.500 figure used throughout
//   that audit's pricing table is a user-entered example value, not an
//   official rate) - seeded CUSTOM.
// - Article 35(c)(i) (Lease, <1yr): LauncherDesk audit p.8 - no rate stated
//   anywhere - seeded CUSTOM.
// - 23-A (Sale Agreement): StampMitra audit p.13/18 - "23-A - Sale Agreement"
//   with "Minimum duty for this article: Rs.1" shown in that site's own UI.
//   This is also the EXACT document type LauncherDesk's own audit (p.9)
//   flagged as a missing Delhi entry ("Sale Agreement" search returns no
//   match) - adding it closes that documented content gap.
// - POA-SPECIFIC (Power of Attorney, Specific): StampMitra audit p.27 rates
//   table - "Power of Attorney (Specific): Rs.50". No official article
//   number was given in either source, so the code is a descriptive
//   placeholder, not an invented statutory number.
// - RENT-RESIDENTIAL (Rent Agreement, Residential): StampMitra audit p.27 -
//   "Rent Agreement (Residential): Rs.50 - Rs.100, depending on lease
//   period". Our calculation engine has no lease-period input, so this is
//   seeded FIXED at the stated lower bound (Rs.50); the description
//   preserves the full stated range for a Master Admin to refine per case.
// - INDEMNITY-BOND (General Indemnity Bond): StampMitra audit p.28 rates
//   table - "General Indemnity Bond: Rs.100".
const ARTICLES = [
    {
        articleCode: "4",
        title: "Affidavit",
        description: "Delhi Stamp Act Article 4 - Affidavit. Rate per StampMitra's published Delhi rates table (\"General Affidavit: Rs.10\").",
        calculationRule: { type: "FIXED", fixedAmount: 10 },
    },
    {
        articleCode: "4-DECL",
        title: "Declaration",
        description: "Delhi Stamp Act Article 4 - Declaration (shares Article 4 with Affidavit per LauncherDesk's own document-type list; re-coded here only because articleCode must be unique per state). Same Rs.10 rate as the Affidavit entry under the same article.",
        calculationRule: { type: "FIXED", fixedAmount: 10 },
    },
    {
        articleCode: "5",
        title: "General Agreement",
        description: "Delhi Stamp Act Article 5 - General Agreement. No official rate is stated in any source document - duty must be set per case (Master Admin to configure a real calculation rule).",
        calculationRule: { type: "CUSTOM" },
    },
    {
        articleCode: "35(c)(i)",
        title: "Lease, term of less than one year",
        description: "Delhi Stamp Act Article 35(c)(i) - Lease, term of less than one year. No official rate is stated in any source document - duty must be set per case.",
        calculationRule: { type: "CUSTOM" },
    },
    {
        articleCode: "23-A",
        title: "Sale Agreement",
        description: "Delhi Stamp Act Article 23-A - Sale Agreement. Minimum duty Rs.1 per the sourced site's own UI note (\"Minimum duty for this article: Rs.1\") - no fixed/percentage rate beyond that minimum is stated.",
        calculationRule: { type: "CUSTOM", minAmount: 1 },
    },
    {
        articleCode: "POA-SPECIFIC",
        title: "Power of Attorney (Specific)",
        description: "Delhi Power of Attorney (Specific), to represent before administrative departments. Rs.50 per the sourced Delhi rates table. No official article number was given in any source, so this code is a descriptive placeholder, not an invented statutory number.",
        calculationRule: { type: "FIXED", fixedAmount: 50 },
    },
    {
        articleCode: "RENT-RESIDENTIAL",
        title: "Rent Agreement (Residential)",
        description: "Delhi Rent Agreement (Residential). Stated official range is Rs.50-Rs.100 depending on lease period; seeded at the lower bound (Rs.50) since this platform's calculation engine has no lease-period input - a Master Admin should refine this per the specific lease term.",
        calculationRule: { type: "FIXED", fixedAmount: 50, minAmount: 50 },
    },
    {
        articleCode: "INDEMNITY-BOND",
        title: "General Indemnity Bond",
        description: "Delhi General Indemnity Bond - standard protection and company reimbursement declarations. Rs.100 per the sourced Delhi rates table. No official article number was given in any source.",
        calculationRule: { type: "FIXED", fixedAmount: 100 },
    },
];
async function seedDelhiArticles(createdBy) {
    let created = 0;
    for (const def of ARTICLES) {
        const existing = await models_1.Article.findOne({ stateCode: "DL", articleCode: def.articleCode });
        if (existing)
            continue;
        const article = await models_1.Article.create({
            stateCode: "DL",
            articleCode: def.articleCode,
            title: def.title,
            description: def.description,
            createdBy,
            currentVersion: 1,
        });
        await models_1.ArticleVersion.create({
            articleId: article._id,
            versionNumber: 1,
            calculationRule: def.calculationRule,
            createdBy,
        });
        created += 1;
    }
    return { created, skipped: ARTICLES.length - created };
}
if (require.main === module) {
    (async () => {
        await (0, db_1.connectDB)();
        try {
            const { User } = require("../models");
            const { Role } = require("@launcherdesk/shared");
            const masterAdmin = await User.findOne({ role: Role.MASTER_ADMIN });
            if (!masterAdmin) {
                logger_1.logger.error("No Master Admin found - cannot attribute createdBy. Aborting.");
                process.exit(1);
            }
            const result = await seedDelhiArticles(masterAdmin._id);
            logger_1.logger.info(`Delhi article seed done: ${JSON.stringify(result)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
