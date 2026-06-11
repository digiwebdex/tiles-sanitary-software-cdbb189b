import { describe, expect, it } from "vitest";
import { computeVatBreakdown, normalizeDealerVatSettings } from "../../backend/src/lib/vatMath";

describe("vatMath", () => {
  it("returns zero VAT when disabled", () => {
    const settings = normalizeDealerVatSettings({ vat_enabled: false, default_vat_rate: 15 });
    const b = computeVatBreakdown(1000, settings);
    expect(b.taxable_amount).toBe(1000);
    expect(b.vat_amount).toBe(0);
    expect(b.total_with_tax).toBe(1000);
  });

  it("computes 15% VAT on taxable amount", () => {
    const settings = normalizeDealerVatSettings({ vat_enabled: true, default_vat_rate: 15 });
    const b = computeVatBreakdown(1000, settings);
    expect(b.taxable_amount).toBe(1000);
    expect(b.vat_rate).toBe(15);
    expect(b.vat_amount).toBe(150);
    expect(b.total_with_tax).toBe(1150);
  });
});
