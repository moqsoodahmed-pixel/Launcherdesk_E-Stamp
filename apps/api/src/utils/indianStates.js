"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveStateCode = resolveStateCode;
exports.stateNameForCode = stateNameForCode;
// Standard public Indian state/UT name <-> code reference (postal/census
// style abbreviations) - NOT stamp-duty or legal data, just geographic
// naming, used only to display a human-readable state name for whichever
// stateCode values actually exist on real Article documents, and to accept
// either form on bulk-upload. This map intentionally covers every state/UT
// so that adding a new Article.stateCode later needs no further code change
// here - only the DB-driven list of "which states have articles" changes.
exports.STATE_CODE_TO_NAME = {
    AN: "Andaman and Nicobar Islands",
    AP: "Andhra Pradesh",
    AR: "Arunachal Pradesh",
    AS: "Assam",
    BR: "Bihar",
    CH: "Chandigarh",
    CT: "Chhattisgarh",
    DN: "Dadra and Nagar Haveli and Daman and Diu",
    DL: "Delhi",
    GA: "Goa",
    GJ: "Gujarat",
    HR: "Haryana",
    HP: "Himachal Pradesh",
    JK: "Jammu and Kashmir",
    JH: "Jharkhand",
    KA: "Karnataka",
    KL: "Kerala",
    LA: "Ladakh",
    LD: "Lakshadweep",
    MP: "Madhya Pradesh",
    MH: "Maharashtra",
    MN: "Manipur",
    ML: "Meghalaya",
    MZ: "Mizoram",
    NL: "Nagaland",
    OD: "Odisha",
    PY: "Puducherry",
    PB: "Punjab",
    RJ: "Rajasthan",
    SK: "Sikkim",
    TN: "Tamil Nadu",
    TG: "Telangana",
    TR: "Tripura",
    UP: "Uttar Pradesh",
    UT: "Uttarakhand",
    WB: "West Bengal",
};
const NAME_TO_CODE = Object.fromEntries(Object.entries(exports.STATE_CODE_TO_NAME).map(([code, name]) => [name.toUpperCase(), code]));
// Returns the official full name for a code, or the code itself if it isn't
// in the reference map (never throws - an unmapped/custom code still works,
// it just displays as-is instead of a friendly name).
function stateNameForCode(code) {
    return exports.STATE_CODE_TO_NAME[String(code || "").toUpperCase()] || code;
}
// Accepts either a state code ("KA") or a full name ("Karnataka") and
// returns the code. Unrecognized input is returned uppercased/trimmed
// unchanged, so existing callers that already pass a real code keep working
// exactly as before, and a genuinely invalid value still fails downstream
// validation with a clear error instead of being silently swallowed here.
function resolveStateCode(input) {
    const trimmed = String(input || "").trim();
    if (!trimmed)
        return trimmed;
    const upper = trimmed.toUpperCase();
    if (exports.STATE_CODE_TO_NAME[upper])
        return upper;
    if (NAME_TO_CODE[upper])
        return NAME_TO_CODE[upper];
    return upper;
}
