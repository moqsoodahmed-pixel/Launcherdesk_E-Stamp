"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EStampDocument = void 0;
const mongoose_1 = require("mongoose");
const downloadRecordSchema = new mongoose_1.Schema({
    downloadedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    downloadedByRole: { type: String, required: true },
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true },
    ip: String,
    userAgent: String,
    downloadedAt: { type: Date, default: () => new Date() },
}, { _id: false });
const eStampDocumentSchema = new mongoose_1.Schema({
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    requestId: { type: mongoose_1.Schema.Types.ObjectId, ref: "EStampRequest", required: true },
    orderId: { type: mongoose_1.Schema.Types.ObjectId, ref: "EStampOrder", required: true, unique: true },
    fileAssetId: { type: mongoose_1.Schema.Types.ObjectId, ref: "FileAsset", required: true },
    providerReference: { type: String },
    issuedAt: { type: Date },
    downloadHistory: { type: [downloadRecordSchema], default: [] },
}, { timestamps: true });
exports.EStampDocument = (0, mongoose_1.model)("EStampDocument", eStampDocumentSchema);
