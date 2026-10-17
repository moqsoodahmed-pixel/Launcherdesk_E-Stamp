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
    // A public, directly-browser-loadable Cloudinary delivery URL (never
    // signed/expiring - see FileService.uploadPublicImage) - shown in the
    // dashboard header and the Master Admin organizations list for every
    // user who belongs to or can view this organization. null = no logo
    // uploaded yet; the UI falls back to the organization's initials.
    logoUrl: { type: String, default: null },
    // Per-organization override of the flat procurement charge (estampPricing.js's
    // PROCUREMENT_FEE) a Master Admin can set for this client specifically.
    // null = use the platform default for every organization without one.
    procurementFeeOverride: { type: Number, default: null, min: 0 },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    // The one Assistant Master Admin responsible for this client (credits
    // its payments, manages its balance). null = only Master Admins.
    assignedAssistantId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null, index: true },
}, { timestamps: true });
organizationSchema.index({ name: 1 });
exports.Organization = (0, mongoose_1.model)("Organization", organizationSchema);
