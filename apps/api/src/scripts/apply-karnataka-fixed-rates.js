"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyKarnatakaFixedRates = applyKarnatakaFixedRates;
const db_1 = require("../config/db");
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
// Sets a real FIXED calculationRule for the Karnataka articles whose duty is
// a single exact government-mandated amount - never a guess. Source:
// StampMitra_eStamp_Audit_Report.pdf (12 Oct 2026), Appendix A "Karnataka -
// 113 articles". For each of these 48 articles the auditor verified the rate
// by submitting it live to the pricing API and recording the exact rejection
// message ("Amount must be one of: X"), not just reading a banner - these are
// the only Karnataka rows in that report marked "(fixed)".
//
// Deliberately excludes every other Karnataka article (percentage/slab rules
// based on consideration price) - the audit only confirmed a MINIMUM for
// those, not the actual rate, and this script must never invent one.
//
// Idempotent and update-only: an articleCode not already present in our own
// Karnataka catalog is skipped (never created here), and an article whose
// current version already has this exact FIXED amount is left untouched.
const FIXED_RATES = {
    "1(i)(a)": 2,
    "15(b)": 2,
    "17": 2000,
    "18": 100,
    "19": 500,
    "2(B)": 100,
    "21": 50,
    "22": 1000,
    "23": 100,
    "25": 500,
    "3": 1000,
    "31": 10,
    "32": 100,
    "33": 5000,
    "38": 50,
    "4": 100,
    "40(A)": 2000,
    "40(B)(b)": 2000,
    "40(C)(b)": 2000,
    "40A(a)": 5000,
    "41(a)": 500,
    "41(b)": 500,
    "41(c)": 500,
    "41(d)": 1000,
    "41(f)": 100,
    "41(g)": 100,
    "41(h)": 500,
    "42": 10,
    "43": 50,
    "44": 200,
    "47": 500,
    "5(i-a)": 50,
    "5(i-d)(i)": 500,
    "5(i-e)(i)": 500,
    "5(i)": 50,
    "5(J)": 500,
    "50": 2,
    "51": 200,
    "52(b)": 200,
    "52(c)": 200,
    "54(i)": 2000,
    "55": 50,
    "56(i)": 300,
    "56(ii)": 200,
    "7": 1000,
    "8(b)": 200,
    "9": 100,
    "54(ii)": 2000,
};
async function applyKarnatakaFixedRates(createdBy) {
    const applied = [];
    const alreadyCurrent = [];
    const notFound = [];
    for (const [articleCode, fixedAmount] of Object.entries(FIXED_RATES)) {
        const article = await models_1.Article.findOne({ stateCode: "KA", articleCode });
        if (!article) {
            notFound.push(articleCode);
            continue;
        }
        const currentVersion = await models_1.ArticleVersion.findOne({ articleId: article._id }).sort({ versionNumber: -1 });
        const rule = currentVersion?.calculationRule;
        if (rule && rule.type === "FIXED" && rule.fixedAmount === fixedAmount) {
            alreadyCurrent.push(articleCode);
            continue;
        }
        const nextVersion = (currentVersion?.versionNumber || 0) + 1;
        await models_1.ArticleVersion.create({
            articleId: article._id,
            versionNumber: nextVersion,
            calculationRule: { type: "FIXED", fixedAmount },
            createdBy,
        });
        article.currentVersion = nextVersion;
        await article.save();
        applied.push({ articleCode, fixedAmount, versionNumber: nextVersion });
    }
    return { applied, alreadyCurrent, notFound };
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
            const result = await applyKarnatakaFixedRates(masterAdmin._id);
            logger_1.logger.info(`Karnataka fixed-rate update done: ${JSON.stringify(result, null, 2)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
