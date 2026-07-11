import type { Knex } from 'knex';

/**
 * V2 Sprint 3B — Warehouse & Godown: real Godown/Rack/Bin hierarchy.
 *
 * Purely ADDITIVE. No existing table, column, or row is renamed, retyped,
 * or dropped. `warehouses` and `warehouse_stock` (Sprint P3-07) are untouched
 * as tables; `warehouse_transfers` and `stock_movements` only gain new
 * NULLABLE columns, so every existing warehouse-level transfer/movement row
 * and every existing route that reads/writes those tables keeps working
 * exactly as before (transfer_level defaults to 'warehouse', new location
 * columns default to NULL).
 *
 * Until Sprint 3B, "godown" was just a UI label for "warehouse" (see
 * migration 085's comment: "Godown → warehouse_stock (existing)"). This
 * migration introduces the actual Warehouse → Godown → Rack hierarchy that
 * was deferred at that time. `products.default_rack` (085) remains an
 * informational free-text suggestion — unrelated to the new `racks` table.
 *
 * Backfill strategy (mirrors migration 061's "create a default location so
 * nothing is ever orphaned" pattern): every existing warehouse gets exactly
 * one "Main Godown", every godown gets exactly one "Main Rack", and stock is
 * copied 1:1 down the new tiers from the existing `warehouse_stock` cache.
 * `bins` are NOT backfilled — they're an optional fine-grained label a
 * dealer adds later; no stock is tracked at bin granularity in this sprint.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('godowns', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('warehouse_id').notNullable().references('id').inTable('warehouses').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.string('code', 30);
    t.boolean('is_default').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['dealer_id', 'warehouse_id', 'code']);
    t.index(['dealer_id', 'warehouse_id']);
  });

  await knex.schema.createTable('racks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('godown_id').notNullable().references('id').inTable('godowns').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.string('code', 30);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['dealer_id', 'godown_id', 'code']);
    t.index(['dealer_id', 'godown_id']);
  });

  await knex.schema.createTable('bins', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('rack_id').notNullable().references('id').inTable('racks').onDelete('CASCADE');
    t.string('bin_code', 30).notNullable();
    t.string('storage_location', 120);
    t.string('rack_position', 30);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['dealer_id', 'rack_id', 'bin_code']);
    t.index(['dealer_id', 'rack_id']);
  });

  await knex.schema.createTable('godown_stock', (t) => {
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('godown_id').notNullable().references('id').inTable('godowns').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('CASCADE');
    t.decimal('box_qty', 14, 4).notNullable().defaultTo(0);
    t.decimal('piece_qty', 14, 4).notNullable().defaultTo(0);
    t.decimal('sft_qty', 14, 4).notNullable().defaultTo(0);
    t.decimal('total_pieces', 14, 4).notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.primary(['dealer_id', 'godown_id', 'product_id']);
    t.index(['dealer_id', 'godown_id'], 'idx_godown_stock_dealer_godown');
  });

  await knex.schema.createTable('rack_stock', (t) => {
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('rack_id').notNullable().references('id').inTable('racks').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('CASCADE');
    t.decimal('box_qty', 14, 4).notNullable().defaultTo(0);
    t.decimal('piece_qty', 14, 4).notNullable().defaultTo(0);
    t.decimal('sft_qty', 14, 4).notNullable().defaultTo(0);
    t.decimal('total_pieces', 14, 4).notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.primary(['dealer_id', 'rack_id', 'product_id']);
    t.index(['dealer_id', 'rack_id'], 'idx_rack_stock_dealer_rack');
  });

  // Extend warehouse_transfers so the SAME table/routes/UI serve
  // warehouse-, godown-, and rack-level transfers (transfer_level picks the
  // tier; existing rows are unaffected — they default to 'warehouse' with
  // the new location columns left NULL).
  await knex.schema.alterTable('warehouse_transfers', (t) => {
    t.string('transfer_level', 20).notNullable().defaultTo('warehouse');
    t.uuid('from_godown_id').references('id').inTable('godowns').onDelete('SET NULL');
    t.uuid('to_godown_id').references('id').inTable('godowns').onDelete('SET NULL');
    t.uuid('from_rack_id').references('id').inTable('racks').onDelete('SET NULL');
    t.uuid('to_rack_id').references('id').inTable('racks').onDelete('SET NULL');
  });

  // Extend the existing movement audit trail with the same optional
  // location columns already present for warehouse_id (migration 060).
  await knex.schema.alterTable('stock_movements', (t) => {
    t.uuid('godown_id').references('id').inTable('godowns').onDelete('SET NULL');
    t.uuid('rack_id').references('id').inTable('racks').onDelete('SET NULL');
  });

  // ── Backfill: one Main Godown per warehouse, one Main Rack per godown ──
  await knex.raw(`
    INSERT INTO public.godowns (dealer_id, warehouse_id, name, code, is_default, is_active)
    SELECT w.dealer_id, w.id, 'Main Godown', 'MAIN', true, true
    FROM public.warehouses w
    WHERE NOT EXISTS (
      SELECT 1 FROM public.godowns g WHERE g.warehouse_id = w.id AND g.is_default = true
    );
  `);

  await knex.raw(`
    INSERT INTO public.racks (dealer_id, godown_id, name, code, is_active)
    SELECT g.dealer_id, g.id, 'Main Rack', 'MAIN', true
    FROM public.godowns g
    WHERE NOT EXISTS (
      SELECT 1 FROM public.racks r WHERE r.godown_id = g.id
    );
  `);

  // ── Backfill: copy warehouse_stock → godown_stock → rack_stock (1:1 today) ──
  await knex.raw(`
    INSERT INTO public.godown_stock (
      dealer_id, godown_id, product_id, box_qty, piece_qty, sft_qty, total_pieces, created_at, updated_at
    )
    SELECT ws.dealer_id, g.id, ws.product_id, ws.box_qty, ws.piece_qty, ws.sft_qty, ws.total_pieces, now(), now()
    FROM public.warehouse_stock ws
    JOIN public.godowns g ON g.warehouse_id = ws.warehouse_id AND g.is_default = true
    ON CONFLICT (dealer_id, godown_id, product_id) DO UPDATE SET
      box_qty = EXCLUDED.box_qty, piece_qty = EXCLUDED.piece_qty, sft_qty = EXCLUDED.sft_qty,
      total_pieces = EXCLUDED.total_pieces, updated_at = now();
  `);

  await knex.raw(`
    INSERT INTO public.rack_stock (
      dealer_id, rack_id, product_id, box_qty, piece_qty, sft_qty, total_pieces, created_at, updated_at
    )
    SELECT gs.dealer_id, r.id, gs.product_id, gs.box_qty, gs.piece_qty, gs.sft_qty, gs.total_pieces, now(), now()
    FROM public.godown_stock gs
    JOIN public.racks r ON r.godown_id = gs.godown_id
    ON CONFLICT (dealer_id, rack_id, product_id) DO UPDATE SET
      box_qty = EXCLUDED.box_qty, piece_qty = EXCLUDED.piece_qty, sft_qty = EXCLUDED.sft_qty,
      total_pieces = EXCLUDED.total_pieces, updated_at = now();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('rack_stock');
  await knex.schema.dropTableIfExists('godown_stock');
  await knex.schema.alterTable('stock_movements', (t) => {
    t.dropColumn('godown_id');
    t.dropColumn('rack_id');
  });
  await knex.schema.alterTable('warehouse_transfers', (t) => {
    t.dropColumn('transfer_level');
    t.dropColumn('from_godown_id');
    t.dropColumn('to_godown_id');
    t.dropColumn('from_rack_id');
    t.dropColumn('to_rack_id');
  });
  await knex.schema.dropTableIfExists('bins');
  await knex.schema.dropTableIfExists('racks');
  await knex.schema.dropTableIfExists('godowns');
}
