"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedKarnatakaPoaArticles = seedKarnatakaPoaArticles;
const db_1 = require("../config/db");
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
// Adds exactly the two Karnataka Power of Attorney articles that are
// explicitly documented with a real calculation rule in the competitor
// audit PDFs (LauncherDesk_eStamp_UI_Behaviour_Audit.pdf, Step 39/Step 24 -
// "Power of Attorney, authorising sale of property (Article 41(e), 5% of
// the market value of the property)" and "...sale power given to other
// than family members (Article 41(eb), 5%)"). No rate here is invented -
// both percentages are taken verbatim from that source. Idempotent: an
// existing article with the same (stateCode, articleCode) is left alone.
const ARTICLES = [
    {
        articleCode: "41(e)",
        title: "Power of Attorney, authorising sale of property",
        description: "Karnataka Stamp Act Article 41(e) - Power of Attorney authorising the sale of property.",
        calculationRule: { type: "PERCENTAGE", percentage: 5 },
    },
    {
        articleCode: "41(eb)",
        title: "Power of Attorney, sale power given to other than family members",
        description: "Karnataka Stamp Act Article 41(eb) - Power of Attorney granting sale power to someone other than a family member.",
        calculationRule: { type: "PERCENTAGE", percentage: 5 },
    },
];
async function seedKarnatakaPoaArticles(createdBy) {
    let created = 0;
    for (const def of ARTICLES) {
        const existing = await models_1.Article.findOne({ stateCode: "KA", articleCode: def.articleCode });
        if (existing) {
            continue;
        }
        const article = await models_1.Article.create({
            stateCode: "KA",
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
            const result = await seedKarnatakaPoaArticles(masterAdmin._id);
            logger_1.logger.info(`Karnataka POA article seed done: ${JSON.stringify(result)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
