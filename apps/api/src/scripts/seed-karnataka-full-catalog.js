"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedKarnatakaFullCatalog = seedKarnatakaFullCatalog;
const db_1 = require("../config/db");
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
// Source: the user's own row-aligned "State | Article" export (screenshot),
// where every row explicitly reads "Karnataka" next to its article - unlike
// the earlier flattened PDF, this pairing is directly visible and needs no
// reconstruction. This is the FULL Karnataka Stamp Act article catalog;
// entries already present in the database (2(B), the 39(a)(1)-39(d) Partition
// set, 40(A)-40B Partnership/LLP set, and the full 41(a)-41(h) Power of
// Attorney set, including the rated 41(e)/41(eb)) are skipped here, never
// duplicated or overwritten. No price/calculation rule is set (CUSTOM) per
// explicit instruction - rates will be supplied separately.
const ARTICLES = [
    { articleCode: "1(i)(a)", title: "Acknowledgement of a Debt - upto Rs.5000/-" },
    { articleCode: "1(i)(b)", title: "Acknowledgement of a Debt - more than 5000/-" },
    { articleCode: "1(ii)", title: "Acknowledgement of Letter, Article, Package, Parcel ....." },
    { articleCode: "10", title: "Articles of Association of a Company" },
    { articleCode: "12(a)", title: "Respondentia Bond - Amount Secured does not exceed Rs.1000" },
    { articleCode: "12(b)", title: "Respondentia Bond - Amount exceeding Rs.1000" },
    { articleCode: "13", title: "Bottomry Bond" },
    { articleCode: "15(a)", title: "Certificate of Sale - Purchase money does not exceed Rs.10" },
    { articleCode: "15(b)", title: "Certificate of Sale - Purchase money does not exceed Rs.25" },
    { articleCode: "15(c)", title: "Certificate of Sale - In any other case" },
    { articleCode: "16", title: "Certificate evidencing right or title of the holder thereof, or any other person, either to..." },
    { articleCode: "17", title: "Certificate of Enrolment as Advocate" },
    { articleCode: "18", title: "Charter Party" },
    { articleCode: "18A(1)", title: "Purchase or Sale of Government Securities - 37(c)" },
    { articleCode: "18A(2)", title: "Securities of incorporated company of other body corporate submitted to clearing h..." },
    { articleCode: "19", title: "Composition Deed" },
    { articleCode: "2(a)", title: "Administration Bond - Upto Rs.1000/-" },
    { articleCode: "20(5)(i)", title: "Conveyance - Industrial machinery treated as movable" },
    { articleCode: "21", title: "Copy of Extract" },
    { articleCode: "22", title: "Counter part or Duplicate" },
    { articleCode: "23", title: "Customs Bond or Excise Bond Art 23(b)" },
    { articleCode: "24", title: "Delivery order in respect of Goods" },
    { articleCode: "25", title: "Divorce" },
    { articleCode: "27(b)(iii)", title: "Further charges Loan exceeding 10 Lakhs 34(d)(ii)" },
    { articleCode: "29", title: "Indemnity Bond (As per Article 47)" },
    { articleCode: "3", title: "Adoption Deed" },
    { articleCode: "30(1)(i)", title: "Lease of Immovable Property - Not exceeding 1 year in case of Residential property" },
    { articleCode: "30(1)(ii)", title: "Lease of Immovable Property - Not exceeding 1 year in case of commercial industrial property" },
    { articleCode: "30(2)", title: "Lease of Movable Property - Lease of movable property rent fixed, no premium, upto 10 years" },
    { articleCode: "30(2)(a)(ii)", title: "Lease of Movable Property - Above 10 years" },
    { articleCode: "30(2)(b)", title: "Lease of Movable Property - Lease granted for fine or premium but no rent" },
    { articleCode: "30(2)(c)", title: "Lease of Movable Property - Lease for fine premium and also rent" },
    { articleCode: "31", title: "Letter of Allotment" },
    { articleCode: "32", title: "Letter of licence" },
    { articleCode: "32-A (i)", title: "Letter of License - Not more than 1 year in case of residential property" },
    { articleCode: "32-A (ii)", title: "Letter of License - Not more than 1 year in case of commercial industrial property" },
    { articleCode: "32-A(iii)", title: "Letter of License - 1 year to 10 year" },
    { articleCode: "32-A(iv)", title: "Letter of License - 10 year to 20 year" },
    { articleCode: "32-A(v)", title: "Letter of License - 20 to 30 year" },
    { articleCode: "33", title: "Memorandum of Association of a company" },
    { articleCode: "34(d)(i)", title: "Mortgage Deed - Hypothecation of movable property loan upto Rs.10 lakh" },
    { articleCode: "34(d)(ii)", title: "Mortgage Deed - loan exceeding 10 lakhs" },
    { articleCode: "37(a)", title: "Note or memorandum of record sent by broker to his principal intimating the purchase or sale through stock exchange..." },
    { articleCode: "37(b)", title: "Note or memorandum of record sent by broker to his principal intimating the purchase or sale through stock exchange..." },
    { articleCode: "37(c)", title: "Note or memorandum of record sent by broker to his principal intimating the purchase or sale through stock exchange..." },
    { articleCode: "37(d)", title: "Note or memorandum of record sent by broker to his principal intimating the purchase or sale through stock exchange..." },
    { articleCode: "37(e)", title: "Note or memorandum of record sent by broker to his principal intimating the purchase or sale through stock exchange..." },
    { articleCode: "37(f)", title: "Note or memorandum of record sent by broker to his principal intimating the purchase or sale through stock exchange..." },
    { articleCode: "38", title: "Note of Protest by the Master of a ship" },
    { articleCode: "4", title: "Affidavit" },
    { articleCode: "42", title: "Protest of Bill / Note" },
    { articleCode: "43", title: "Protest by the Master of a Ship" },
    { articleCode: "44", title: "Re-Conveyance of mortgaged property" },
    { articleCode: "47", title: "Security Bond or Mortgage Deed" },
    { articleCode: "49", title: "Share Warrants" },
    { articleCode: "5(a)", title: "Sale of Bill Exchange" },
    { articleCode: "5(b)", title: "Purchase or Sale of Government Security" },
    { articleCode: "5(c)(i)", title: "Sale or Purchase of Shares, Stocks Bonds, Debenture Stock or other marketable security..." },
    { articleCode: "5(c)(ii)", title: "Agreement or its records or MOA - In any other case" },
    { articleCode: "5(e)(ii)", title: "Agreement or its records or MOA - Sale of immovable property wherein part performance..." },
    { articleCode: "5(g)(i)", title: "Agreement or its records or MOA - Sale of moveable property, possession of the property is delivered" },
    { articleCode: "5(g)(ii)", title: "Agreement or its records or MOA - Sale of moveable property, possession of the property is not delivered" },
    { articleCode: "5(i-a)", title: "Agreement relating to Contract between Stock Broker or Sub Broker (agent) and client..." },
    { articleCode: "5(i-b)", title: "Agreement relating to Advertisement or telecasting or broadcasting of programs" },
    { articleCode: "5(i-c)", title: "Agreement relating to assignment or transfer of intellectual property rights, patent rights..." },
    { articleCode: "5(i-d)(i)", title: "Agreement relating to building works or labour or services - Upto Rs.10 lakhs" },
    { articleCode: "5(i-d)(ii)", title: "Agreement or its records or MOA - Agreement relating to building works or labour or services, Above Rs.10 lakhs" },
    { articleCode: "5(i-e)(i)", title: "Chit Agreement - Where the value of the chit does not exceed Rs.1 lakh" },
    { articleCode: "5(i-e)(ii)", title: "Chit Agreement - Where the value of the chit exceeds Rs.1 lakh" },
    { articleCode: "5(i)", title: "Agreement relating to contract between Depository Participant and Client for opening Demat A/c" },
    { articleCode: "5(J)", title: "Agreement (in any other cases)" },
    { articleCode: "50", title: "Shipping" },
    { articleCode: "51", title: "Surrender of Lease (Art 40b)" },
    { articleCode: "52(a)", title: "Transfer of debentures" },
    { articleCode: "52(b)", title: "Transfer any interest secured by bond or policy of insurance" },
    { articleCode: "52(c)", title: "Transfer - property under section 25 of administrator generals act 1963." },
    { articleCode: "53A", title: "Transfer of Licence" },
    { articleCode: "54(i)", title: "Trust made for public religious and charitable purpose" },
    { articleCode: "55", title: "Warrants of Goods" },
    { articleCode: "56(i)", title: "Bank Guarantee - If related to paper bank guarantee" },
    { articleCode: "56(ii)", title: "Bank Guarantee - If relating to e-bank guarantee" },
    { articleCode: "6(1)(i)", title: "Agreement relating to DTD - Loan amount does not exceed Rs.10 lakhs" },
    { articleCode: "6(1)(ii)", title: "Agreement relating to DTD - Loan amount exceeding Rs.10 lakhs" },
    { articleCode: "6(2)(i)", title: "Pawn or Pledge of Movable Property - Loan amount above Rs.1 lakh and upto Rs.10 lakh" },
    { articleCode: "6(2)(ii)", title: "Pawn or Pledge of Movable Property - Loan amount above Rs.10 lakhs" },
    { articleCode: "7", title: "Appointment in execution of a power" },
    { articleCode: "8(a)", title: "Appraisement or Valuation - Upto Rs.1000" },
    { articleCode: "8(b)", title: "Appraisement or Valuation - In any other case" },
].map((a) => ({ ...a, stateCode: "KA" }));
async function seedKarnatakaFullCatalog(createdBy) {
    let created = 0;
    for (const def of ARTICLES) {
        const existing = await models_1.Article.findOne({ stateCode: "KA", articleCode: def.articleCode });
        if (existing)
            continue;
        const article = await models_1.Article.create({
            stateCode: "KA",
            articleCode: def.articleCode,
            title: def.title,
            description: "Source: user-supplied Karnataka article/price export (article list only - no rate imported yet).",
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
    return { created, skipped: ARTICLES.length - created, total: ARTICLES.length };
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
            const result = await seedKarnatakaFullCatalog(masterAdmin._id);
            logger_1.logger.info(`Karnataka full catalog seed done: ${JSON.stringify(result)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
