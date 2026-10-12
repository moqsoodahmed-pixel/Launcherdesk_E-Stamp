import { describe, it, expect } from "vitest";
import { calculateEstampFees, PROCUREMENT_FEE } from "../src/utils/estampPricing.js";

describe("calculateEstampFees - reproduces the audited price summary exactly", () => {
  // LauncherDesk_eStamp_UI_Behaviour_Audit.pdf, Step 16 / "Pricing Observed
  // During This Audit": Delhi, Article 5 General Agreement, Rs.500 duty ->
  // Convenience Fee Rs.0, Procurement Charge Rs.99, GST (18%) Rs.17.82,
  // Government Fees Rs.500, Total payable Rs.616.82.
  it("matches the Rs.500 duty breakdown captured live in the audit", () => {
    const p = calculateEstampFees(500);
    expect(p.stampDuty).toBe(500);
    expect(p.convenienceFee).toBe(0);
    expect(p.procurementFee).toBe(99);
    expect(p.gst).toBe(17.82);
    expect(p.governmentFees).toBe(500);
    expect(p.totalAmount).toBe(616.82);
  });

  it("charges GST on the fees only, never on the government stamp duty", () => {
    const p = calculateEstampFees(500);
    expect(p.gst).toBe(Math.round((p.convenienceFee + p.procurementFee) * 0.18 * 100) / 100);
    // Sanity: 18% of the duty itself (Rs.90) is never part of the total.
    expect(p.totalAmount).toBe(500 + 99 + 17.82);
  });

  it("applies the 5% convenience fee only above a Rs.500 duty", () => {
    expect(calculateEstampFees(500).convenienceFee).toBe(0);
    const above = calculateEstampFees(1000);
    expect(above.convenienceFee).toBe(50);
    expect(above.gst).toBe(Math.round((50 + 99) * 0.18 * 100) / 100);
    expect(above.totalAmount).toBe(Math.round((1000 + 149 + above.gst) * 100) / 100);
  });

  it("returns a null total for a duty of 0 instead of inventing one, but still gives exact fees", () => {
    const p = calculateEstampFees(0);
    expect(p.stampDuty).toBe(0);
    expect(p.governmentFees).toBe(0);
    expect(p.totalAmount).toBeNull();
    expect(p.procurementFee).toBe(PROCUREMENT_FEE);
    expect(p.gst).toBe(17.82);
  });
});
