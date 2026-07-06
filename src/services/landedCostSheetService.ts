/**
 * landedCostSheetService — V2 Sprint 5E (Landed Cost).
 * VPS-backed via /api/landed-cost-sheets.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

async function vpsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (body as any)?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export type LandedCostSheetStatus = "draft" | "applied" | "cancelled";

export interface LandedCostSheetFormData {
  purchase_id: string;
  sheet_date: string;
  freight_amount?: number;
  insurance_amount?: number;
  customs_duty_amount?: number;
  vat_amount?: number;
  port_charges_amount?: number;
  cf_charges_amount?: number;
  local_transport_amount?: number;
  other_charges_amount?: number;
  notes?: string | null;
}

export const CHARGE_FIELDS: Array<{ key: keyof LandedCostSheetFormData; label: string }> = [
  { key: "freight_amount", label: "Freight" },
  { key: "insurance_amount", label: "Insurance" },
  { key: "customs_duty_amount", label: "Customs Duty" },
  { key: "vat_amount", label: "VAT (import stage)" },
  { key: "port_charges_amount", label: "Port Charges" },
  { key: "cf_charges_amount", label: "C&F Charges" },
  { key: "local_transport_amount", label: "Local Transport" },
  { key: "other_charges_amount", label: "Other Charges" },
];

export const landedCostSheetService = {
  async list(dealerId: string, purchaseId = "") {
    const params = new URLSearchParams({ dealerId });
    if (purchaseId) params.set("purchaseId", purchaseId);
    const body = await vpsRequest<{ rows: any[] }>(`/api/landed-cost-sheets?${params.toString()}`);
    return body.rows ?? [];
  },

  async getById(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: any }>(`/api/landed-cost-sheets/${id}?dealerId=${encodeURIComponent(dealerId)}`);
    return body.row;
  },

  async create(dealerId: string, form: LandedCostSheetFormData) {
    const body = await vpsRequest<{ row: any }>(`/api/landed-cost-sheets?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      body: JSON.stringify(form),
    });
    return body.row;
  },

  async apply(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: any }>(`/api/landed-cost-sheets/${id}/apply?dealerId=${encodeURIComponent(dealerId)}`, { method: "POST" });
    return body.row;
  },

  async cancel(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: any }>(`/api/landed-cost-sheets/${id}/cancel?dealerId=${encodeURIComponent(dealerId)}`, { method: "POST" });
    return body.row;
  },
};
