"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.State = void 0;
const mongoose_1 = require("mongoose");
// Master reference table of Indian states/UTs - pure geographic naming (not
// stamp-duty/legal data), seeded once from the same list used by
// apps/api/src/utils/indianStates.js. This is the single source of truth
// for "which states exist" in the dropdown, independent of whether any
// Article has been imported for that state yet - Article.stateCode remains
// the only source of truth for duty rules themselves.
const stateSchema = new mongoose_1.Schema({
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });
stateSchema.index({ isActive: 1, name: 1 });
exports.State = (0, mongoose_1.model)("State", stateSchema);
