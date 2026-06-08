import { assertDealerId } from "@/lib/tenancy";
import { rateLimits } from "@/lib/rateLimit";
import { notificationService } from "@/services/notificationService";
import { batchService, type FIFOAllocationResult } from "@/services/batchService";
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

/** Fetch a single product row via VPS (preview helper). */
async function fetchProductRow(
  dealerId: string,
  productId: string,
): Promise<{ id: string; name: string; unit_type: "box_sft" | "piece" } | null> {
  try {
    const params = new URLSearchParams({ dealerId });
    const res = await vpsAuthedFetch(`/api/products/${productId}?${params.toString()}`);
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({} as any));
    const row = (body as any)?.row;
    return row ? { id: row.id, name: row.name, unit_type: row.unit_type } : null;
  } catch {
    return null;
  }
}

/** Fetch many products in parallel via VPS GET-by-id calls. */
async function fetchProductsByIds(
  dealerId: string,
  ids: string[],
): Promise<Map<string, { id: string; name: string; unit_type: "box_sft" | "piece" }>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const results = await Promise.all(unique.map((id) => fetchProductRow(dealerId, id)));
  const map = new Map<string, { id: string; name: string; unit_type: "box_sft" | "piece" }>();
  for (const r of results) if (r) map.set(r.id, r);
  return map;
}

export interface SaleItemInput {
  product_id: string;
  quantity: number;
  /** Optional dual-unit fields (Box + Pc UI). Backend derives from `quantity` when absent. */
  box_qty?: number;
  piece_qty?: number;
  /** Phase T4: canonical SQFT for tile (stock_base_unit='sqft') items. */
  qty_sqft?: number;
  /** Phase T4: pricing unit context: per_piece | per_box | per_sqft. */
  rate_unit?: "per_piece" | "per_box" | "per_sqft";
  sale_rate: number;
  rate_source?: "default" | "tier" | "manual";
  tier_id?: string | null;
  original_resolved_rate?: number | null;
}

export interface CreateSaleInput {
  dealer_id: string;
  customer_name: string;
  sale_date: string;
  sale_type?: "direct_invoice" | "challan_mode";
  discount: number;
  discount_reference: string;
  client_reference: string;
  fitter_reference: string;
  paid_amount: number;
  payment_mode?: string;
  notes?: string;
  created_by?: string;
  items: SaleItemInput[];
  /** If true, allow sale even when stock is insufficient (backorder mode) */
  allow_backorder?: boolean;
  /** If true, user has acknowledged mixed shade/caliber warning */
  mixed_batch_acknowledged?: boolean;
  /** Explicit reservation selections: { product_id → [{ reservation_id, consume_qty }] } */
  reservation_selections?: Record<string, Array<{ reservation_id: string; consume_qty: number }>>;
  /** Optional project link (Project / Site-wise Sales). */
  project_id?: string | null;
  /** Optional delivery site under the chosen project. */
  site_id?: string | null;
}

// Phase 3U-26: checkStockAvailability removed (zero callers; backorder
// validation is now performed atomically inside POST /api/sales).

/**
 * Preview batch allocation for sale items (used by UI for mixed-shade warning).
 */
export async function previewBatchAllocation(
  dealerId: string,
  items: SaleItemInput[]
): Promise<{
  has_mixed_shade: boolean;
  has_mixed_caliber: boolean;
  item_allocations: Array<{
    product_id: string;
    product_name: string;
    allocation: FIFOAllocationResult;
  }>;
}> {
  const productIds = items.map(i => i.product_id);
  const productMap = await fetchProductsByIds(dealerId, productIds);

  let globalMixedShade = false;
  let globalMixedCaliber = false;
  const itemAllocations = [];

  for (const item of items) {
    if (!item.product_id || !item.quantity) continue;
    const product = productMap.get(item.product_id);
    const unitType = (product?.unit_type ?? "piece") as "box_sft" | "piece";

    const allocation = await batchService.planFIFOAllocation(
      item.product_id, dealerId, item.quantity, unitType
    );

    if (allocation.has_mixed_shade) globalMixedShade = true;
    if (allocation.has_mixed_caliber) globalMixedCaliber = true;

    itemAllocations.push({
      product_id: item.product_id,
      product_name: product?.name ?? "Unknown",
      allocation,
    });
  }

  return {
    has_mixed_shade: globalMixedShade,
    has_mixed_caliber: globalMixedCaliber,
    item_allocations: itemAllocations,
  };
}

export const salesService = {
  /** List sales (Phase 3G — VPS read). */
  async list(
    dealerId: string,
    page = 1,
    search?: string,
    opts: { projectId?: string | null; siteId?: string | null } = {},
  ) {
    const params = new URLSearchParams({ dealerId, page: String(page) });
    if (search?.trim()) params.set("search", search.trim());
    if (opts.projectId) params.set("projectId", opts.projectId);
    if (opts.siteId) params.set("siteId", opts.siteId);
    const body = await vpsRequest<{ data: any[]; total: number }>(
      `/api/sales?${params.toString()}`,
    );
    return { data: body.data ?? [], total: body.total ?? 0 };
  },

  /** Fetch a single sale with items (Phase 3G — VPS read). */
  async getById(id: string) {
    return await vpsRequest<any>(`/api/sales/${id}`);
  },

  /** Returns linked to a sale (for invoice display). */
  async getReturns(saleId: string) {
    return await vpsRequest<any[]>(`/api/sales/${saleId}/returns`);
  },

  /**
   * Create a sale.
   * Phase 3L: VPS performs the atomic transaction (header + items + FIFO batch
   * alloc + reservations + ledger + audit + challan stub). The client only
   * fires the post-create notification using the returned payload so SMS/email
   * templates remain on a single code path.
   */
  async create(input: CreateSaleInput) {
    rateLimits.api("sale_create");
    await assertDealerId(input.dealer_id);

    const sale = await vpsRequest<any>(`/api/sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealer_id: input.dealer_id,
        customer_name: input.customer_name,
        sale_date: input.sale_date,
        sale_type: input.sale_type ?? "direct_invoice",
        discount: input.discount,
        discount_reference: input.discount_reference || null,
        client_reference: input.client_reference || null,
        fitter_reference: input.fitter_reference || null,
        paid_amount: input.paid_amount,
        payment_mode: input.payment_mode || null,
        notes: input.notes || null,
        allow_backorder: input.allow_backorder,
        mixed_batch_acknowledged: input.mixed_batch_acknowledged,
        reservation_selections: input.reservation_selections,
        project_id: input.project_id ?? null,
        site_id: input.site_id ?? null,
        items: input.items,
      }),
    });

    // Fire-and-forget notification
    void (async () => {
      try {
        // Customer (VPS)
        let customer: { name: string; phone: string | null } | null = null;
        try {
          const cParams = new URLSearchParams({ dealerId: input.dealer_id });
          const cRes = await vpsAuthedFetch(
            `/api/customers/${sale.customer_id}?${cParams.toString()}`,
          );
          if (cRes.ok) {
            const cBody = await cRes.json().catch(() => ({} as any));
            const row = (cBody as any)?.row;
            if (row) customer = { name: row.name, phone: row.phone ?? null };
          }
        } catch { /* swallow */ }

        // Products (VPS, parallel by id)
        const productIds = input.items.map((i) => i.product_id);
        const prodMap = await fetchProductsByIds(input.dealer_id, productIds);

        const itemDetails = input.items.map((item) => {
          const prod = prodMap.get(item.product_id);
          return {
            name: prod?.name ?? "Product",
            quantity: item.quantity,
            unit: prod?.unit_type === "box_sft" ? "box" : "pc",
            rate: item.sale_rate,
            total: item.quantity * item.sale_rate,
          };
        });

        // Dealer (VPS)
        let dealerName = "";
        try {
          const dRes = await vpsAuthedFetch(`/api/dealers/${input.dealer_id}`);
          if (dRes.ok) {
            const dBody = await dRes.json().catch(() => ({} as any));
            dealerName = (dBody as any)?.dealer?.name ?? "";
          }
        } catch { /* swallow */ }

        notificationService.notifySaleCreated(input.dealer_id, {
          invoice_number: sale.invoice_number,
          customer_name: customer?.name ?? "Customer",
          customer_phone: customer?.phone ?? null,
          total_amount: Number(sale.total_amount),
          paid_amount: Number(sale.paid_amount),
          due_amount: Number(sale.due_amount),
          sale_date: sale.sale_date,
          sale_id: sale.id,
          items: itemDetails,
          dealer_name: dealerName,
        });
      } catch {
        // Swallow
      }
    })();

    return sale;
  },

  /**
   * Update a sale.
   * Phase 3M: VPS handles full atomic update (restore old batch allocations +
   * recompute totals + reapply allocations + rewrite ledger entries) using
   * restore_sale_batches/allocate_sale_batches RPCs.
   */
  async update(saleId: string, input: CreateSaleInput) {
    rateLimits.api("sale_update");
    await assertDealerId(input.dealer_id);

    return await vpsRequest<{ id: string }>(`/api/sales/${saleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealer_id: input.dealer_id,
        customer_name: input.customer_name,
        sale_date: input.sale_date,
        sale_type: input.sale_type ?? "direct_invoice",
        discount: input.discount,
        discount_reference: input.discount_reference || null,
        client_reference: input.client_reference || null,
        fitter_reference: input.fitter_reference || null,
        paid_amount: input.paid_amount,
        payment_mode: input.payment_mode || null,
        notes: input.notes || null,
        project_id: input.project_id ?? null,
        site_id: input.site_id ?? null,
        items: input.items,
      }),
    });
  },

  /**
   * Cancel/delete a sale.
   * Phase 3M: VPS handles atomic cancellation (delivery guards + reverse
   * stock/batch/ledger + delete sale + audit) in a single transaction.
   */
  async cancelSale(saleId: string, dealerId: string) {
    await assertDealerId(dealerId);
    await vpsRequest<void>(
      `/api/sales/${saleId}?dealerId=${encodeURIComponent(dealerId)}`,
      { method: "DELETE" },
    );
  },

  /** Atomic payment on a specific invoice — updates ledger + sale due. */
  async recordPayment(
    saleId: string,
    input: {
      amount: number;
      note?: string;
      payment_mode?: string;
      paid_account_id?: string | null;
    },
  ) {
    return await vpsRequest<{ ok: boolean; allocations: Array<{ saleId: string; invoiceNumber: string | null; amount: number }>; totalApplied: number }>(
      `/api/sales/${saleId}/payment`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
};
