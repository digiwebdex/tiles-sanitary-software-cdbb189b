/**
 * Phase 5 — VAT calculation helpers (Bangladesh standard rate default 15%).
 */

export interface VatBreakdown {
  taxable_amount: number;
  vat_rate: number;
  vat_amount: number;
  sd_amount: number;
  total_with_tax: number;
}

export interface DealerVatSettings {
  vat_enabled: boolean;
  default_vat_rate: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function normalizeDealerVatSettings(row: {
  vat_enabled?: boolean | null;
  default_vat_rate?: number | string | null;
} | null | undefined): DealerVatSettings {
  return {
    vat_enabled: row?.vat_enabled === true,
    default_vat_rate: round2(Number(row?.default_vat_rate ?? 15) || 15),
  };
}

/** VAT-exclusive: total = taxable + VAT (+ optional SD). */
export function computeVatBreakdown(
  amountAfterDiscount: number,
  settings: DealerVatSettings,
  sdRatePct = 0,
): VatBreakdown {
  const taxable_amount = round2(Math.max(0, amountAfterDiscount));
  if (!settings.vat_enabled || settings.default_vat_rate <= 0) {
    return {
      taxable_amount,
      vat_rate: 0,
      vat_amount: 0,
      sd_amount: 0,
      total_with_tax: taxable_amount,
    };
  }
  const vat_rate = settings.default_vat_rate;
  const vat_amount = round2((taxable_amount * vat_rate) / 100);
  const sd_amount = round2((taxable_amount * sdRatePct) / 100);
  return {
    taxable_amount,
    vat_rate,
    vat_amount,
    sd_amount,
    total_with_tax: round2(taxable_amount + vat_amount + sd_amount),
  };
}
