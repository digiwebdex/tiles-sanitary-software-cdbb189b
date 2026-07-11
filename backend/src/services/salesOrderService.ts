/**
 * Sales Order — V2 Sprint 4B pure business logic (no DB access), extracted
 * so it's unit-testable without mocking Knex — same pattern as
 * availabilityService.ts (Sprint 3C) and inventoryIntelligenceService.ts
 * (Sprint 3D).
 */

export interface SalesOrderLineInput {
  quantity: number;
  rate: number;
  discount_value?: number | null;
}

/** Mirrors quotations.ts's calcLineTotal exactly — same rounding/clamping rules. */
export function calcLineTotal(it: SalesOrderLineInput): number {
  const gross = Number(it.quantity || 0) * Number(it.rate || 0);
  const disc = Number(it.discount_value || 0);
  return Math.max(0, gross - disc);
}

/** Mirrors quotations.ts's calcTotals exactly — same rounding/clamping rules. */
export function calcTotals(
  items: SalesOrderLineInput[],
  discountType: 'flat' | 'percent',
  discountValue: number,
): { subtotal: number; total_amount: number } {
  const subtotal = items.reduce((s, it) => s + calcLineTotal(it), 0);
  const discountAmount =
    discountType === 'percent' ? (subtotal * Number(discountValue || 0)) / 100 : Number(discountValue || 0);
  const total = Math.max(0, subtotal - discountAmount);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    total_amount: Math.round(total * 100) / 100,
  };
}

/**
 * V2 Sprint 4B — "handle partial reservations if stock is limited."
 *
 * create_stock_reservation (Sprint 3C RPC, unmodified) only validates
 * against product_batches when a batch_id is supplied; for a product-level
 * reservation it unconditionally increments stock.reserved_*_qty with no
 * availability check at all. So the cap against real availability has to
 * happen here, before the RPC is called, using Sprint 3C's own
 * computeAvailability() output (available_pieces, always in pieces)
 * converted back to the line's native unit.
 */
export function computeReservableQty(
  requestedQtyNative: number,
  availablePieces: number,
  unitType: 'box_sft' | 'piece',
  piecesPerBox: number,
): number {
  const ppb = Math.max(1, Math.floor(piecesPerBox) || 1);
  const availableNative = unitType === 'box_sft' ? availablePieces / ppb : availablePieces;
  return Math.max(0, Math.min(Number(requestedQtyNative) || 0, availableNative));
}

/**
 * V2 Sprint 4B — Caliber validation (informational only, no auto-matching
 * per the sprint's explicit exclusion). Returns true when the line's
 * preferred caliber disagrees with the resolved batch's actual caliber.
 */
export function hasCaliberMismatch(
  preferredCaliber: string | null | undefined,
  actualCaliber: string | null | undefined,
): boolean {
  if (!preferredCaliber || !actualCaliber) return false;
  return preferredCaliber.trim().toLowerCase() !== actualCaliber.trim().toLowerCase();
}

export interface DeliveryReadinessLine {
  quantity: number | string;
  reserved_qty: number | string;
  product_id: string | null;
}

/**
 * V2 Sprint 4B — Delivery Planning readiness status, derived from how much
 * of each line's quantity is actually reserved. Lines without a product_id
 * (custom/no-inventory lines) are excluded from the computation since they
 * have nothing to reserve against.
 */
export function computeDeliveryReadiness(items: DeliveryReadinessLine[]): 'pending' | 'ready' | 'partially_ready' {
  const withProduct = items.filter((it) => it.product_id);
  if (!withProduct.length) return 'pending';
  const fullyReserved = withProduct.filter((it) => Number(it.reserved_qty) >= Number(it.quantity) && Number(it.quantity) > 0);
  const anyReserved = withProduct.filter((it) => Number(it.reserved_qty) > 0);
  if (fullyReserved.length === withProduct.length) return 'ready';
  if (anyReserved.length > 0) return 'partially_ready';
  return 'pending';
}
