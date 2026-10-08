"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBody = validateBody;
const ApiError_1 = require("../utils/ApiError");
function validateBody(schema) {
    return (req, _res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            throw ApiError_1.ApiError.badRequest("Validation failed", "VALIDATION_ERROR", result.error.flatten());
        }
        req.body = result.data;
        next();
    };
}
