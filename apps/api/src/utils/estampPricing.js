"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROCUREMENT_FEE = exports.GST_RATE = void 0;
exports.calculateEstampFees = calculateEstampFees;
// The one source of truth for LauncherDesk's own published e-Stamp pricing:
// a flat procurement charge, a convenience fee on larger duties, and 18% GST
// charged on the PROCUREMENT CHARGE ONLY - never on the government stamp
// duty, the consideration-price-derived convenience fee, or anything else.
const GST_RATE = 0.18;
exports.GST_RATE = GST_RATE;
const PROCUREMENT_FEE = 15;
exports.PROCUREMENT_FEE = PROCUREMENT_FEE;
const CONVENIENCE_FEE_RATE = 0.05;
// Above this duty the convenience fee applies; at or below it, it is Rs.0.
const CONVENIENCE_FEE_THRESHOLD = 500;
function round2(value) {
    return Math.round(value * 100) / 100;
}
// `stampDuty` is the real, already-calculated government duty. A duty of 0
// means "not determinable yet" (the article's rule is unconfigured) - callers
// show "At Actuals" for it - but the total is always a real number: it never
// withholds the known, computable fee+GST portion just because the
// government duty component happens to still be unknown.
function calculateEstampFees(stampDuty) {
    const duty = Number(stampDuty) || 0;
    const convenienceFee = duty > CONVENIENCE_FEE_THRESHOLD ? round2(duty * CONVENIENCE_FEE_RATE) : 0;
    const procurementFee = PROCUREMENT_FEE;
    const feeTotal = round2(convenienceFee + procurementFee);
    // GST base is the procurement charge alone - never the convenience fee,
    // the stamp duty, or the consideration price.
    const gst = round2(procurementFee * GST_RATE);
    return {
        stampDuty: duty,
        convenienceFee,
        procurementFee,
        feeTotal,
        gst,
        // Government fees are the duty restated under its own label (as the
        // audited price summary presents it), never a second charge.
        governmentFees: duty,
        totalAmount: round2(duty + feeTotal + gst),
    };
}
