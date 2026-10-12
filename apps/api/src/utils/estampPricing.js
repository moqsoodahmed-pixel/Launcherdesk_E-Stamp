"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROCUREMENT_FEE = exports.GST_RATE = void 0;
exports.calculateEstampFees = calculateEstampFees;
// The one source of truth for LauncherDesk's own published e-Stamp pricing:
// a flat procurement charge, a convenience fee on larger duties, and 18% GST
// charged on the FEES only (never on the government stamp duty itself).
//
// These exact numbers were lifted verbatim from the bulk flow's long-standing
// row pricing (bulk-estamp.service.js) and independently match every figure
// in LauncherDesk_eStamp_UI_Behaviour_Audit.pdf's live-captured price
// summaries: a Rs.500 duty yields Convenience Fee Rs.0, Procurement Charge
// Rs.99, GST (18%) Rs.17.82 and Total payable Rs.616.82.
const GST_RATE = 0.18;
exports.GST_RATE = GST_RATE;
const PROCUREMENT_FEE = 99;
exports.PROCUREMENT_FEE = PROCUREMENT_FEE;
const CONVENIENCE_FEE_RATE = 0.05;
// Above this duty the convenience fee applies; at or below it, it is Rs.0.
const CONVENIENCE_FEE_THRESHOLD = 500;
function round2(value) {
    return Math.round(value * 100) / 100;
}
// `stampDuty` is the real, already-calculated government duty. A duty of 0
// means "not determinable yet" (the article's rule is unconfigured), so the
// total is returned as null rather than a fabricated figure - callers show
// "At Actuals" for it. The fees themselves are still exact and knowable.
function calculateEstampFees(stampDuty) {
    const duty = Number(stampDuty) || 0;
    const convenienceFee = duty > CONVENIENCE_FEE_THRESHOLD ? round2(duty * CONVENIENCE_FEE_RATE) : 0;
    const procurementFee = PROCUREMENT_FEE;
    const feeTotal = round2(convenienceFee + procurementFee);
    const gst = round2(feeTotal * GST_RATE);
    return {
        stampDuty: duty,
        convenienceFee,
        procurementFee,
        feeTotal,
        gst,
        // Government fees are the duty restated under its own label (as the
        // audited price summary presents it), never a second charge.
        governmentFees: duty,
        totalAmount: duty === 0 ? null : round2(duty + feeTotal + gst),
    };
}
