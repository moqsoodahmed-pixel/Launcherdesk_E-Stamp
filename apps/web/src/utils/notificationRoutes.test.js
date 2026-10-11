import { describe, it, expect } from "vitest";
import { safeRouteFor } from "./notificationRoutes";

describe("safeRouteFor", () => {
  it("maps every entity type the API notifies about to an existing route", () => {
    expect(safeRouteFor({ entityType: "EStampOrder", entityId: "o1" })).toBe("/orders/o1");
    expect(safeRouteFor({ entityType: "Payment", entityId: "p1" })).toBe("/payments/p1");
    expect(safeRouteFor({ entityType: "BulkEStampBatch", entityId: "b1" })).toBe("/estamps/bulk/b1");
  });
  it("returns null for unknown types or a missing id", () => {
    expect(safeRouteFor({ entityType: "Mystery", entityId: "x" })).toBeNull();
    expect(safeRouteFor({ entityType: "Payment" })).toBeNull();
  });
});
