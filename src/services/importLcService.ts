/**
 * importLcService — V2 Sprint 5E (Import LC).
 * BDT-only paperwork/status tracker: Proforma Invoice -> Letter of Credit ->
 * Shipment (+ Containers) -> Customs Clearance. VPS-backed via /api/import-lc.
 * No FX conversion (Multi-currency is out of scope this sprint) — amounts
 * are BDT, with an optional free-text currency_note for context.
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

export type PiStatus = "draft" | "confirmed" | "cancelled";
export type LcStatus = "draft" | "opened" | "amended" | "closed" | "cancelled";
export type ShipmentStatus = "in_transit" | "arrived" | "customs_clearance" | "cleared" | "cancelled";

export interface ProformaInvoiceFormData {
  supplier_id: string;
  pi_number: string;
  pi_date: string;
  total_amount?: number;
  currency_note?: string | null;
  status?: PiStatus;
  notes?: string | null;
}

export interface LetterOfCreditFormData {
  proforma_invoice_id?: string | null;
  supplier_id: string;
  lc_number: string;
  lc_date: string;
  issuing_bank?: string | null;
  lc_amount?: number;
  expiry_date?: string | null;
  status?: LcStatus;
  notes?: string | null;
}

export interface ShipmentContainerInput {
  container_no: string;
  container_size?: string | null;
  seal_no?: string | null;
  notes?: string | null;
}

export interface ShipmentFormData {
  letter_of_credit_id?: string | null;
  supplier_id: string;
  purchase_id?: string | null;
  shipment_ref: string;
  vessel_name?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  eta_date?: string | null;
  actual_arrival_date?: string | null;
  cf_agent_name?: string | null;
  cf_agent_contact?: string | null;
  customs_bill_of_entry_no?: string | null;
  customs_clearance_date?: string | null;
  status?: ShipmentStatus;
  notes?: string | null;
  containers?: ShipmentContainerInput[];
}

export const importLcService = {
  proformaInvoices: {
    async list(dealerId: string) {
      const body = await vpsRequest<{ rows: any[] }>(`/api/import-lc/proforma-invoices?dealerId=${encodeURIComponent(dealerId)}`);
      return body.rows ?? [];
    },
    async getById(id: string, dealerId: string) {
      const body = await vpsRequest<{ row: any }>(`/api/import-lc/proforma-invoices/${id}?dealerId=${encodeURIComponent(dealerId)}`);
      return body.row;
    },
    async create(dealerId: string, form: ProformaInvoiceFormData) {
      const body = await vpsRequest<{ row: any }>(`/api/import-lc/proforma-invoices?dealerId=${encodeURIComponent(dealerId)}`, { method: "POST", body: JSON.stringify(form) });
      return body.row;
    },
    async update(id: string, dealerId: string, form: ProformaInvoiceFormData) {
      const body = await vpsRequest<{ row: any }>(`/api/import-lc/proforma-invoices/${id}?dealerId=${encodeURIComponent(dealerId)}`, { method: "PUT", body: JSON.stringify(form) });
      return body.row;
    },
    async remove(id: string, dealerId: string) {
      await vpsRequest(`/api/import-lc/proforma-invoices/${id}?dealerId=${encodeURIComponent(dealerId)}`, { method: "DELETE" });
    },
  },

  lettersOfCredit: {
    async list(dealerId: string) {
      const body = await vpsRequest<{ rows: any[] }>(`/api/import-lc/letters-of-credit?dealerId=${encodeURIComponent(dealerId)}`);
      return body.rows ?? [];
    },
    async getById(id: string, dealerId: string) {
      const body = await vpsRequest<{ row: any }>(`/api/import-lc/letters-of-credit/${id}?dealerId=${encodeURIComponent(dealerId)}`);
      return body.row;
    },
    async create(dealerId: string, form: LetterOfCreditFormData) {
      const body = await vpsRequest<{ row: any }>(`/api/import-lc/letters-of-credit?dealerId=${encodeURIComponent(dealerId)}`, { method: "POST", body: JSON.stringify(form) });
      return body.row;
    },
    async update(id: string, dealerId: string, form: LetterOfCreditFormData) {
      const body = await vpsRequest<{ row: any }>(`/api/import-lc/letters-of-credit/${id}?dealerId=${encodeURIComponent(dealerId)}`, { method: "PUT", body: JSON.stringify(form) });
      return body.row;
    },
    async remove(id: string, dealerId: string) {
      await vpsRequest(`/api/import-lc/letters-of-credit/${id}?dealerId=${encodeURIComponent(dealerId)}`, { method: "DELETE" });
    },
  },

  shipments: {
    async list(dealerId: string) {
      const body = await vpsRequest<{ rows: any[] }>(`/api/import-lc/shipments?dealerId=${encodeURIComponent(dealerId)}`);
      return body.rows ?? [];
    },
    async getById(id: string, dealerId: string) {
      const body = await vpsRequest<{ row: any }>(`/api/import-lc/shipments/${id}?dealerId=${encodeURIComponent(dealerId)}`);
      return body.row;
    },
    async create(dealerId: string, form: ShipmentFormData) {
      const body = await vpsRequest<{ row: any }>(`/api/import-lc/shipments?dealerId=${encodeURIComponent(dealerId)}`, { method: "POST", body: JSON.stringify(form) });
      return body.row;
    },
    async update(id: string, dealerId: string, form: ShipmentFormData) {
      const body = await vpsRequest<{ row: any }>(`/api/import-lc/shipments/${id}?dealerId=${encodeURIComponent(dealerId)}`, { method: "PUT", body: JSON.stringify(form) });
      return body.row;
    },
    async remove(id: string, dealerId: string) {
      await vpsRequest(`/api/import-lc/shipments/${id}?dealerId=${encodeURIComponent(dealerId)}`, { method: "DELETE" });
    },
  },
};
