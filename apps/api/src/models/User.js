"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const mongoose_1 = require("mongoose");
const shared_1 = require("@launcherdesk/shared");
const userSchema = new mongoose_1.Schema({
    name: { type: String, required: true, trim: true, maxlength: 150 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(shared_1.Role), required: true, index: true },
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    permissions: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastOtpVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0 },
    mustChangePassword: { type: Boolean, default: false },
}, { timestamps: true });
// Compound index: fast tenant-scoped user listing
userSchema.index({ organizationId: 1, role: 1 });
// Supports the employee-management list view's status filter/search within
// an organization (e.g. GET /users?status=inactive), without a full scan.
userSchema.index({ organizationId: 1, isActive: 1 });
exports.User = (0, mongoose_1.model)("User", userSchema);
