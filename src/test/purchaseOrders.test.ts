import { describe, expect, it } from "vitest";
import { computePoTotals } from "@/services/purchaseOrderService";

describe("computePoTotals", () => {
  it("computes line totals and the grand total", () => {
    const { lines, total } = computePoTotals([
      { product_id: "a", quantity: 10, unit_price: 250 },
      { product_id: "b", quantity: 3.5, unit_price: 100 },
    ]);
    expect(lines).toEqual([2500, 350]);
    expect(total).toBe(2850);
  });

  it("treats invalid numbers as zero", () => {
    const { total } = computePoTotals([
      { product_id: "a", quantity: Number.NaN, unit_price: 100 },
      { product_id: "b", quantity: 2, unit_price: Number.NaN },
    ]);
    expect(total).toBe(0);
  });

  it("handles an empty list", () => {
    expect(computePoTotals([]).total).toBe(0);
  });
});
