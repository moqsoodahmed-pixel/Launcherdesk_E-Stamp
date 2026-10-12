"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePackage = exports.createPackage = exports.listPackages = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const ApiError_1 = require("../utils/ApiError");
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const audit_service_1 = require("../services/audit.service");
function isInternalActor(req) {
    return req.user.role === shared_1.Role.MASTER_ADMIN || req.user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN;
}
// Any authenticated tenant actor can browse the catalog - this is what the
// Super Admin dashboard's BuyMoreModal fetches instead of a hardcoded
// client-side array. Non-internal actors only ever see active packages;
// internal actors (catalog managers) may request everything.
exports.listPackages = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const filter = {};
    if (!isInternalActor(req) || req.query.isActive === undefined) {
        filter.isActive = true;
    }
    else if (req.query.isActive !== undefined) {
        filter.isActive = req.query.isActive === "true";
    }
    const packages = await models_1.EstampPackage.find(filter).sort({ sortOrder: 1, createdAt: 1 });
    return (0, ApiResponse_1.ok)(res, packages);
});
exports.createPackage = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { key, name, description, stampsCount, price, features, validityDays, recommended, sortOrder } = req.body;
    let pkg;
    try {
        pkg = await models_1.EstampPackage.create({
            key: String(key).toLowerCase().trim(),
            name,
            description,
            stampsCount,
            price,
            features,
            validityDays: validityDays ?? null,
            recommended: !!recommended,
            sortOrder: sortOrder ?? 0,
            createdBy: req.user.id,
        });
    }
    catch (err) {
        if (err?.code === 11000) {
            throw ApiError_1.ApiError.conflict("A package with this key already exists");
        }
        throw err;
    }
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.ARTICLE_MANAGED,
        entityType: "EstampPackage",
        entityId: pkg._id.toString(),
        metadata: { action: "created", key: pkg.key },
        req,
    });
    return (0, ApiResponse_1.created)(res, pkg);
});
// Edits catalog metadata, including disabling a package (isActive: false) -
// a disabled package disappears from listPackages for tenant actors and is
// rejected by payment.controller.js's packageKey resolution, but existing
// purchases/payments referencing it are left untouched.
exports.updatePackage = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const pkg = await models_1.EstampPackage.findById(req.params.id);
    if (!pkg)
        throw ApiError_1.ApiError.notFound("Package not found");
    const allowed = ["name", "description", "stampsCount", "price", "features", "validityDays", "recommended", "isActive", "sortOrder"];
    for (const field of allowed) {
        if (req.body[field] !== undefined)
            pkg[field] = req.body[field];
    }
    await pkg.save();
    await (0, audit_service_1.recordAudit)({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: shared_1.AuditAction.ARTICLE_MANAGED,
        entityType: "EstampPackage",
        entityId: pkg._id.toString(),
        metadata: { action: "updated", key: pkg.key },
        req,
    });
    return (0, ApiResponse_1.ok)(res, pkg);
});
