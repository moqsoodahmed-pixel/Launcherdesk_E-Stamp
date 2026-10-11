"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateIdempotencyIndex = migrateIdempotencyIndex;
const db_1 = require("../config/db");
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
// Replaces the EStampRequest index { organizationId, idempotencyKey }
// (unique + sparse) with a PARTIAL unique index that only covers requests
// that actually have a key. Idempotent and safe to re-run:
//   1. If two requests in one organization share the SAME non-empty key,
//      stop and report them - a unique index cannot be built over them and
//      they need a human decision (nothing is changed).
//   2. Create the new partial index first, then drop the old one, so there is
//      no moment without a uniqueness guarantee. If this MongoDB version
//      refuses two indexes on the same key pattern, fall back to drop-then-
//      create; the gap is milliseconds and createRequest still finds an
//      existing request by key before it reserves anything.
const KEY = { organizationId: 1, idempotencyKey: 1 };
const isSameKey = (idx) => JSON.stringify(idx.key) === JSON.stringify(KEY);
async function migrateIdempotencyIndex() {
    const coll = models_1.EStampRequest.collection;
    const newName = models_1.IDEMPOTENCY_INDEX_NAME;
    const options = { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } }, name: newName };
    const duplicates = await coll
        .aggregate([
        { $match: { idempotencyKey: { $type: "string" } } },
        { $group: { _id: { organizationId: "$organizationId", idempotencyKey: "$idempotencyKey" }, count: { $sum: 1 }, ids: { $push: "$_id" } } },
        { $match: { count: { $gt: 1 } } },
    ])
        .toArray();
    if (duplicates.length) {
        return { status: "BLOCKED_DUPLICATES", duplicates: duplicates.map((d) => ({ ...d._id, requestIds: d.ids.map(String) })) };
    }
    let indexes = [];
    try {
        indexes = await coll.indexes();
    }
    catch (err) {
        if (err?.codeName !== "NamespaceNotFound")
            throw err;
    }
    const hasNew = indexes.some((i) => i.name === newName);
    const old = indexes.filter((i) => isSameKey(i) && i.name !== newName);
    if (hasNew && old.length === 0)
        return { status: "ALREADY_MIGRATED" };
    let fallback = false;
    if (!hasNew) {
        try {
            await coll.createIndex(KEY, options);
        }
        catch (err) {
            // 85 IndexOptionsConflict / 86 IndexKeySpecsConflict: this server
            // allows only one index per key pattern.
            if (![85, 86].includes(err?.code))
                throw err;
            fallback = true;
            for (const idx of old)
                await coll.dropIndex(idx.name);
            await coll.createIndex(KEY, options);
        }
    }
    if (!fallback) {
        for (const idx of old)
            await coll.dropIndex(idx.name);
    }
    return { status: "MIGRATED", droppedIndexes: old.map((i) => i.name), dropThenCreate: fallback };
}
if (require.main === module) {
    (async () => {
        await (0, db_1.connectDB)();
        let result;
        try {
            result = await migrateIdempotencyIndex();
            logger_1.logger.info(`Idempotency index migration: ${JSON.stringify(result)}`);
        }
        finally {
            await (0, db_1.disconnectDB)();
        }
        if (result?.status === "BLOCKED_DUPLICATES")
            process.exit(2);
    })().catch((err) => {
        logger_1.logger.error(err.message);
        process.exit(1);
    });
}
