"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EstampPackage = void 0;
const mongoose_1 = require("mongoose");
// Server-side source of truth for purchasable E-Stamp bundles. The Super
// Admin dashboard's BuyMoreModal reads this catalog instead of hardcoding
// package name/price/stampsCount client-side, and payment.controller.js
// resolves price/stampsCount from here (never from client input) when a
// packageKey is supplied - the same catalog powers both "view" and "buy".
const estampPackageSchema = new mongoose_1.Schema({
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    stampsCount: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
    features: { type: [String], default: [] },
    // Null = lifetime/no expiry. Otherwise, validity window in days starting
    // from the purchase date (Payment.createdAt).
    validityDays: { type: Number, default: null, min: 1 },
    recommended: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });
estampPackageSchema.index({ isActive: 1, sortOrder: 1 });
exports.EstampPackage = (0, mongoose_1.model)("EstampPackage", estampPackageSchema);
