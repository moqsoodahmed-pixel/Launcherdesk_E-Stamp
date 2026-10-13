"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedAllStatesAndArticles = seedAllStatesAndArticles;
const fs = require("fs");
const path = require("path");
const db_1 = require("../config/db");
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
const indianStates_1 = require("../utils/indianStates");

async function seedAllStatesAndArticles(createdBy) {
    const jsonPath = path.resolve(__dirname, "./seed-data-all-articles.json");
    if (!fs.existsSync(jsonPath)) {
        throw new Error(`Data file not found: ${jsonPath}`);
    }
    const articlesData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    logger_1.logger.info(`Loaded ${articlesData.length} articles from seed-data-all-articles.json`);

    let creatorId = createdBy;
    if (!creatorId) {
        const admin = await models_1.User.findOne({ role: "MASTER_ADMIN" });
        creatorId = admin ? admin._id : null;
    }

    // 1. Ensure all 38 Indian states & UTs are present in the State model
    for (const [code, name] of Object.entries(indianStates_1.STATE_CODE_TO_NAME)) {
        await models_1.State.updateOne(
            { code },
            { $setOnInsert: { code, name, isActive: true } },
            { upsert: true }
        );
    }
    logger_1.logger.info("States master verified & synced.");

    // 2. Upsert each of the 1,119 articles and their effective ArticleVersion
    let createdCount = 0;
    let updatedCount = 0;

    for (const item of articlesData) {
        let article = await models_1.Article.findOne({
            stateCode: item.stateCode,
            articleCode: item.articleCode,
        });

        if (!article) {
            article = await models_1.Article.create({
                stateCode: item.stateCode,
                articleCode: item.articleCode,
                title: item.title,
                description: `${item.stateName} Article ${item.articleCode} - ${item.title}. Minimum Government Stamp Duty: ₹${item.price}.`,
                isActive: true,
                currentVersion: 1,
                createdBy: creatorId,
            });
            createdCount += 1;
        } else {
            article.title = item.title;
            article.isActive = true;
            await article.save();
            updatedCount += 1;
        }

        const effectivePrice = Number(item.price) || 1;
        const rule = {
            type: "FIXED",
            fixedAmount: effectivePrice,
            minAmount: effectivePrice,
        };

        const existingVersion = await models_1.ArticleVersion.findOne({
            articleId: article._id,
            versionNumber: article.currentVersion || 1,
        });

        if (!existingVersion) {
            await models_1.ArticleVersion.create({
                articleId: article._id,
                versionNumber: article.currentVersion || 1,
                calculationRule: rule,
                effectiveFrom: new Date("2020-01-01"),
                createdBy: creatorId,
            });
        } else {
            existingVersion.calculationRule = rule;
            await existingVersion.save();
        }
    }

    logger_1.logger.info(`Seeding complete: ${createdCount} articles created, ${updatedCount} updated.`);
    return { createdCount, updatedCount, total: articlesData.length };
}

if (require.main === module) {
    (async () => {
        await (0, db_1.connectDB)();
        try {
            const res = await seedAllStatesAndArticles();
            console.log("Seed result:", res);
        } finally {
            await (0, db_1.disconnectDB)();
        }
    })().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
