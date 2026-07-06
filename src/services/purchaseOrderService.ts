/**
 * purchaseOrderService — V2 Sprint 5B (Purchase Order).
 * VPS-backed via /api/purchase-orders.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type PurchaseOrderStatus =
  | "draft" | "pending_approval" | "approved" | "sent"
  | "partially_received" | "fully_received" | "cancelled" | "closed";

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  product_sku_snapshot: string | null;
  unit_type: string | null;
  per_box_sft: number | null;
  ordered_qty: number;
  rate: number;
  rate_unit: string | null;
  line_total: number;
  source_rfq_item_id: string | null;
  notes: string | null;
  sort_order: number;
}

export interface PurchaseOrderApprovalHistoryEntry {
  id: string;
  action: "submitted" | "approved" | "rejected" | "sent" | "cancelled" | "closed";
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  dealer_id: string;
  po_number: string | null;
  status: PurchaseOrderStatus;
  supplier_id: string;
  supplier_name?: string;
  supplier_phone?: string | null;
  supplier_email?: string | null;
  order_date: string;
  expected_delivery_date: string | null;
  subtotal: number;
  discount_type: "flat" | "percent";
  discount_value: number;
  total_amount: number;
  notes: string | null;
  terms_text: string | null;
  source_rfq_id: string | null;
  source_purchase_request_id: string | null;
  cloned_from_id: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_by: string | null;
  sent_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderWithDetails extends PurchaseOrder {
  items: PurchaseOrderItem[];
  approval_history: PurchaseOrderApprovalHistoryEntry[];
}

export interface PurchaseOrderItemInput {
  product_id?: string | null;
  product_name_snapshot: string;
  product_sku_snapshot?: string | null;
  unit_type?: "box_sft" | "piece" | null;
  per_box_sft?: number | null;
  ordered_qty: number;
  rate: number;
  rate_unit?: "per_piece" | "per_box" | "per_sqft" | null;
  notes?: string | null;
}

export interface PurchaseOrderFormData {
  supplier_id: string;
  order_date: string;
  expected_delivery_date?: string | null;
  discount_type: "flat" | "percent";
  discount_value: number;
  notes?: string | null;
  terms_text?: string | null;
  items: PurchaseOrderItemInput[];
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

function buildPayload(form: PurchaseOrderFormData) {
  return {
    supplier_id: form.supplier_id,
    order_date: form.order_date,
    expected_delivery_date: form.expected_delivery_date || null,
    discount_type: form.discount_type,
    discount_value: form.discount_value,
    notes: form.notes?.trim() || null,
    terms_text: form.terms_text?.trim() || null,
    items: form.items.map((it) => ({
      product_id: it.product_id || null,
      product_name_snapshot: it.product_name_snapshot,
      product_sku_snapshot: it.product_sku_snapshot || null,
      unit_type: it.unit_type || null,
      per_box_sft: it.per_box_sft ?? null,
      ordered_qty: it.ordered_qty,
      rate: it.rate,
      rate_unit: it.rate_unit || null,
      notes: it.notes || null,
    })),
  };
}

export const purchaseOrderService = {
  async list(dealerId: string, search = "", page = 1, status = "", supplierId = "") {
    const params = new URLSearchParams({ dealerId, page: String(Math.max(0, page - 1)) });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (supplierId) params.set("supplierId", supplierId);
    const body = await vpsRequest<{ rows: PurchaseOrder[]; total: number }>(
      `/api/purchase-orders?${params.toString()}`,
    );
    return { data: body.rows ?? [], total: body.total ?? 0 };
  },

  async getById(id: string, dealerId: string) {
    return vpsRequest<PurchaseOrderWithDetails>(`/api/purchase-orders/${id}?dealerId=${dealerId}`);
  },

  async getLastPurchaseRate(dealerId: string, supplierId: string, productId: string) {
    return vpsRequest<{ last_purchase_rate: number | null; last_purchase_date: string | null }>(
      `/api/purchase-orders/last-purchase-rate?dealerId=${dealerId}&supplierId=${supplierId}&productId=${productId}`,
    );
  },

  async create(dealerId: string, form: PurchaseOrderFormData) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify(buildPayload(form)),
    });
    return body.row;
  },

  async update(id: string, dealerId: string, form: PurchaseOrderFormData) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}?dealerId=${dealerId}`, {
      method: "PUT",
      body: JSON.stringify(buildPayload(form)),
    });
    return body.row;
  },

  async remove(id: string, dealerId: string) {
    await vpsRequest(`/api/purchase-orders/${id}?dealerId=${dealerId}`, { method: "DELETE" });
  },

  async clone(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}/clone?dealerId=${dealerId}`, {
      method: "POST",
    });
    return body.row;
  },

  async submit(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}/submit?dealerId=${dealerId}`, { method: "POST" });
    return body.row;
  },

  async approve(id: string, dealerId: string, note?: string) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}/approve?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify({ note: note || null }),
    });
    return body.row;
  },

  async reject(id: string, dealerId: string, reason: string) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}/reject?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    return body.row;
  },

  async send(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}/send?dealerId=${dealerId}`, { method: "POST" });
    return body.row;
  },

  async markPartiallyReceived(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}/mark-partially-received?dealerId=${dealerId}`, { method: "POST" });
    return body.row;
  },

  async markFullyReceived(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}/mark-fully-received?dealerId=${dealerId}`, { method: "POST" });
    return body.row;
  },

  async close(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}/close?dealerId=${dealerId}`, { method: "POST" });
    return body.row;
  },

  async cancel(id: string, dealerId: string, reason?: string) {
    const body = await vpsRequest<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}/cancel?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify({ reason: reason || null }),
    });
    return body.row;
  },

  async convertFromRfq(rfqId: string, dealerId: string) {
    const body = await vpsRequest<{ rows: PurchaseOrder[] }>(`/api/purchase-orders/from-rfq/${rfqId}?dealerId=${dealerId}`, {
      method: "POST",
    });
    return body.rows;
  },

  async email(id: string, dealerId: string, to?: string) {
    await vpsRequest(`/api/purchase-orders/${id}/email?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify({ to: to || undefined }),
    });
  },
};
