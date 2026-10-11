"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDateTo = parseDateTo;
// `dateTo` from a date picker is date-only ("2026-10-11"). new Date() reads
// that as midnight UTC at the START of the day, so a `$lte` filter silently
// drops the whole last day. A date-only value is therefore treated as the
// END of that (UTC) day; a full timestamp is used exactly as given.
function parseDateTo(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(`${value}T23:59:59.999Z`);
    }
    return new Date(value);
}
