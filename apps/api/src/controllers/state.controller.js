"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAllStates = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const models_1 = require("../models");
// Temporarily limited to states that actually have an imported article
// catalog - picking a state with none led straight to a dead end ("No
// official articles have been imported for this state yet", article
// dropdown disabled). Once more states' real, audited article data is
// imported, they appear here automatically with no code change, since this
// is derived from live Article coverage rather than a hardcoded list.
exports.listAllStates = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const stateCodesWithArticles = await models_1.Article.distinct("stateCode", { isActive: true });
    const states = await models_1.State.find({ isActive: true, code: { $in: stateCodesWithArticles } })
        .select("code name")
        .sort({ name: 1 });
    return (0, ApiResponse_1.ok)(res, states);
});
