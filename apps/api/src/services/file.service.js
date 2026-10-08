"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileService = void 0;
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
const models_1 = require("../models");
const crypto_1 = require("../utils/crypto");
const ApiError_1 = require("../utils/ApiError");
const settings_service_1 = require("./settings.service");
const fileSignature_1 = require("../utils/fileSignature");
// Dedicated Cloudinary file service. Never expose Cloudinary secrets to
// the frontend - all uploads go through this backend service. Files default
// to private/authenticated delivery, never public-by-default.
let cloudinaryConfigured = false;
function getCloudinary() {
    const cloudinary = require("cloudinary").v2;
    if (!cloudinaryConfigured) {
        cloudinary.config({
            cloud_name: env_1.env.CLOUDINARY_CLOUD_NAME,
            api_key: env_1.env.CLOUDINARY_API_KEY,
            api_secret: env_1.env.CLOUDINARY_API_SECRET,
            secure: true,
        });
        cloudinaryConfigured = true;
    }
    return cloudinary;
}
const ALLOWED_MIME_TYPES = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
// Phase 17 - file.routes.js's multer `limits.fileSize` is still configured
// ONCE at router-mount time from this SAME env value, acting as a generous
// OUTER safety ceiling (multer cannot cheaply re-read a setting per request
// without restructuring its middleware). This is NOT claimed to be "fully
// live" - a changed DOCUMENT_MAX_FILE_SIZE_MB setting cannot retroactively
// shrink/grow multer's own hard ceiling without a process restart. The REAL,
// live, settings-driven business limit is enforced below in validate(),
// which is the one that actually matters and CAN change at runtime with no
// restart. See the Phase 17 final report's "Runtime consistency" section.
const MULTER_CEILING_BYTES = env_1.env.DOCUMENT_MAX_FILE_SIZE_MB * 1024 * 1024;
exports.FileService = {
    MULTER_CEILING_BYTES,
    async validate(mimeType, sizeBytes, fileBuffer) {
        // Clean 4xx, never a bare Error - a bare Error thrown here would
        // surface through asyncHandler as an uncaught 500 (see
        // middleware/errorHandler.js: only ApiError instances get their own
        // statusCode, anything else falls through to the generic 500 branch).
        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
            throw ApiError_1.ApiError.badRequest(`Unsupported file type: ${mimeType}`, "UNSUPPORTED_FILE_TYPE");
        }
        // Phase 19 - the MIME allowlist above only checks the client-declared
        // Content-Type, which is not a trustworthy security boundary on its
        // own. Reject known executable/script byte signatures outright,
        // regardless of the declared type - see utils/fileSignature.js.
        if (fileBuffer && (0, fileSignature_1.isExecutableSignature)(fileBuffer)) {
            throw ApiError_1.ApiError.badRequest("File content does not match an allowed file type", "FILE_CONTENT_MISMATCH");
        }
        // Live, settings-driven business limit (DB override if present and
        // valid, else the registry default which mirrors env.js's current
        // default exactly) - re-read on every call, so a changed setting is
        // enforced on the very next upload with no restart required.
        const maxSizeMb = await settings_service_1.SettingsService.getDocumentMaxFileSizeMb();
        const maxSizeBytes = maxSizeMb * 1024 * 1024;
        if (sizeBytes > maxSizeBytes) {
            throw ApiError_1.ApiError.badRequest("File exceeds maximum allowed size", "FILE_TOO_LARGE");
        }
    },
    async upload(params) {
        await this.validate(params.mimeType, params.fileBuffer.length, params.fileBuffer);
        // Integrity checksum - a property of the actual bytes, computed once
        // here regardless of which storage path (real Cloudinary vs. dev
        // mock) ends up being used below.
        const checksumSha256 = (0, crypto_1.sha256Hex)(params.fileBuffer);
        if (!env_1.env.CLOUDINARY_CLOUD_NAME) {
            // Phase 34 - mirrors the fail-closed pattern already used by
            // services/payment-providers, services/email-providers and
            // services/estamp-providers: a production deployment must never
            // silently accept an upload into a non-persistent, fake
            // "mock-storage.local" location and have that mistaken for a
            // real, durably-stored certificate/document. Only non-production
            // environments may fall back to the dev mock adapter below.
            if (env_1.env.NODE_ENV === "production") {
                throw ApiError_1.ApiError.internal("File storage is not configured (CLOUDINARY_CLOUD_NAME missing) - refusing to silently mock file storage in production", "FILE_STORAGE_NOT_CONFIGURED");
            }
            logger_1.logger.warn("[file.service] Cloudinary not configured - using DEV mock adapter (no real upload)");
            const mockPublicId = `mock/${params.organizationId}/${Date.now()}-${params.originalFileName}`;
            return models_1.FileAsset.create({
                organizationId: params.organizationId,
                ownerUserId: params.ownerUserId,
                cloudinaryPublicId: mockPublicId,
                resourceType: "raw",
                fileType: params.fileType,
                originalFileName: params.originalFileName,
                mimeType: params.mimeType,
                sizeBytes: params.fileBuffer.length,
                checksumSha256,
                isPrivate: true,
                requestId: params.requestId,
                orderId: params.orderId,
            });
        }
        const cloudinary = getCloudinary();
        const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream({
                resource_type: "auto",
                folder: `launcherdesk/${params.organizationId}`,
                type: "private", // not publicly accessible by default
            }, (err, result) => (err ? reject(err) : resolve(result)));
            stream.end(params.fileBuffer);
        });
        return models_1.FileAsset.create({
            organizationId: params.organizationId,
            ownerUserId: params.ownerUserId,
            cloudinaryPublicId: uploadResult.public_id,
            resourceType: uploadResult.resource_type,
            fileType: params.fileType,
            originalFileName: params.originalFileName,
            mimeType: params.mimeType,
            sizeBytes: params.fileBuffer.length,
            checksumSha256,
            isPrivate: true,
            requestId: params.requestId,
            orderId: params.orderId,
        });
    },
    async getSignedUrl(publicId) {
        if (!env_1.env.CLOUDINARY_CLOUD_NAME) {
            return `https://mock-storage.local/${publicId}`;
        }
        const cloudinary = getCloudinary();
        // Short-lived signed URL for authorized private access.
        return cloudinary.utils.private_download_url(publicId, "auto", { expires_at: Math.floor(Date.now() / 1000) + 300 });
    },
};
