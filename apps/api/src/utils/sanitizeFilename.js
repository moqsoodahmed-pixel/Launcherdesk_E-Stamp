"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeFilenameComponent = sanitizeFilenameComponent;
exports.extensionForMimeType = extensionForMimeType;
exports.buildCertificateFilename = buildCertificateFilename;
// Small, dependency-free filename-safety helper. Used anywhere a
// suggested/download filename is built from data that originated outside
// this process (an order number, an original uploaded filename) - even
// values that are server-generated today (e.g. EStampOrder.orderNumber via
// nextSequenceNumber) are treated as untrusted here defensively, since
// nothing prevents a future change from making them less trustworthy.
//
// Strips path separators, ".." traversal sequences, and control/non-printable
// characters, keeping the result human-readable. This is a COSMETIC/display
// safety measure only (what name the browser suggests when saving a file) -
// it is never used for access control or storage addressing.
function sanitizeFilenameComponent(value, fallback = "file") {
    const raw = value === undefined || value === null ? "" : String(value);
    const cleaned = raw
        .replace(/[\\/]/g, "-") // path separators
        .replace(/\.\.+/g, ".") // collapse ".."/"..." traversal sequences
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, "") // control/non-printable characters
        .trim();
    return cleaned.length > 0 ? cleaned : fallback;
}
// Explicit, closed whitelist - never derive an extension from a raw,
// user/provider-supplied mimeType string beyond this known set. Anything
// unrecognized falls back to a safe generic extension.
const MIME_EXTENSION_MAP = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "text/csv": "csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
function extensionForMimeType(mimeType, fallback = "bin") {
    return MIME_EXTENSION_MAP[mimeType] || fallback;
}
// Builds a clean, human-readable suggested filename for a downloaded E-Stamp
// certificate, e.g. "LDE-ORD-2026-123456-estamp-certificate.pdf".
// `orderNumber` is sanitized defensively (see header comment); the
// extension is chosen from the closed mimeType whitelist above, never
// trusted from the raw original filename for anything security-relevant.
function buildCertificateFilename(orderNumber, mimeType) {
    const safeOrderNumber = sanitizeFilenameComponent(orderNumber, "order");
    const ext = extensionForMimeType(mimeType);
    return `${safeOrderNumber}-estamp-certificate.${ext}`;
}
