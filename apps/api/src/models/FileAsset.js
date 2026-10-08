"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileAsset = void 0;
const mongoose_1 = require("mongoose");
const fileAssetSchema = new mongoose_1.Schema({
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    ownerUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    cloudinaryPublicId: { type: String, required: true },
    resourceType: { type: String, required: true },
    fileType: {
        type: String,
        enum: ["ESTAMP_DOCUMENT", "REQUEST_SUPPORTING_DOC", "BULK_TEMPLATE", "OTHER"],
        required: true,
    },
    originalFileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    // SHA-256 of the actual uploaded bytes (params.fileBuffer), computed once
    // at upload time in FileService.upload - a property of the content
    // itself, never of where/whether it was really stored (so it's still
    // computed in the dev-mock-adapter path even though that path never
    // really uploads anywhere). Used to prove upload integrity/content
    // identity in tests - never used as a security/access-control check.
    checksumSha256: { type: String },
    isPrivate: { type: Boolean, default: true },
    requestId: { type: mongoose_1.Schema.Types.ObjectId, ref: "EStampRequest" },
    orderId: { type: mongoose_1.Schema.Types.ObjectId, ref: "EStampOrder" },
}, { timestamps: { createdAt: true, updatedAt: false } });
fileAssetSchema.index({ organizationId: 1, fileType: 1 });
exports.FileAsset = (0, mongoose_1.model)("FileAsset", fileAssetSchema);
