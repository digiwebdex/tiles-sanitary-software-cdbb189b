/**
 * Availability Engine — V2 Sprint 3C.
 * Single source of truth for "how much of this product can I promise now."
 * See backend/src/services/availabilityService.ts for the formula.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface AvailabilityBreakdown {
  product_id: string;
  unit_type: "box_sft" | "piece";
  pieces_per_box: number;
  current_stock_pieces: number;
  reserved_pieces: number;
  allocated_pieces: number;
  display_stock_pieces: number;
  pending_delivery_pieces: number;
  incoming_purchase_pieces: number;
  available_pieces: number;
  available_including_incoming_pieces: number;
  available_display: string;
}

export interface BatchAvailability {
  batch_id: string;
  batch_no: string;
  shade_code: string | null;
  caliber: string | null;
  lot_no: string | null;
  total_pieces: number;
  reserved_pieces: number;
  allocated_pieces: number;
  available_pieces: number;
}

async function vpsGet<T>(path: string): Promise<T> {
  const res = await vpsAuthedFetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const availabilityService = {
  getAvailability: (productId: string, dealerId: string) =>
    vpsGet<AvailabilityBreakdown>(
      `/api/availability/${encodeURIComponent(productId)}?dealerId=${encodeURIComponent(dealerId)}`,
    ),
  getBatchAvailability: async (productId: string, dealerId: string) => {
    const body = await vpsGet<{ rows: BatchAvailability[] }>(
      `/api/availability/${encodeURIComponent(productId)}/batches?dealerId=${encodeURIComponent(dealerId)}`,
    );
    return body.rows ?? [];
  },
};
