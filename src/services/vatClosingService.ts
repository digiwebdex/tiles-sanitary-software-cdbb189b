/**
 * vatClosingService — V2 Sprint 6E.
 * Wraps /api/vat-closing (Input/Output VAT summary, reconciliation, Mushak 9.1 draft, closing).
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface VatSummary {
  period: { from: string; to: string };
  output_vat_summary: { taxable: number; vat: number; sd: number; total: number; invoice_count: number };
  input_vat_summary: { taxable: number; vat: number; sd: number; total: number; invoice_count: number };
  reconciliation: { output_tax: number; input_tax: number; net_payable: number; position: "payable" | "refundable" };
}

export interface Mushak91Draft {
  form: "mushak-9.1";
  internal_only: true;
  disclaimer: string;
  period: { from: string; to: string };
  total_output_tax: number;
  total_taxable_supplies: number;
  total_input_tax_credit: number;
  total_taxable_purchases: number;
  net_vat_payable: number;
  net_vat_refundable: number;
}

export interface VatPeriodClosing {
  id: string;
  dealer_id: string;
  period_start: string;
  period_end: string;
  output_vat_total: number;
  output_sd_total: number;
  input_vat_total: number;
  input_sd_total: number;
  net_payable: number;
  notes: string | null;
  closed_at: string;
  closed_by: string | null;
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const vatClosingService = {
  async summary(dealerId: string, from: string, to: string): Promise<VatSummary> {
    const r = await vpsAuthedFetch(`/api/vat-closing/summary?dealerId=${dealerId}&from=${from}&to=${to}`);
    if (!r.ok) return parseError(r, "Failed to load VAT summary");
    return r.json();
  },
  async mushak91Draft(dealerId: string, from: string, to: string): Promise<Mushak91Draft> {
    const r = await vpsAuthedFetch(`/api/vat-closing/mushak-9-1-draft?dealerId=${dealerId}&from=${from}&to=${to}`);
    if (!r.ok) return parseError(r, "Failed to load Mushak 9.1 draft");
    return r.json();
  },
  async close(dealerId: string, payload: { period_start: string; period_end: string; notes?: string | null }): Promise<{ row: VatPeriodClosing }> {
    const r = await vpsAuthedFetch(`/api/vat-closing/close?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to close VAT period");
    return r.json();
  },
  async history(dealerId: string): Promise<{ rows: VatPeriodClosing[] }> {
    const r = await vpsAuthedFetch(`/api/vat-closing/history?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load VAT closing history");
    return r.json();
  },
};
