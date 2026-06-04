/**
 * computeLineCogs — dimensionally-correct COGS for one sale line.
 *
 * Track 1 Phase 1A fix. Replaces the latent bug at the original sales.ts:512
 * (POST) and :975 (PUT), where `totalCogs += effectiveQty * avgCost` was
 * applied uniformly even though:
 *
 *   - For `unit_type = 'box_sft'` (tiles):
 *       effectiveQty is in BOXES (per routes/sales.ts:470-471).
 *       avgCost     is in ৳ per SFT (per routes/purchases.ts:593-597).
 *       boxes × (৳/sft) is dimensionally meaningless and silently
 *       understated stored COGS by exactly `per_box_sft` (typically 10-20x).
 *
 *   - For `unit_type = 'piece'` (sanitary etc):
 *       effectiveQty is in PIECES.
 *       avgCost     is in ৳ per PIECE (purchases.ts:596).
 *       The formula was already dimensionally correct.
 *
 * This helper is pure (no DB, no React, no globals) so unit tests in
 * src/test/salesCogs.test.ts can lock the math without spinning up
 * Postgres. The pure module also lets a static-source lint test in
 * src/test/financialsNoSilentCatch.test.ts enforce that routes/sales.ts
 * actually calls this function instead of resurrecting the bare
 * `effectiveQty * avgCost` pattern.
 */

export type SaleUnitType = 'box_sft' | 'piece' | string;

export interface ComputeLineCogsInput {
  /** product.unit_type — 'box_sft' (tile) or 'piece' (sanitary). */
  unitType: SaleUnitType | undefined | null;
  /**
   * Quantity in the unit native to the sale line.
   * For tiles: decimal boxes (boxQty + pieceQty / pieces_per_box).
   * For pieces: integer pieces.
   * May be negative (return reversal scenarios).
   */
  effectiveQty: number;
  /**
   * product.per_box_sft — sft per box. Required and > 0 for tiles.
   * Ignored for piece-unit products.
   */
  perBoxSft: number | null | undefined;
  /**
   * stock.average_cost_per_unit.
   *   - Tile (box_sft): ৳ per SFT.
   *   - Piece:           ৳ per piece.
   * May be 0 for products with no purchase history.
   */
  avgCost: number | null | undefined;
}

export class InvalidProductPerBoxSftError extends Error {
  readonly code = 'INVALID_PRODUCT_PER_BOX_SFT';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProductPerBoxSftError';
  }
}

function num(v: number | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute a single sale-line COGS in ৳.
 *
 * Tile (box_sft):
 *   lineCogs = effectiveQty (boxes) × perBoxSft (sft/box) × avgCost (৳/sft)
 *            = ৳
 *
 * Piece:
 *   lineCogs = effectiveQty (pieces) × avgCost (৳/piece)
 *            = ৳
 *
 * Throws InvalidProductPerBoxSftError when unitType='box_sft' AND
 * perBoxSft is missing or non-positive. This converts a silent
 * data-integrity failure ("zero revenue and zero cost") into a loud
 * one ("4xx, fix the product master first").
 */
export function computeLineCogs(input: ComputeLineCogsInput): number {
  const qty = num(input.effectiveQty);
  const cost = num(input.avgCost);

  if (input.unitType === 'box_sft') {
    const perBoxSft = num(input.perBoxSft);
    if (!(perBoxSft > 0)) {
      throw new InvalidProductPerBoxSftError(
        'Tile (box_sft) product is missing a positive per_box_sft. ' +
          'Fix the product master before recording or updating this sale.',
      );
    }
    return qty * perBoxSft * cost;
  }

  // piece (default) — also catches legacy / unknown unit types so the
  // historical pre-fix path stays bit-for-bit identical for piece-like
  // products and any other unit_type the schema doesn't yet enumerate.
  return qty * cost;
}
