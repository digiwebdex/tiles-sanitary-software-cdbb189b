/**
 * rfqService — V2 Sprint 5A (Supplier & Purchase Foundation).
 * VPS-backed via /api/rfqs. Suppliers have no login/portal in this system —
 * "Supplier Response" is recorded by dealer staff (communication happens
 * outside the system), not submitted by the supplier directly.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type RfqStatus = "draft" | "sent" | "comparing" | "approved" | "cancelled";

export interface RfqItem {
  id: string;
  rfq_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  product_sku: string | null;
  qty: number;
  selected_supplier_id: string | null;
  selected_supplier_name: string | null;
  notes: string | null;
  sort_order: number;
}

export interface RfqSupplier {
  id: string;
  rfq_id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_phone?: string | null;
  status: "invited" | "responded" | "declined";
  sent_at: string | null;
}

export interface Rfq {
  id: string;
  dealer_id: string;
  rfq_number: string | null;
  status: RfqStatus;
  purchase_request_id: string | null;
  notes: string | null;
  created_by: string | null;
  sent_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RfqWithDetails extends Rfq {
  items: RfqItem[];
  suppliers: RfqSupplier[];
}

export interface RfqComparisonQuote {
  supplier_id: string;
  supplier_name: string;
  quoted_rate: number | null;
  quoted_lead_time_days: number | null;
}

export interface RfqComparisonItem {
  rfq_item_id: string;
  product_name_snapshot: string;
  qty: number;
  selected_supplier_id: string | null;
  quotes: RfqComparisonQuote[];
}

export interface RfqComparison {
  rfq: Rfq;
  items: RfqComparisonItem[];
  suppliers: Array<{ supplier_id: string; supplier_name: string; status: string }>;
}

export interface RfqItemInput {
  product_id?: string | null;
  product_name_snapshot: string;
  qty: number;
  notes?: string | null;
}

export interface RfqFormData {
  purchase_request_id?: string | null;
  notes: string;
  items: RfqItemInput[];
}

async function vpsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (body as any)?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

function buildPayload(form: RfqFormData) {
  return {
    purchase_request_id: form.purchase_request_id || null,
    notes: form.notes.trim() || null,
    items: form.items.map((it) => ({
      product_id: it.product_id || null,
      product_name_snapshot: it.product_name_snapshot,
      qty: it.qty,
      notes: it.notes || null,
    })),
  };
}

export const rfqService = {
  async list(dealerId: string, search = "", page = 1, status = "") {
    const params = new URLSearchParams({ dealerId, page: String(Math.max(0, page - 1)) });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    const body = await vpsRequest<{ rows: Rfq[]; total: number }>(`/api/rfqs?${params.toString()}`);
    return { data: body.rows ?? [], total: body.total ?? 0 };
  },

  async getById(id: string, dealerId: string) {
    return vpsRequest<RfqWithDetails>(`/api/rfqs/${id}?dealerId=${dealerId}`);
  },

  async create(dealerId: string, form: RfqFormData) {
    const body = await vpsRequest<{ row: Rfq }>(`/api/rfqs?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify(buildPayload(form)),
    });
    return body.row;
  },

  async update(id: string, dealerId: string, form: RfqFormData) {
    const body = await vpsRequest<{ row: Rfq }>(`/api/rfqs/${id}?dealerId=${dealerId}`, {
      method: "PUT",
      body: JSON.stringify(buildPayload(form)),
    });
    return body.row;
  },

  async inviteSuppliers(id: string, dealerId: string, supplierIds: string[]) {
    const body = await vpsRequest<{ rows: RfqSupplier[] }>(`/api/rfqs/${id}/suppliers?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify({ supplier_ids: supplierIds }),
    });
    return body.rows;
  },

  async removeSupplier(id: string, dealerId: string, supplierId: string) {
    await vpsRequest(`/api/rfqs/${id}/suppliers/${supplierId}?dealerId=${dealerId}`, { method: "DELETE" });
  },

  async send(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: Rfq }>(`/api/rfqs/${id}/send?dealerId=${dealerId}`, { method: "POST" });
    return body.row;
  },

  async recordResponse(
    id: string,
    dealerId: string,
    input: { supplier_id: string; rfq_item_id: string; quoted_rate: number; quoted_lead_time_days?: number | null; notes?: string | null },
  ) {
    const body = await vpsRequest<{ row: unknown }>(`/api/rfqs/${id}/responses?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return body.row;
  },

  async getComparison(id: string, dealerId: string) {
    return vpsRequest<RfqComparison>(`/api/rfqs/${id}/comparison?dealerId=${dealerId}`);
  },

  async approve(id: string, dealerId: string, selections: Array<{ rfq_item_id: string; supplier_id: string }>) {
    const body = await vpsRequest<{ row: Rfq }>(`/api/rfqs/${id}/approve?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify({ selections }),
    });
    return body.row;
  },

  async cancel(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: Rfq }>(`/api/rfqs/${id}/cancel?dealerId=${dealerId}`, { method: "POST" });
    return body.row;
  },
};
