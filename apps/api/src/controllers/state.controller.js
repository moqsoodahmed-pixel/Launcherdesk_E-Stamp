"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAllStates = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const models_1 = require("../models");
// The full master list of states/UTs (not just ones that currently have an
// imported Article) - this is what lets the State dropdown always show
// every supported jurisdiction, independent of article-import progress.
// Article coverage per state is then checked separately via the existing
// GET /articles?stateCode= endpoint, which already returns an empty list
// (not an error) when nothing has been imported yet for that state.
exports.listAllStates = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const states = await models_1.State.find({ isActive: true }).select("code name").sort({ name: 1 });
    return (0, ApiResponse_1.ok)(res, states);
});
