/**
 * V2 Sprint 4C — VAT Reports (Mushak-style registers).
 * Reuses the existing, unmodified /api/reports/vat/* endpoints (Phase 5
 * P5-04) — this is a read-only frontend addition, no backend VAT
 * calculation logic is duplicated here.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface VatRegisterTotals {
  taxable: number;
  vat: number;
  sd: number;
  total: number;
}

export interface VatSalesRegisterRow {
  saleId: string;
  invoiceNumber: string | null;
  saleDate: string;
  customerId: string;
  customerName: string;
  customerTaxId: string | null;
  taxableAmount: number;
  vatRate: number;
  vatAmount: number;
  sdAmount: number;
  totalAmount: number;
}

export interface VatPurchaseRegisterRow {
  purchaseId: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  supplierId: string;
  supplierName: string;
  supplierTaxId: string | null;
  taxableAmount: number;
  vatRate: number;
  vatAmount: number;
  sdAmount: number;
  totalAmount: number;
}

async function vpsRequest<T>(path: string): Promise<T> {
  const res = await vpsAuthedFetch(path);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error((body as any)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const vatReportService = {
  async getSalesRegister(dealerId: string, from: string, to: string) {
    return vpsRequest<{ rows: VatSalesRegisterRow[]; totals: VatRegisterTotals; period: { from: string; to: string }; form: string }>(
      `/api/reports/vat/sales-register?dealerId=${encodeURIComponent(dealerId)}&from=${from}&to=${to}`,
    );
  },
  async getPurchaseRegister(dealerId: string, from: string, to: string) {
    return vpsRequest<{ rows: VatPurchaseRegisterRow[]; totals: VatRegisterTotals; period: { from: string; to: string }; form: string }>(
      `/api/reports/vat/purchase-register?dealerId=${encodeURIComponent(dealerId)}&from=${from}&to=${to}`,
    );
  },
};
