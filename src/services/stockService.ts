/**
 * Stock Service — VPS-only (Phase 3U-27).
 *
 * All write paths route to VPS atomic adjustment endpoints
 * (POST /api/adjustments/{add|deduct|restore|broken}).
 *
 * Phase 3U-27: Final two read paths (getProduct, getAvailableQty) migrated
 * from Supabase to VPS (/api/products/:id, /api/stock?f.product_id=…).
 * Zero Supabase imports remain.
 *
 * Removed earlier (3U-26):
 *   - reserveStock / unreserveStock / deductReservedStock — superseded by
 *     VPS challan + delivery endpoints (Phase 3O), atomic server-side.
 *   - updateAverageCost — moved into the VPS purchase-create transaction
 *     (Phase 3K).
 *   - applyStockChange / computeStockUpdate / getOrCreateStock — old
 *     USE_VPS=false fallback.
 *
 * Kept:
 *   - getAvailableQty: read-only helper for sale form previews.
 *   - deductStockWithBackorder: legacy thin wrapper (preserved for any
 *     in-flight callers; no current callers).
 */
import { validateInput, stockAdjustmentServiceSchema } from "@/lib/validators";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

async function vpsAdjustment(
  type: "add" | "deduct" | "restore" | "broken",
  body: Record<string, unknown>,
) {
  const res = await vpsAuthedFetch(`/api/adjustments/${type}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (data as any)?.error || `Stock adjustment failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
}

interface StockProduct {
  id: string;
  unit_type: "box_sft" | "piece";
  per_box_sft: number | null;
}

/**
 * Read product unit metadata (unit_type, per_box_sft) for client-side previews.
 * Phase 3U-27: now hits VPS GET /api/products/:id.
 */
async function getProduct(productId: string, dealerId: string): Promise<StockProduct> {
  const params = new URLSearchParams({ dealerId });
  const res = await vpsAuthedFetch(`/api/products/${productId}?${params.toString()}`);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(`Product not found: ${productId}`);
  const row = (body as any)?.row;
  if (!row) throw new Error(`Product not found: ${productId}`);
  return {
    id: row.id,
    unit_type: row.unit_type,
    per_box_sft: row.per_box_sft ?? null,
  };
}

/**
 * Get currently available stock for a product (preview helper).
 * Phase 3U-27: now hits VPS GET /api/stock?f.product_id=…
 * Reservation overlay handled by batchService.planFIFOAllocation when needed.
 */
async function getAvailableQty(productId: string, dealerId: string): Promise<number> {
  const product = await getProduct(productId, dealerId);
  const params = new URLSearchParams({
    dealerId,
    pageSize: "1",
    "f.product_id": productId,
  });
  const res = await vpsAuthedFetch(`/api/stock?${params.toString()}`);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) return 0;
  const row = (body as any)?.rows?.[0];
  if (!row) return 0;
  return product.unit_type === "box_sft"
    ? Number(row.box_qty ?? 0)
    : Number(row.piece_qty ?? 0);
}

/**
 * Deduct with backorder awareness.
 * Wraps the VPS deduct endpoint; falls back to "all backordered" if
 * available qty is 0. Kept for backward compatibility — no current callers.
 */
async function deductStockWithBackorder(
  productId: string,
  requestedQty: number,
  dealerId: string,
): Promise<{ deducted: number; backordered: number; availableAtSale: number }> {
  if (requestedQty <= 0) throw new Error("Quantity must be positive");
  const available = await getAvailableQty(productId, dealerId);
  const deductible = Math.min(available, requestedQty);
  const backordered = Math.max(0, requestedQty - available);

  if (deductible > 0) {
    await vpsAdjustment("deduct", {
      dealer_id: dealerId,
      product_id: productId,
      quantity: deductible,
    });
  }
  return { deducted: deductible, backordered, availableAtSale: available };
}

export const stockService = {
  addStock: (productId: string, quantity: number, dealerId: string) =>
    vpsAdjustment("add", { dealer_id: dealerId, product_id: productId, quantity }),

  deductStock: (productId: string, quantity: number, dealerId: string) =>
    vpsAdjustment("deduct", { dealer_id: dealerId, product_id: productId, quantity }),

  restoreStock: (productId: string, quantity: number, dealerId: string) =>
    vpsAdjustment("restore", { dealer_id: dealerId, product_id: productId, quantity }),

  adjustStock: (
    productId: string,
    quantity: number,
    type: "add" | "deduct",
    dealerId: string,
  ) => {
    validateInput(stockAdjustmentServiceSchema, {
      product_id: productId,
      dealer_id: dealerId,
      quantity,
      type,
    });
    return vpsAdjustment(type, { dealer_id: dealerId, product_id: productId, quantity });
  },

  /**
   * Phase 2E — Box+Pc dual-unit adjust. Pass either box_qty/piece_qty
   * (preferred) or quantity (legacy fallback). Backend computes total_pieces
   * and writes a stock_ledger audit row.
   */
  adjustStockBoxPiece: (
    productId: string,
    type: "add" | "deduct" | "broken",
    dealerId: string,
    payload: { box_qty?: number; piece_qty?: number; quantity?: number; reason?: string },
  ) => {
    const body: Record<string, unknown> = {
      dealer_id: dealerId,
      product_id: productId,
    };
    if (payload.box_qty != null) body.box_qty = payload.box_qty;
    if (payload.piece_qty != null) body.piece_qty = payload.piece_qty;
    if (payload.quantity != null) body.quantity = payload.quantity;
    if (payload.reason) body.reason = payload.reason;
    return vpsAdjustment(type, body);
  },

  deductBrokenStock: (productId: string, quantity: number, dealerId: string, reason: string) => {
    if (quantity <= 0) throw new Error("Quantity must be positive");
    return vpsAdjustment("broken", {
      dealer_id: dealerId,
      product_id: productId,
      quantity,
      reason,
    });
  },

  /**
   * P2 — List recent broken/damage entries for the dealer.
   */
  listDamages: async (
    dealerId: string,
    opts: { limit?: number; from?: string; to?: string } = {},
  ): Promise<DamageEntry[]> => {
    const params = new URLSearchParams({ dealerId });
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    const res = await vpsAuthedFetch(`/api/adjustments/broken?${params.toString()}`);
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error((body as any)?.error || 'Failed to load damage entries');
    return ((body as any).rows ?? []) as DamageEntry[];
  },

  /**
   * V2 Sprint 3A — Inventory Core: "Stock Ledger" / "Stock History".
   * Dealer-wide by default; pass productId to scope to one product.
   */
  getLedger: async (
    dealerId: string,
    opts: { productId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {},
  ): Promise<{ rows: StockLedgerEntry[]; total: number }> => {
    const params = new URLSearchParams({ dealerId });
    if (opts.productId) params.set('productId', opts.productId);
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    if (opts.page !== undefined) params.set('page', String(opts.page));
    if (opts.pageSize !== undefined) params.set('pageSize', String(opts.pageSize));
    const res = await vpsAuthedFetch(`/api/stock/ledger?${params.toString()}`);
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error((body as any)?.error || 'Failed to load stock ledger');
    return {
      rows: ((body as any).rows ?? []) as StockLedgerEntry[],
      total: Number((body as any).total ?? 0),
    };
  },

  getAvailableQty,
  deductStockWithBackorder,
};

export interface StockLedgerEntry {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_unit_type: 'box_sft' | 'piece';
  product_pieces_per_box: number | null;
  txn_type: string;
  reference_table: string | null;
  reference_id: string | null;
  reference_no: string | null;
  box_qty: number;
  piece_qty: number;
  total_pieces: number;
  stock_before_pieces: number;
  stock_after_pieces: number;
  stock_before_display: string;
  stock_after_display: string;
  created_by: string | null;
  created_at: string;
}

export interface DamageEntry {
  id: string;
  created_at: string;
  user_id: string | null;
  reason: string | null;
  total_pieces_delta: number;
  box_qty_delta: number;
  piece_qty_delta: number;
  product_id: string;
  product_name: string;
  sku: string;
  unit_type: 'box_sft' | 'piece';
  pieces_per_box: number | null;
  per_box_sft: number | null;
}
