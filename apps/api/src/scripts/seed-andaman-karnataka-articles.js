"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedAndamanKarnatakaArticles = seedAndamanKarnatakaArticles;
const db_1 = require("../config/db");
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
// Source: StampMitra_eStamp_Articles_and_Prices.pdf. That document's State/UT,
// Article and Price columns were extracted by PDF-to-text conversion as three
// separate flattened lists (not row-paired), so reconstructing which article
// belongs to which state for all 29 states/~1,150 rows cannot be done
// reliably by hand without real risk of misattributing an article to the
// wrong state. This script only imports the two blocks that can be matched
// with high confidence:
//
// - Andaman and Nicobar Islands: its 12-article list is the very first block
//   in the document (page 27) and pairs 1:1 with the first 12 "Andaman and
//   Nicobar Islands" rows in the State/UT column (page 1) - no ambiguity,
//   it is the document's starting anchor.
// - Karnataka (additional articles): a block naming real Karnataka civic
//   authorities (BBMP = Bruhat Bengaluru Mahanagara Palike, BMRDA, UDA) sits
//   immediately next to a 41(e)/41(eb) Power of Attorney pair that exactly
//   matches the Karnataka articles already in this database (seeded earlier
//   from the LauncherDesk/StampMitra UI audit PDFs) - confirming this block
//   is genuinely Karnataka's list, not another state's.
//
// No price/calculation rule is set here (CUSTOM, amount unset) per explicit
// instruction - a real rate update will be supplied separately.
const ANDAMAN_ARTICLES = [
    { articleCode: "ADOPTION-DEED", title: "Adoption Deed" },
    { articleCode: "OTHERS", title: "Others" },
    { articleCode: "PARTNERSHIP-DEED", title: "Partnership Deed" },
    { articleCode: "POWER-OF-ATTORNEY", title: "Power of Attorney" },
    { articleCode: "SALE-GIFT-WILL-DEED", title: "Sale/Gift/Will deed of land" },
    { articleCode: "CANCELLATION-DEED", title: "Cancellation Deed" },
    { articleCode: "FAMILY-SETTLEMENT-DEED", title: "Family Settlement Deed" },
    { articleCode: "RE-CONVEYANCE-DEED", title: "Re-Conveyance Deed" },
    { articleCode: "RECTIFICATION-DEED", title: "Rectification Deed" },
    { articleCode: "RELEASE-DEED", title: "Release Deed" },
    { articleCode: "RELINQUISH-DEED", title: "Relinquish Deed" },
    { articleCode: "TRUST-DEED", title: "Trust Deed" },
].map((a) => ({ ...a, stateCode: "AN" }));
const KARNATAKA_ARTICLES = [
    { articleCode: "39(a)(1)", title: "Partition - Non Agricultural property in BBMP, UDA, BMRDA, Municipal Councils or Town Panchayats" },
    { articleCode: "39(a)(2)", title: "Partition - Other Areas" },
    { articleCode: "39(b)", title: "Partition - Agricultural Land" },
    { articleCode: "39(c)", title: "Partition - Movable Property" },
    { articleCode: "39(d)", title: "Partition - Combination of all above" },
    { articleCode: "40(A)", title: "Partnership - Constitution of Partnership" },
    { articleCode: "40(B)(b)", title: "Partnership - Reconstitution" },
    { articleCode: "40(C)", title: "Partnership - Dissolution" },
    { articleCode: "40(C)(b)", title: "Partnership - Dissolution - Immovable properties" },
    { articleCode: "40A(a)", title: "Limited Liability Partnership - Capital Upto Rs.10 lakhs" },
    { articleCode: "40A(b)", title: "Limited Liability Partnership - Capital more than Rs.10 lakhs" },
    { articleCode: "40B", title: "Limited Liability Partnership - Reconstruction or Amalgamation" },
    { articleCode: "41(a)", title: "Power of Attorney - for admitting executing of document" },
    { articleCode: "41(b)", title: "Power of Attorney - for authorising one or more person to act in a single transaction" },
    { articleCode: "41(c)", title: "Power of Attorney - for authorising more than 5 person to act jointly" },
    { articleCode: "41(d)", title: "Power of Attorney - authorizing more than 5 to 10 persons to act jointly in more than one transaction or generally" },
    { articleCode: "41(f)", title: "Power of Attorney - when given for trading operation" },
    { articleCode: "41(g)", title: "Power of Attorney - when given for depository participant" },
    { articleCode: "41(h)", title: "Power of Attorney - in any other case" },
].map((a) => ({ ...a, stateCode: "KA" }));
async function seedAndamanKarnatakaArticles(createdBy) {
    const all = [...ANDAMAN_ARTICLES, ...KARNATAKA_ARTICLES];
    let created = 0;
    for (const def of all) {
        const existing = await models_1.Article.findOne({ stateCode: def.stateCode, articleCode: def.articleCode });
        if (existing)
            continue;
        const article = await models_1.Article.create({
            stateCode: def.stateCode,
            articleCode: def.articleCode,
            title: def.title,
            description: "Source: StampMitra_eStamp_Articles_and_Prices.pdf (article list only - no rate imported yet).",
            createdBy,
            currentVersion: 1,
        });
        await models_1.ArticleVersion.create({
            articleId: article._id,
            versionNumber: 1,
            calculationRule: { type: "CUSTOM" },
            createdBy,
        });
        created += 1;
    }
    return { created, skipped: all.length - created, total: all.length };
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
            const result = await seedAndamanKarnatakaArticles(masterAdmin._id);
            logger_1.logger.info(`Andaman/Karnataka article seed done: ${JSON.stringify(result)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
