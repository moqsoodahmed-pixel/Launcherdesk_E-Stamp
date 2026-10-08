"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Organization = void 0;
const mongoose_1 = require("mongoose");
const shared_1 = require("@launcherdesk/shared");
const organizationSchema = new mongoose_1.Schema({
    name: { type: String, required: true, trim: true, maxlength: 200 },
    contactEmail: { type: String, required: true, unique: true, lowercase: true, trim: true },
    contactPhone: { type: String, required: true, trim: true },
    gstin: { type: String, trim: true },
    address: { type: String, trim: true },
    status: {
        type: String,
        enum: Object.values(shared_1.OrganizationStatus),
        default: shared_1.OrganizationStatus.PENDING_APPROVAL,
        index: true,
    },
    isEstampServiceEnabled: { type: Boolean, default: false },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
organizationSchema.index({ name: 1 });
exports.Organization = (0, mongoose_1.model)("Organization", organizationSchema);
