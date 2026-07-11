/**
 * goodsReceiptService — V2 Sprint 5C (Goods Receipt / GRN).
 * VPS-backed via /api/goods-receipts.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type GoodsReceiptStatus = "draft" | "completed" | "cancelled";

export interface GoodsReceiptItem {
  id: string;
  goods_receipt_id: string;
  purchase_order_item_id: string;
  product_id: string;
  product_sku?: string | null;
  received_qty: number;
  batch_no: string | null;
  lot_no: string | null;
  shade_code: string | null;
  caliber: string | null;
  manufacturing_date: string | null;
  warehouse_id: string | null;
  warehouse_name?: string | null;
  godown_id: string | null;
  godown_name?: string | null;
  rack_id: string | null;
  rack_name?: string | null;
  bin_id: string | null;
  bin_code?: string | null;
  notes: string | null;
  sort_order: number;
}

export interface GoodsReceipt {
  id: string;
  dealer_id: string;
  grn_number: string | null;
  status: GoodsReceiptStatus;
  purchase_order_id: string;
  po_number?: string | null;
  purchase_order_status?: string;
  supplier_name?: string | null;
  receive_date: string;
  notes: string | null;
  created_by: string | null;
  completed_by: string | null;
  completed_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoodsReceiptWithItems extends GoodsReceipt {
  items: GoodsReceiptItem[];
}

export interface PendingReceiptLine {
  purchase_order_item_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_type: string | null;
  per_box_sft: number | null;
  rate: number;
  ordered_qty: number;
  received_qty: number;
  pending_qty: number;
}

export interface PendingReceiptResponse {
  purchase_order: { id: string; po_number: string | null; status: string; supplier_name: string | null };
  lines: PendingReceiptLine[];
  receivable: boolean;
}

export interface GoodsReceiptItemInput {
  purchase_order_item_id: string;
  product_id: string;
  received_qty: number;
  batch_no?: string | null;
  lot_no?: string | null;
  shade_code?: string | null;
  caliber?: string | null;
  manufacturing_date?: string | null;
  warehouse_id?: string | null;
  godown_id?: string | null;
  rack_id?: string | null;
  bin_id?: string | null;
  notes?: string | null;
}

export interface GoodsReceiptFormData {
  purchase_order_id: string;
  receive_date: string;
  notes?: string | null;
  items: GoodsReceiptItemInput[];
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

function buildPayload(form: GoodsReceiptFormData) {
  return {
    purchase_order_id: form.purchase_order_id,
    receive_date: form.receive_date,
    notes: form.notes?.trim() || null,
    items: form.items.map((it) => ({
      purchase_order_item_id: it.purchase_order_item_id,
      product_id: it.product_id,
      received_qty: it.received_qty,
      batch_no: it.batch_no || null,
      lot_no: it.lot_no || null,
      shade_code: it.shade_code || null,
      caliber: it.caliber || null,
      manufacturing_date: it.manufacturing_date || null,
      warehouse_id: it.warehouse_id || null,
      godown_id: it.godown_id || null,
      rack_id: it.rack_id || null,
      bin_id: it.bin_id || null,
      notes: it.notes || null,
    })),
  };
}

export const goodsReceiptService = {
  async list(dealerId: string, search = "", page = 1, status = "", purchaseOrderId = "") {
    const params = new URLSearchParams({ dealerId, page: String(Math.max(0, page - 1)) });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (purchaseOrderId) params.set("purchaseOrderId", purchaseOrderId);
    const body = await vpsRequest<{ rows: GoodsReceipt[]; total: number }>(`/api/goods-receipts?${params.toString()}`);
    return { data: body.rows ?? [], total: body.total ?? 0 };
  },

  async getById(id: string, dealerId: string) {
    return vpsRequest<GoodsReceiptWithItems>(`/api/goods-receipts/${id}?dealerId=${dealerId}`);
  },

  async getPendingForPurchaseOrder(poId: string, dealerId: string) {
    return vpsRequest<PendingReceiptResponse>(`/api/goods-receipts/purchase-order/${poId}/pending?dealerId=${dealerId}`);
  },

  async create(dealerId: string, form: GoodsReceiptFormData) {
    const body = await vpsRequest<{ row: GoodsReceipt }>(`/api/goods-receipts?dealerId=${dealerId}`, {
      method: "POST",
      body: JSON.stringify(buildPayload(form)),
    });
    return body.row;
  },

  async update(id: string, dealerId: string, form: GoodsReceiptFormData) {
    const body = await vpsRequest<{ row: GoodsReceipt }>(`/api/goods-receipts/${id}?dealerId=${dealerId}`, {
      method: "PUT",
      body: JSON.stringify(buildPayload(form)),
    });
    return body.row;
  },

  async remove(id: string, dealerId: string) {
    await vpsRequest(`/api/goods-receipts/${id}?dealerId=${dealerId}`, { method: "DELETE" });
  },

  async complete(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: GoodsReceipt }>(`/api/goods-receipts/${id}/complete?dealerId=${dealerId}`, { method: "POST" });
    return body.row;
  },

  async cancel(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: GoodsReceipt }>(`/api/goods-receipts/${id}/cancel?dealerId=${dealerId}`, { method: "POST" });
    return body.row;
  },
};
