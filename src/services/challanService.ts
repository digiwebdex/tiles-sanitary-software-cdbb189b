/**
 * challanService — VPS-only (Phase 3U-17).
 *
 * All reads + mutations flow through /api/challans on the self-hosted
 * backend. The legacy Supabase fallback was removed because production
 * hosts (sanitileserp.com + lovable previews) always resolve
 * AUTH_BACKEND="vps". Stock reserve/unreserve/deduct, ledger entries, and
 * commission promotion happen atomically inside backend transactions.
 */
import { assertDealerId } from "@/lib/tenancy";
import { rateLimits } from "@/lib/rateLimit";
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

export interface CreateChallanInput {
  dealer_id: string;
  sale_id: string;
  challan_date: string;
  driver_name?: string;
  driver_phone?: string;
  transport_name?: string;
  vehicle_no?: string;
  scheduled_delivery_date?: string;
  notes?: string;
  created_by?: string;
  show_price?: boolean;
}

export const challanService = {
  async list(
    dealerId: string,
    opts: { projectId?: string | null; siteId?: string | null } = {},
  ) {
    const params = new URLSearchParams({ dealerId });
    if (opts.projectId) params.set("projectId", opts.projectId);
    if (opts.siteId) params.set("siteId", opts.siteId);
    return await vpsRequest<any[]>(`/api/challans?${params.toString()}`);
  },

  async getBySaleId(saleId: string) {
    // Backend infers dealer scope from JWT.
    return await vpsRequest<any[]>(`/api/challans/by-sale/${saleId}`);
  },

  async getById(id: string) {
    return await vpsRequest<any>(`/api/challans/${id}`);
  },

  async create(input: CreateChallanInput) {
    rateLimits.api("challan_create");
    await assertDealerId(input.dealer_id);

    return await vpsRequest<any>(`/api/challans`, {
      method: "POST",
      body: JSON.stringify({
        dealer_id: input.dealer_id,
        sale_id: input.sale_id,
        challan_date: input.challan_date,
        driver_name: input.driver_name ?? null,
        transport_name: input.transport_name ?? null,
        vehicle_no: input.vehicle_no ?? null,
        notes: input.notes ?? null,
        show_price: input.show_price ?? false,
      }),
    });
  },

  async markDelivered(challanId: string, dealerId: string) {
    await assertDealerId(dealerId);
    await vpsRequest<{ ok: boolean }>(`/api/challans/${challanId}/deliver`, {
      method: "POST",
      body: JSON.stringify({ dealer_id: dealerId }),
    });
  },

  async convertToInvoice(saleId: string, dealerId: string) {
    await assertDealerId(dealerId);
    await vpsRequest<{ ok: boolean }>(`/api/challans/convert-invoice/${saleId}`, {
      method: "POST",
      body: JSON.stringify({ dealer_id: dealerId }),
    });
  },

  async update(
    challanId: string,
    dealerId: string,
    updates: {
      challan_date?: string;
      driver_name?: string;
      driver_phone?: string;
      transport_name?: string;
      vehicle_no?: string;
      scheduled_delivery_date?: string;
      notes?: string;
      items?: { id: string; product_id: string; quantity: number; sale_rate: number }[];
    },
  ) {
    await assertDealerId(dealerId);
    await vpsRequest<{ ok: boolean }>(`/api/challans/${challanId}`, {
      method: "PUT",
      body: JSON.stringify({ dealer_id: dealerId, ...updates }),
    });
  },

  async cancelChallan(challanId: string, dealerId: string) {
    await assertDealerId(dealerId);
    await vpsRequest<{ ok: boolean }>(`/api/challans/${challanId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ dealer_id: dealerId }),
    });
  },

  async updateDeliveryStatus(challanId: string, dealerId: string, newStatus: string) {
    await assertDealerId(dealerId);
    await vpsRequest<{ ok: boolean }>(`/api/challans/${challanId}/delivery-status`, {
      method: "PATCH",
      body: JSON.stringify({ dealer_id: dealerId, delivery_status: newStatus }),
    });
  },

  /**
   * Phase 3U-30: toggle the show_price flag on a challan (dealer_admin only,
   * enforced backend-side). Used by the Challan page price-visibility switch.
   */
  async setShowPrice(challanId: string, showPrice: boolean) {
    await vpsRequest<{ ok: boolean; show_price: boolean }>(
      `/api/challans/${challanId}/show-price`,
      {
        method: "PATCH",
        body: JSON.stringify({ show_price: showPrice }),
      },
    );
  },
};
