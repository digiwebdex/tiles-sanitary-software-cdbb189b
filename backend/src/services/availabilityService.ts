import { db } from '../db/connection';
import { formatBoxPiece } from '../lib/units';

function num(v: unknown): number {
  return Number(v) || 0;
}

export interface AvailabilityBreakdown {
  product_id: string;
  unit_type: 'box_sft' | 'piece';
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

export interface ReservationRemainingRow {
  source_type: string;
  reserved_qty: number | string;
  fulfilled_qty: number | string;
  released_qty: number | string;
}

/**
 * V2 Sprint 3C — Availability Engine formula (pure — no DB access).
 *
 *   Available = Current Stock − Reserved − Allocated − Display − Pending
 *               Delivery + Incoming Purchase
 *
 * Split out from computeAvailability() so the actual business logic is
 * testable without mocking a Knex connection — see availabilityService.test.ts.
 *
 * Reconciling this with what already exists in the data model (see
 * docs/SPRINT3C_RESERVATION_BACKORDER_AVAILABILITY.md §5 for the full
 * writeup of the 11 divergent pre-existing "available qty" computations
 * this consolidates):
 *
 *   - `stock.total_pieces` is already NET of display stock — moving stock
 *     TO display deducts it via `adjustSellableStock` (see displayStock.ts).
 *     So "Current Stock" here is computed as the GROSS figure
 *     (`stock.total_pieces + display_stock_pieces`) specifically so that
 *     subtracting `display_stock_pieces` back out (matching the sprint's
 *     literal formula) doesn't double-count — the two terms cancel and the
 *     final `available_pieces` correctly equals `stock.total_pieces` minus
 *     the other terms, not less.
 *   - "Reserved" and "Allocated" are NOT read from `stock.reserved_box_qty
 *     /reserved_piece_qty` (an aggregate updated by the reservation RPCs)
 *     because that column mixes both kinds together and — critically —
 *     `stock.reserved_total_pieces` (a *different*, similarly-named column)
 *     is a ONE-TIME migration backfill that no RPC has updated since
 *     (dead/stale — do not use it). Instead this sums `stock_reservations`
 *     directly, split by `source_type = 'allocation'` vs not, which is also
 *     what lets this function tell reserved and allocated apart.
 *   - "Incoming Purchase" always evaluates to 0 today: `purchases` has no
 *     draft/pending status column (every purchase row represents stock
 *     already received at creation time — there is no "open PO" concept in
 *     this schema). The term is kept in the formula/return shape so a
 *     future Buy-Side sprint that introduces draft POs can wire it in
 *     without changing this function's contract.
 */
export function computeAvailabilityFromInputs(inputs: {
  productId: string;
  unitType: 'box_sft' | 'piece';
  piecesPerBox: number;
  currentStockNetPieces: number;
  displayQtyNative: number;
  activeReservations: ReservationRemainingRow[];
  pendingDeliveryQtyNative: number;
  incomingPurchasePieces?: number;
}): AvailabilityBreakdown {
  const ppb = Math.max(1, Math.floor(inputs.piecesPerBox) || 1);
  const toPieces = (qty: number) => (inputs.unitType === 'box_sft' ? qty * ppb : qty);

  const displayStockPieces = toPieces(num(inputs.displayQtyNative));

  let reservedPieces = 0;
  let allocatedPieces = 0;
  for (const r of inputs.activeReservations) {
    const remaining = num(r.reserved_qty) - num(r.fulfilled_qty) - num(r.released_qty);
    const pieces = toPieces(Math.max(0, remaining));
    if (r.source_type === 'allocation') allocatedPieces += pieces;
    else reservedPieces += pieces;
  }

  const pendingDeliveryPieces = toPieces(num(inputs.pendingDeliveryQtyNative));
  const incomingPurchasePieces = inputs.incomingPurchasePieces ?? 0;

  const grossCurrentStockPieces = num(inputs.currentStockNetPieces) + displayStockPieces;
  const availablePieces = Math.max(
    0,
    grossCurrentStockPieces - reservedPieces - allocatedPieces - displayStockPieces - pendingDeliveryPieces,
  );

  return {
    product_id: inputs.productId,
    unit_type: inputs.unitType,
    pieces_per_box: ppb,
    current_stock_pieces: grossCurrentStockPieces,
    reserved_pieces: reservedPieces,
    allocated_pieces: allocatedPieces,
    display_stock_pieces: displayStockPieces,
    pending_delivery_pieces: pendingDeliveryPieces,
    incoming_purchase_pieces: incomingPurchasePieces,
    available_pieces: availablePieces,
    available_including_incoming_pieces: availablePieces + incomingPurchasePieces,
    available_display: formatBoxPiece(availablePieces, ppb),
  };
}

/**
 * DB-fetching orchestrator around computeAvailabilityFromInputs(). Read-only
 * — does not mutate `stock`, `stock_reservations`, or any other table.
 * Existing call sites (sales.ts, challans.ts, autoPo.ts, etc.) are
 * intentionally left on their own existing formulas (see the sprint's "no
 * Sales workflow changes" constraint); this is a new, additive read surface
 * for Inventory/Dashboard to adopt, not a replacement wired into money-path
 * code.
 */
export async function computeAvailability(
  dealerId: string,
  productId: string,
): Promise<AvailabilityBreakdown> {
  const product = await db('products')
    .where({ id: productId, dealer_id: dealerId })
    .first('unit_type', 'pieces_per_box');
  if (!product) throw new Error('Product not found');

  const unitType = (product.unit_type ?? 'piece') as 'box_sft' | 'piece';
  const piecesPerBox = Number(product.pieces_per_box ?? 1);

  const stock = await db('stock')
    .where({ product_id: productId, dealer_id: dealerId })
    .first('total_pieces');

  const display = await db('display_stock')
    .where({ product_id: productId, dealer_id: dealerId })
    .first('display_qty');

  const activeReservations: ReservationRemainingRow[] = await db('stock_reservations')
    .where({ product_id: productId, dealer_id: dealerId, status: 'active' })
    .select('source_type', 'reserved_qty', 'fulfilled_qty', 'released_qty');

  const pendingDeliveryRow = await db('delivery_items as di')
    .innerJoin('deliveries as d', 'd.id', 'di.delivery_id')
    .where({ 'di.product_id': productId, 'di.dealer_id': dealerId, 'd.status': 'pending' })
    .sum<{ sum: string | null }[]>('di.quantity as sum')
    .first();

  return computeAvailabilityFromInputs({
    productId,
    unitType,
    piecesPerBox,
    currentStockNetPieces: num(stock?.total_pieces),
    displayQtyNative: num(display?.display_qty),
    activeReservations,
    pendingDeliveryQtyNative: num(pendingDeliveryRow?.sum),
    // Always 0 today — see the formula's header comment above.
    incomingPurchasePieces: 0,
  });
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

/**
 * V2 Sprint 3C — Shade/Lot/Batch/Caliber availability (pure — no DB access).
 * Per-batch breakdown so a dealer can see availability at the exact shade/
 * caliber/lot they need, without any automatic shade-matching recommendation
 * (explicitly out of scope — this only reports, it doesn't suggest).
 */
export function computeBatchAvailabilityFromInputs(
  batch: {
    id: string;
    batch_no: string;
    shade_code: string | null;
    caliber: string | null;
    lot_no: string | null;
    total_pieces: number | string;
    reserved_box_qty: number | string;
    reserved_piece_qty: number | string;
  },
  unitType: 'box_sft' | 'piece',
  piecesPerBox: number,
  allocatedPiecesForBatch: number,
): BatchAvailability {
  const ppb = Math.max(1, Math.floor(piecesPerBox) || 1);
  const toPieces = (qty: number) => (unitType === 'box_sft' ? qty * ppb : qty);
  const totalPieces = num(batch.total_pieces);
  // Only one of reserved_box_qty/reserved_piece_qty is ever non-zero for a
  // given batch — the reservation RPCs increment whichever column matches
  // the product's (fixed) unit_type — so pick by unit_type, same as toPieces.
  const reservedQtyNative = unitType === 'box_sft' ? num(batch.reserved_box_qty) : num(batch.reserved_piece_qty);
  const reservedPieces = toPieces(reservedQtyNative);
  return {
    batch_id: batch.id,
    batch_no: batch.batch_no,
    shade_code: batch.shade_code,
    caliber: batch.caliber,
    lot_no: batch.lot_no,
    total_pieces: totalPieces,
    reserved_pieces: reservedPieces,
    allocated_pieces: allocatedPiecesForBatch,
    available_pieces: Math.max(0, totalPieces - reservedPieces - allocatedPiecesForBatch),
  };
}

export async function computeBatchAvailability(
  dealerId: string,
  productId: string,
): Promise<BatchAvailability[]> {
  const product = await db('products')
    .where({ id: productId, dealer_id: dealerId })
    .first('unit_type', 'pieces_per_box');
  if (!product) throw new Error('Product not found');

  const unitType = (product.unit_type ?? 'piece') as 'box_sft' | 'piece';
  const piecesPerBox = Number(product.pieces_per_box ?? 1);
  const ppb = Math.max(1, Math.floor(piecesPerBox) || 1);
  const toPieces = (qty: number) => (unitType === 'box_sft' ? qty * ppb : qty);

  const batches = await db('product_batches')
    .where({ product_id: productId, dealer_id: dealerId, status: 'active' })
    .select('id', 'batch_no', 'shade_code', 'caliber', 'lot_no', 'total_pieces', 'reserved_box_qty', 'reserved_piece_qty')
    .orderBy('created_at', 'asc');

  const batchReservations = await db('stock_reservations')
    .where({ product_id: productId, dealer_id: dealerId, status: 'active' })
    .whereNotNull('batch_id')
    .select('batch_id', 'source_type', 'reserved_qty', 'fulfilled_qty', 'released_qty');

  const allocatedByBatch = new Map<string, number>();
  for (const r of batchReservations) {
    if (r.source_type !== 'allocation') continue;
    const remaining = Math.max(0, num(r.reserved_qty) - num(r.fulfilled_qty) - num(r.released_qty));
    allocatedByBatch.set(r.batch_id, (allocatedByBatch.get(r.batch_id) ?? 0) + toPieces(remaining));
  }

  return batches.map((b: any) =>
    computeBatchAvailabilityFromInputs(b, unitType, piecesPerBox, allocatedByBatch.get(b.id) ?? 0),
  );
}
