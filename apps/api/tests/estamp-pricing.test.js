import { describe, it, expect } from "vitest";
import { calculateEstampFees, PROCUREMENT_FEE, GST_RATE } from "../src/utils/estampPricing.js";

describe("calculateEstampFees - procurement charge, GST base, and total", () => {
  it("charges a flat Rs.15 procurement fee and 18% GST on that procurement fee alone", () => {
    const p = calculateEstampFees(500);
    expect(p.stampDuty).toBe(500);
    expect(p.convenienceFee).toBe(0);
    expect(p.procurementFee).toBe(15);
    expect(p.gst).toBe(2.7);
    expect(p.governmentFees).toBe(500);
    expect(p.totalAmount).toBe(517.7);
  });

  it("GST is computed from the procurement fee only - never the stamp duty, the consideration price, or the convenience fee", () => {
    const p = calculateEstampFees(500);
    expect(p.gst).toBe(Math.round(p.procurementFee * GST_RATE * 100) / 100);
    // Sanity: 18% of the duty itself, and 18% of duty+convenienceFee, are
    // both NEVER part of the GST figure or the total.
    expect(p.totalAmount).toBe(500 + 15 + 2.7);

    const above = calculateEstampFees(1000);
    expect(above.convenienceFee).toBe(50);
    // Adding a convenience fee never changes GST - it still taxes only the
    // flat procurement charge.
    expect(above.gst).toBe(2.7);
    expect(above.totalAmount).toBe(1000 + 50 + 15 + 2.7);
  });

  it("applies the 5% convenience fee only above a Rs.500 duty", () => {
    expect(calculateEstampFees(500).convenienceFee).toBe(0);
    const above = calculateEstampFees(1000);
    expect(above.convenienceFee).toBe(50);
  });

  it("the total is always a real number, even when the stamp duty is not yet configured (0) - it just omits the still-unknown duty component", () => {
    const p = calculateEstampFees(0);
    expect(p.stampDuty).toBe(0);
    expect(p.governmentFees).toBe(0);
    expect(p.procurementFee).toBe(PROCUREMENT_FEE);
    expect(p.gst).toBe(2.7);
    expect(p.totalAmount).toBe(17.7);
    expect(typeof p.totalAmount).toBe("number");
    expect(p.totalAmount).not.toBeNull();
  });
});
