import { validateInput, createPurchaseServiceSchema } from "@/lib/validators";
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

export interface PurchaseItemInput {
  product_id: string;
  quantity: number;
  /** Phase T4: canonical SQFT for tile (stock_base_unit='sqft') items. */
  qty_sqft?: number;
  /** Phase T4: pricing unit context: per_piece | per_box | per_sqft. */
  rate_unit?: "per_piece" | "per_box" | "per_sqft";
  purchase_rate: number;
  offer_price: number;
  transport_cost: number;
  labor_cost: number;
  other_cost: number;
  batch_no?: string;
  lot_no?: string;
  shade_code?: string;
  caliber?: string;
}

export interface CreatePurchaseInput {
  dealer_id: string;
  supplier_id: string;
  invoice_number: string;
  purchase_date: string;
  notes?: string;
  created_by?: string;
  voucher_discount?: number;
  paid_on_create?: number;
  paid_account_id?: string | null;
  items: PurchaseItemInput[];
}

export interface PurchaseDraft {
  id: string;
  label: string | null;
  payload: any;
  updated_at: string;
}

export const purchaseService = {
  async list(dealerId: string, page = 1, search?: string) {
    const params = new URLSearchParams({ dealerId, page: String(page) });
    if (search?.trim()) params.set("search", search.trim());
    const body = await vpsRequest<{ data: any[]; total: number }>(
      `/api/purchases?${params.toString()}`,
    );
    return { data: body.data ?? [], total: body.total ?? 0 };
  },

  async getById(id: string) {
    return await vpsRequest<any>(`/api/purchases/${id}`);
  },

  async create(input: CreatePurchaseInput) {
    rateLimits.api("purchase_create");
    await assertDealerId(input.dealer_id);
    validateInput(createPurchaseServiceSchema, input);

    return await vpsRequest<any>(`/api/purchases`, {
      method: "POST",
      body: JSON.stringify({
        dealer_id: input.dealer_id,
        supplier_id: input.supplier_id,
        invoice_number: input.invoice_number || null,
        purchase_date: input.purchase_date,
        notes: input.notes ?? null,
        voucher_discount: input.voucher_discount ?? 0,
        paid_on_create: input.paid_on_create ?? 0,
        paid_account_id: input.paid_account_id ?? null,
        items: input.items,
      }),
    });
  },

  // ─────── Drafts (Phase 3U-31) ───────
  async listDrafts(dealerId: string): Promise<PurchaseDraft[]> {
    const body = await vpsRequest<{ data: PurchaseDraft[] }>(
      `/api/purchases/drafts/list?dealerId=${encodeURIComponent(dealerId)}`,
    );
    return body.data ?? [];
  },

  async saveDraft(
    dealerId: string,
    payload: unknown,
    opts: { id?: string; label?: string } = {},
  ): Promise<PurchaseDraft> {
    return await vpsRequest<PurchaseDraft>(`/api/purchases/drafts?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      body: JSON.stringify({
        id: opts.id,
        label: opts.label ?? null,
        payload,
      }),
    });
  },

  async recordPayment(
    purchaseId: string,
    input: { amount: number; note?: string; paid_account_id?: string | null },
  ) {
    return await vpsRequest<{ ok: true; totalApplied: number; dueAfter: number }>(
      `/api/purchases/${purchaseId}/payment`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },

  /** Reverse a posted purchase (P2-09). Removes stock + ledger; marks document reversed. */
  async reverse(purchaseId: string, dealerId: string) {
    await assertDealerId(dealerId);
    return await vpsRequest<{ purchase: any; reversed: boolean }>(
      `/api/purchases/${purchaseId}/reverse?dealerId=${encodeURIComponent(dealerId)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
  },

  async deleteDraft(dealerId: string, id: string): Promise<void> {
    await vpsRequest<{ ok: true }>(
      `/api/purchases/drafts/${id}?dealerId=${encodeURIComponent(dealerId)}`,
      { method: "DELETE" },
    );
  },
};
