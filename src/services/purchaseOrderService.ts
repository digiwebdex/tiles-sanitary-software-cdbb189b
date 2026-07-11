/**
 * purchaseOrderService — formal purchase orders (/api/purchase-orders).
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type PurchaseOrderStatus = "ordered" | "received" | "cancelled";

export interface PurchaseOrderItemInput {
  product_id: string;
  quantity: number;
  unit_price: number;
}

export interface PurchaseOrderItem extends PurchaseOrderItemInput {
  id: string;
  total: number;
  product_name: string | null;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string | null;
  order_date: string;
  expected_delivery_date: string | null;
  status: PurchaseOrderStatus;
  advance_paid: number;
  total_amount: number;
  notes: string | null;
  converted_draft_id: string | null;
  created_at: string;
  item_count?: number;
  items?: PurchaseOrderItem[];
}

export interface CreatePurchaseOrderInput {
  supplier_id: string;
  order_date: string;
  expected_delivery_date?: string | null;
  advance_paid?: number;
  notes?: string | null;
  items: PurchaseOrderItemInput[];
}

/** Line + grand totals for a PO item list. */
export function computePoTotals(items: PurchaseOrderItemInput[]): {
  lines: number[];
  total: number;
} {
  const lines = items.map((it) => (Number(it.quantity) || 0) * (Number(it.unit_price) || 0));
  return { lines, total: lines.reduce((a, b) => a + b, 0) };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({} as unknown));
  if (!res.ok) {
    const msg = (body as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export const purchaseOrderService = {
  async list(status?: PurchaseOrderStatus | ""): Promise<PurchaseOrder[]> {
    const qs = status ? `?status=${status}` : "";
    const body = await request<{ rows: PurchaseOrder[] }>(`/api/purchase-orders${qs}`);
    return body.rows ?? [];
  },

  async get(id: string): Promise<PurchaseOrder> {
    const body = await request<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}`);
    return body.row;
  },

  async create(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
    const body = await request<{ row: PurchaseOrder }>(`/api/purchase-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return body.row;
  },

  async update(
    id: string,
    patch: Partial<Pick<PurchaseOrder, "status" | "expected_delivery_date" | "advance_paid" | "notes">>,
  ): Promise<PurchaseOrder> {
    const body = await request<{ row: PurchaseOrder }>(`/api/purchase-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return body.row;
  },

  /** Mark received and create a purchase draft; returns the draft id. */
  async convert(id: string): Promise<{ draft_id: string; already: boolean }> {
    return request<{ draft_id: string; already: boolean }>(
      `/api/purchase-orders/${id}/convert`,
      { method: "POST" },
    );
  },
};
