import type { Knex } from 'knex';

/** P3-05 — Normalized stock movement audit trail mirrored from stock_ledger inserts. */
export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasTable('stock_movements');
  if (!has) {
    await knex.schema.createTable('stock_movements', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
      t.uuid('stock_ledger_id').nullable().references('id').inTable('stock_ledger').onDelete('SET NULL');
      t.uuid('posting_line_id').nullable();
      t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('RESTRICT');
      t.uuid('warehouse_id').nullable().references('id').inTable('warehouses').onDelete('SET NULL');
      t.uuid('batch_id').nullable().references('id').inTable('product_batches').onDelete('SET NULL');
      t.string('movement_type', 64).notNullable();
      t.decimal('qty_delta', 14, 4).notNullable();
      t.string('qty_unit', 16).notNullable().defaultTo('pieces');
      t.decimal('unit_cost', 14, 4).nullable();
      t.string('reference_type', 64).nullable();
      t.uuid('reference_id').nullable();
      t.string('reference_no', 64).nullable();
      t.timestamp('moved_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['dealer_id', 'product_id', 'moved_at'], 'idx_stock_movements_dealer_product');
      t.index(['dealer_id', 'reference_type', 'reference_id'], 'idx_stock_movements_reference');
    });
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.sync_stock_movement_from_ledger()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      _delta numeric;
      _unit text;
    BEGIN
      _delta := NEW.stock_after_pieces - NEW.stock_before_pieces;
      IF _delta = 0 THEN
        RETURN NEW;
      END IF;

      IF NEW.box_qty <> 0 AND NEW.piece_qty = 0 THEN
        _unit := 'box';
      ELSIF NEW.piece_qty <> 0 AND NEW.box_qty = 0 THEN
        _unit := 'piece';
      ELSE
        _unit := 'pieces';
      END IF;

      INSERT INTO public.stock_movements (
        dealer_id,
        stock_ledger_id,
        product_id,
        movement_type,
        qty_delta,
        qty_unit,
        reference_type,
        reference_id,
        reference_no,
        moved_at
      ) VALUES (
        NEW.dealer_id,
        NEW.id,
        NEW.product_id,
        NEW.txn_type,
        _delta,
        _unit,
        NEW.reference_table,
        NEW.reference_id,
        NEW.reference_no,
        NEW.created_at
      );

      RETURN NEW;
    END;
    $$;
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_stock_ledger_to_movements ON public.stock_ledger;
    CREATE TRIGGER trg_stock_ledger_to_movements
      AFTER INSERT ON public.stock_ledger
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_stock_movement_from_ledger();
  `);

  // Backfill from existing stock_ledger rows (idempotent via NOT EXISTS)
  await knex.raw(`
    INSERT INTO public.stock_movements (
      dealer_id, stock_ledger_id, product_id, movement_type, qty_delta, qty_unit,
      reference_type, reference_id, reference_no, moved_at
    )
    SELECT
      sl.dealer_id,
      sl.id,
      sl.product_id,
      sl.txn_type,
      sl.stock_after_pieces - sl.stock_before_pieces,
      CASE
        WHEN sl.box_qty <> 0 AND sl.piece_qty = 0 THEN 'box'
        WHEN sl.piece_qty <> 0 AND sl.box_qty = 0 THEN 'piece'
        ELSE 'pieces'
      END,
      sl.reference_table,
      sl.reference_id,
      sl.reference_no,
      sl.created_at
    FROM public.stock_ledger sl
    WHERE sl.stock_after_pieces <> sl.stock_before_pieces
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm WHERE sm.stock_ledger_id = sl.id
      );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS trg_stock_ledger_to_movements ON public.stock_ledger;');
  await knex.raw('DROP FUNCTION IF EXISTS public.sync_stock_movement_from_ledger();');
  await knex.schema.dropTableIfExists('stock_movements');
}
