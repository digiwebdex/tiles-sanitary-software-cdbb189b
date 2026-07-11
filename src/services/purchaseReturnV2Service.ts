/**
 * purchaseReturnV2Service — V2 Sprint 5E (Purchase Return).
 * VPS-backed via /api/purchase-returns. Named "V2" to avoid colliding with
 * the pre-existing `purchaseReturnService.ts` (legacy /api/returns/purchases,
 * kept unmodified for backward compatibility — see docs/SPRINT5E_PURCHASE_RETURN.md
 * for why this sprint added new endpoints instead of extending the old ones).
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

export type PurchaseReturnStatus = "draft" | "completed" | "cancelled";

export interface ReturnablePurchase {
  id: string;
  invoice_number: string | null;
  purchase_date: string;
  supplier_id: string;
  supplier_name: string | null;
}

export interface ReturnableLine {
  purchase_item_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  purchase_rate: number;
  returned_qty: number;
  returnable_qty: number;
  warehouse_id: string | null;
  godown_id: string | null;
  rack_id: string | null;
}

export interface PurchaseReturnItemInput {
  purchase_item_id: string;
  product_id: string;
  return_qty: number;
  unit_price: number;
  reason?: string | null;
  warehouse_id?: string | null;
  godown_id?: string | null;
  rack_id?: string | null;
}

export interface PurchaseReturnFormData {
  supplier_id: string;
  purchase_id?: string | null;
  return_date: string;
  notes?: string | null;
  items: PurchaseReturnItemInput[];
}

export const purchaseReturnV2Service = {
  async listReturnablePurchases(dealerId: string, supplierId = "") {
    const params = new URLSearchParams({ dealerId });
    if (supplierId) params.set("supplierId", supplierId);
    const body = await vpsRequest<{ rows: ReturnablePurchase[] }>(`/api/purchase-returns/purchases/returnable?${params.toString()}`);
    return body.rows ?? [];
  },

  async getPurchaseLines(purchaseId: string, dealerId: string) {
    return vpsRequest<{ purchase: any; lines: ReturnableLine[] }>(
      `/api/purchase-returns/purchase/${purchaseId}/lines?dealerId=${encodeURIComponent(dealerId)}`,
    );
  },

  async create(dealerId: string, form: PurchaseReturnFormData) {
    const body = await vpsRequest<{ row: any }>(`/api/purchase-returns?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      body: JSON.stringify({ ...form, notes: form.notes?.trim() || null }),
    });
    return body.row;
  },

  async update(id: string, dealerId: string, form: PurchaseReturnFormData) {
    const body = await vpsRequest<{ row: any }>(`/api/purchase-returns/${id}?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "PUT",
      body: JSON.stringify({ ...form, notes: form.notes?.trim() || null }),
    });
    return body.row;
  },

  async remove(id: string, dealerId: string) {
    await vpsRequest(`/api/purchase-returns/${id}?dealerId=${encodeURIComponent(dealerId)}`, { method: "DELETE" });
  },

  async getById(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: any }>(`/api/purchase-returns/${id}?dealerId=${encodeURIComponent(dealerId)}`);
    return body.row;
  },

  async complete(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: any }>(`/api/purchase-returns/${id}/complete?dealerId=${encodeURIComponent(dealerId)}`, { method: "POST" });
    return body.row;
  },

  async cancel(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: any }>(`/api/purchase-returns/${id}/cancel?dealerId=${encodeURIComponent(dealerId)}`, { method: "POST" });
    return body.row;
  },
};
