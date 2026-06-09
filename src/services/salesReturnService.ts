/**
 * salesReturnService — VPS-only (Phase 3U-17).
 *
 * All reads + create flow through /api/returns/sales on the self-hosted
 * backend. Atomic transaction handles stock restoration, customer/cash
 * ledger entries, backorder cleanup, and audit log on the server side.
 */
import { validateInput, createSalesReturnServiceSchema } from "@/lib/validators";
import { assertDealerId } from "@/lib/tenancy";
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

export interface CreateSalesReturnInput {
  dealer_id: string;
  sale_id: string;
  product_id: string;
  qty: number;
  /** Phase T4: canonical SQFT for tile (stock_base_unit='sqft') items. */
  qty_sqft?: number;
  /** Phase T4: pricing unit context: per_piece | per_box | per_sqft. */
  rate_unit?: "per_piece" | "per_box" | "per_sqft";
  reason: string;
  is_broken: boolean;
  refund_amount: number;
  refund_mode?: string;
  return_date: string;
  created_by?: string;
}

export const salesReturnService = {
  async list(dealerId: string) {
    return await vpsRequest<any[]>(
      `/api/returns/sales?dealerId=${encodeURIComponent(dealerId)}`,
    );
  },

  async getSaleItems(saleId: string) {
    return await vpsRequest<any[]>(`/api/returns/sales/sale-items/${saleId}`);
  },

  async getSaleItemBatches(saleId: string) {
    const body = await vpsRequest<{ data: any[] }>(
      `/api/returns/sales/sale-items/${saleId}/batches`,
    );
    return body.data ?? [];
  },

  async create(input: CreateSalesReturnInput) {
    await assertDealerId(input.dealer_id);
    validateInput(createSalesReturnServiceSchema, input);

    return await vpsRequest<any>(`/api/returns/sales`, {
      method: "POST",
      body: JSON.stringify({
        dealer_id: input.dealer_id,
        sale_id: input.sale_id,
        product_id: input.product_id,
        qty: input.qty,
        qty_sqft: input.qty_sqft,
        rate_unit: input.rate_unit,
        reason: input.reason ?? null,
        is_broken: input.is_broken,
        refund_amount: input.refund_amount,
        refund_mode: input.refund_mode ?? null,
        return_date: input.return_date,
      }),
    });
  },
};
