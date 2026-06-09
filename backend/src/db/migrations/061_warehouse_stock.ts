import type { Knex } from 'knex';

/** P3-07 — Per-warehouse stock cache + backfill from aggregate stock to default godown. */
export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasTable('warehouse_stock');
  if (!has) {
    await knex.schema.createTable('warehouse_stock', (t) => {
      t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
      t.uuid('warehouse_id').notNullable().references('id').inTable('warehouses').onDelete('CASCADE');
      t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('CASCADE');
      t.decimal('box_qty', 14, 4).notNullable().defaultTo(0);
      t.decimal('piece_qty', 14, 4).notNullable().defaultTo(0);
      t.decimal('sft_qty', 14, 4).notNullable().defaultTo(0);
      t.decimal('total_pieces', 14, 4).notNullable().defaultTo(0);
      t.timestamps(true, true);
      t.primary(['dealer_id', 'warehouse_id', 'product_id']);
      t.index(['dealer_id', 'warehouse_id'], 'idx_wh_stock_dealer_wh');
    });
  }

  // Ensure each dealer has a default warehouse
  await knex.raw(`
    INSERT INTO public.warehouses (dealer_id, name, code, is_default, is_active)
    SELECT d.id, 'Main Godown', 'MAIN', true, true
    FROM public.dealers d
    WHERE NOT EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.dealer_id = d.id AND w.is_default = true AND w.is_active = true
    );
  `);

  // Backfill warehouse_stock from aggregate stock → default warehouse
  await knex.raw(`
    INSERT INTO public.warehouse_stock (
      dealer_id, warehouse_id, product_id, box_qty, piece_qty, sft_qty, total_pieces, created_at, updated_at
    )
    SELECT
      s.dealer_id,
      w.id,
      s.product_id,
      COALESCE(s.box_qty, 0),
      COALESCE(s.piece_qty, 0),
      COALESCE(s.sft_qty, 0),
      COALESCE(s.total_pieces, 0),
      now(),
      now()
    FROM public.stock s
    JOIN public.warehouses w
      ON w.dealer_id = s.dealer_id AND w.is_default = true AND w.is_active = true
    ON CONFLICT (dealer_id, warehouse_id, product_id) DO UPDATE SET
      box_qty = EXCLUDED.box_qty,
      piece_qty = EXCLUDED.piece_qty,
      sft_qty = EXCLUDED.sft_qty,
      total_pieces = EXCLUDED.total_pieces,
      updated_at = now();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('warehouse_stock');
}
