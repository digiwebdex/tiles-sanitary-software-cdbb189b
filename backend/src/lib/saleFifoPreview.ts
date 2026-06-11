import type { Knex } from 'knex';

export type FifoPreviewItem = {
  productId: string;
  quantity: number;
  unitType: 'box_sft' | 'piece';
  deductQty: number;
};

export type FifoMixedBatchPreview = {
  hasMixedShade: boolean;
  hasMixedCaliber: boolean;
  mixedShades: string[];
  mixedCalibers: string[];
};

/**
 * Read-only FIFO plan for mixed shade/caliber approval context.
 * Mirrors sales.ts allocation + batchService.planFIFOAllocation.
 */
export async function previewMixedBatchFlags(
  db: Knex | Knex.Transaction,
  dealerId: string,
  customerId: string,
  items: FifoPreviewItem[],
): Promise<FifoMixedBatchPreview> {
  const shadeSet = new Set<string>();
  const caliberSet = new Set<string>();

  for (const item of items) {
    if (item.unitType !== 'box_sft' || item.deductQty <= 0) continue;

    const batches = await db('product_batches')
      .where({ dealer_id: dealerId, product_id: item.productId, status: 'active' })
      .orderBy('created_at', 'asc')
      .select(
        'id',
        'shade_code',
        'caliber',
        'box_qty',
        'piece_qty',
        'reserved_box_qty',
        'reserved_piece_qty',
      );

    if (batches.length === 0) continue;

    const customerRes = await db('stock_reservations')
      .where({
        product_id: item.productId,
        dealer_id: dealerId,
        customer_id: customerId,
        status: 'active',
      })
      .select('batch_id', 'reserved_qty', 'fulfilled_qty', 'released_qty');

    const customerBatchHold = new Map<string, number>();
    for (const r of customerRes) {
      if (!r.batch_id) continue;
      const remaining =
        Number(r.reserved_qty) - Number(r.fulfilled_qty) - Number(r.released_qty);
      customerBatchHold.set(r.batch_id, (customerBatchHold.get(r.batch_id) ?? 0) + remaining);
    }

    let remaining = item.deductQty;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const totalQty = Number(batch.box_qty);
      const reservedQty = Number(batch.reserved_box_qty ?? 0);
      const ownHold = customerBatchHold.get(batch.id) ?? 0;
      const freeQty = totalQty - reservedQty + ownHold;
      if (freeQty <= 0) continue;
      const allocateQty = Math.min(remaining, freeQty);
      if (batch.shade_code) shadeSet.add(String(batch.shade_code));
      if (batch.caliber) caliberSet.add(String(batch.caliber));
      remaining -= allocateQty;
    }
  }

  return {
    hasMixedShade: shadeSet.size > 1,
    hasMixedCaliber: caliberSet.size > 1,
    mixedShades: Array.from(shadeSet),
    mixedCalibers: Array.from(caliberSet),
  };
}
