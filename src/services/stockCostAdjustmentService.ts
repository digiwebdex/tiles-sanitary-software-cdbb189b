/**
 * stockCostAdjustmentService — V2 Sprint 5E (Batch/Stock Cost Update).
 * VPS-backed via /api/stock-cost-adjustments.
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

export interface StockCostAdjustment {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  old_avg_cost: number;
  new_avg_cost: number;
  reason: string;
  adjustment_type: "manual" | "landed_cost";
  landed_cost_sheet_id: string | null;
  created_at: string;
}

export const stockCostAdjustmentService = {
  async list(dealerId: string, productId = "") {
    const params = new URLSearchParams({ dealerId });
    if (productId) params.set("productId", productId);
    const body = await vpsRequest<{ rows: StockCostAdjustment[] }>(`/api/stock-cost-adjustments?${params.toString()}`);
    return body.rows ?? [];
  },

  async create(dealerId: string, input: { product_id: string; new_avg_cost: number; reason: string }) {
    const body = await vpsRequest<{ row: StockCostAdjustment }>(`/api/stock-cost-adjustments?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return body.row;
  },
};
