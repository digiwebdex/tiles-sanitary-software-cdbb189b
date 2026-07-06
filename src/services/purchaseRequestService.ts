/**
 * purchaseRequestService — V2 Sprint 5A (Supplier & Purchase Foundation).
 * VPS-backed via /api/purchase-requests.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type PurchaseRequestStatus = "draft" | "pending_approval" | "approved" | "rejected" | "cancelled";
export type PurchaseRequestItemSource = "manual" | "reorder_suggestion";

export interface PurchaseRequestItem {
  id: string;
  purchase_request_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  product_sku: string | null;
  product_unit_type: string | null;
  requested_qty: number;
  source: PurchaseRequestItemSource;
  notes: string | null;
  sort_order: number;
}

export interface PurchaseRequest {
  id: string;
  dealer_id: string;
  pr_number: string | null;
  status: PurchaseRequestStatus;
  department: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseRequestWithItems extends PurchaseRequest {
  items: PurchaseRequestItem[];
}

export interface PurchaseRequestItemInput {
  product_id?: string | null;
  product_name_snapshot: string;
  requested_qty: number;
  source?: PurchaseRequestItemSource;
  notes?: string | null;
}

export interface PurchaseRequestFormData {
  department: string;
  notes: string;
  items: PurchaseRequestItemInput[];
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

function buildPayload(form: PurchaseRequestFormData) {
  return {
    department: form.department.trim() || null,
    notes: form.notes.trim() || null,
    items: form.items.map((it) => ({
      product_id: it.product_id || null,
      product_name_snapshot: it.product_name_snapshot,
      requested_qty: it.requested_qty,
      source: it.source ?? "manual",
      notes: it.notes || null,
    })),
  };
}

export const purchaseRequestService = {
  async list(dealerId: string, search = "", page = 1, status = "", department = "") {
    const params = new URLSearchParams({ dealerId, page: String(Math.max(0, page - 1)) });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (department) params.set("department", department);
    const body = await vpsRequest<{ rows: PurchaseRequest[]; total: number }>(
      `/api/purchase-requests?${params.toString()}`,
    );
    return { data: body.rows ?? [], total: body.total ?? 0 };
  },

  async getById(id: string, dealerId: string) {
    return vpsRequest<PurchaseRequestWithItems>(`/api/purchase-requests/${id}?dealerId=${dealerId}`);
  },

  async create(dealerId: string, form: PurchaseRequestFormData) {
    const body = await vpsRequest<{ row: PurchaseRequest }>(`/api/purchase-requests?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify(buildPayload(form)),
    });
    return body.row;
  },

  async update(id: string, dealerId: string, form: PurchaseRequestFormData) {
    const body = await vpsRequest<{ row: PurchaseRequest }>(`/api/purchase-requests/${id}?dealerId=${dealerId}`, {
      method: "PUT",
      body: JSON.stringify(buildPayload(form)),
    });
    return body.row;
  },

  async submit(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: PurchaseRequest }>(
      `/api/purchase-requests/${id}/submit?dealerId=${dealerId}`,
      { method: "POST" },
    );
    return body.row;
  },

  async approve(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: PurchaseRequest }>(
      `/api/purchase-requests/${id}/approve?dealerId=${dealerId}`,
      { method: "POST" },
    );
    return body.row;
  },

  async reject(id: string, dealerId: string, reason: string) {
    const body = await vpsRequest<{ row: PurchaseRequest }>(
      `/api/purchase-requests/${id}/reject?dealerId=${dealerId}`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
    return body.row;
  },

  async cancel(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: PurchaseRequest }>(
      `/api/purchase-requests/${id}/cancel?dealerId=${dealerId}`,
      { method: "POST" },
    );
    return body.row;
  },

  async remove(id: string, dealerId: string) {
    await vpsRequest(`/api/purchase-requests/${id}?dealerId=${dealerId}`, { method: "DELETE" });
  },
};
