/**
 * Backorder Allocation Service — VPS-only (Phase 3U-21).
 *
 * READS only. All write/allocation logic is server-side:
 *   - allocateNewStock         → atomic inside POST /api/purchases (3K)
 *   - releaseAllocations       → atomic inside DELETE/PUT /api/sales/:id (3M)
 *   - updateSaleBackorderFlag  → atomic inside POST /api/sales (3L) + sale mutations
 *
 * Frontend reads dispatch to /api/backorders/* endpoints.
 *
 * Fulfillment status flow:
 *   in_stock            → no shortage at sale time
 *   pending             → backorder exists, nothing allocated yet
 *   partially_allocated → some stock allocated from purchases, not all
 *   ready_for_delivery  → all backorder qty allocated, awaiting delivery
 *   partially_delivered → some delivered, some still pending
 *   fulfilled           → fully delivered, no pending quantity
 *   cancelled           → cancelled safely
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type FulfillmentStatus =
  | "in_stock"
  | "pending"
  | "partially_allocated"
  | "ready_for_delivery"
  | "partially_delivered"
  | "fulfilled"
  | "cancelled";

export function computeFulfillmentStatus(
  quantity: number,
  backorderQty: number,
  allocatedQty: number,
): FulfillmentStatus {
  if (backorderQty <= 0) return "in_stock";
  if (allocatedQty <= 0) return "pending";
  if (allocatedQty >= backorderQty) return "ready_for_delivery";
  return "partially_allocated";
}

export const FULFILLMENT_STATUS_LABELS: Record<string, string> = {
  in_stock: "In Stock",
  pending: "Backordered",
  partially_allocated: "Partially Allocated",
  ready_for_delivery: "Ready for Delivery",
  partially_delivered: "Partially Delivered",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

export const FULFILLMENT_STATUS_COLORS: Record<string, string> = {
  in_stock: "text-green-600",
  pending: "text-red-600",
  partially_allocated: "text-amber-600",
  ready_for_delivery: "text-blue-600",
  partially_delivered: "text-orange-600",
  fulfilled: "text-green-700",
  cancelled: "text-muted-foreground",
};

async function vpsGet<T>(path: string): Promise<T> {
  const res = await vpsAuthedFetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const backorderAllocationService = {
  async getSaleFulfillmentSummary(saleId: string) {
    return vpsGet<any[]>(`/api/backorders/sale/${encodeURIComponent(saleId)}`);
  },

  async getBackorderSummary(dealerId: string) {
    return vpsGet<any[]>(`/api/backorders/summary?dealerId=${encodeURIComponent(dealerId)}`);
  },

  async getPendingFulfillment(dealerId: string) {
    return vpsGet<any[]>(`/api/backorders/pending?dealerId=${encodeURIComponent(dealerId)}`);
  },

  async getShortageDemandReport(dealerId: string) {
    return vpsGet<any[]>(
      `/api/backorders/shortage-demand?dealerId=${encodeURIComponent(dealerId)}`,
    );
  },

  async getReadyForDelivery(dealerId: string) {
    return vpsGet<any[]>(
      `/api/backorders/ready-for-delivery?dealerId=${encodeURIComponent(dealerId)}`,
    );
  },

  async getPartiallyDelivered(dealerId: string) {
    return vpsGet<any[]>(
      `/api/backorders/partially-delivered?dealerId=${encodeURIComponent(dealerId)}`,
    );
  },

  async getOldestPending(dealerId: string) {
    try {
      return await vpsGet<any | null>(
        `/api/backorders/oldest-pending?dealerId=${encodeURIComponent(dealerId)}`,
      );
    } catch {
      return null;
    }
  },

  /** V2 Sprint 3C — "Supplier Backorder": which purchase covers which shortage. */
  async getSupplierLinks(dealerId: string) {
    const body = await vpsGet<{ rows: any[] }>(
      `/api/backorders/supplier-links?dealerId=${encodeURIComponent(dealerId)}`,
    );
    return body.rows ?? [];
  },

  async getDashboardStats(dealerId: string) {
    try {
      return await vpsGet<{
        totalBackorders: number;
        pendingFulfillment: number;
        readyForDelivery: number;
        partiallyDelivered: number;
        oldestPendingDate: string | null;
      }>(`/api/backorders/dashboard-stats?dealerId=${encodeURIComponent(dealerId)}`);
    } catch {
      return {
        totalBackorders: 0,
        pendingFulfillment: 0,
        readyForDelivery: 0,
        partiallyDelivered: 0,
        oldestPendingDate: null as string | null,
      };
    }
  },
};
