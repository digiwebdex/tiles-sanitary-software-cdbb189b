import type { Knex } from 'knex';

/**
 * V2 Sprint 5C — Goods Receipt (GRN).
 *
 * Purely ADDITIVE: 2 new tables (`goods_receipts`, `goods_receipt_items`)
 * plus 1 new sequence column + function on the shared `invoice_sequences`
 * table (mirroring the exact pattern migrations 090/093/094 used). No
 * existing table/column from any frozen sprint is altered — not even
 * `purchase_orders`/`purchase_order_items` (Sprint 5B): Received/Pending
 * quantity per PO line is computed live by aggregating completed
 * `goods_receipt_items` rows joined to `purchase_order_item_id`, rather
 * than adding a stored counter column that could drift out of sync. PO
 * status transitions to `partially_received`/`fully_received` are plain
 * `UPDATE`s using status values Sprint 5B's own migration 094 already
 * allows — no schema change needed there either.
 *
 * Why GRN is a new entity distinct from `purchases`: `purchases` already
 * combines goods-receipt-quantity effects with financial/invoice effects
 * (supplier_ledger, VAT, cash/bank) in one atomic write — but Purchase
 * Invoice, Supplier Payment, Landed Cost, and Accounting Posting are all
 * explicitly out of this sprint's scope. GRN only ever touches quantity
 * (stock/warehouse_stock/godown_stock/rack_stock/product_batches/
 * stock_ledger) — it never writes to supplier_ledger, cash_ledger,
 * bank_ledger, or any posting table.
 */
export async function up(knex: Knex): Promise<void> {
  // ── GRN numbering — same concurrency-safe pattern as
  //    generate_next_purchase_order_no (migration 094) ──
  const hasGrnCol = await knex.schema.hasColumn('invoice_sequences', 'next_grn_no');
  if (!hasGrnCol) {
    await knex.schema.alterTable('invoice_sequences', (t) => {
      t.integer('next_grn_no').notNullable().defaultTo(1);
    });
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION generate_next_grn_no(_dealer_id uuid)
    RETURNS text LANGUAGE plpgsql AS $$
    DECLARE _next integer;
    BEGIN
      INSERT INTO invoice_sequences (dealer_id, next_grn_no)
      VALUES (_dealer_id, 1)
      ON CONFLICT (dealer_id) DO NOTHING;

      PERFORM 1 FROM invoice_sequences
        WHERE dealer_id = _dealer_id FOR UPDATE;

      UPDATE invoice_sequences
        SET next_grn_no = next_grn_no + 1
        WHERE dealer_id = _dealer_id
        RETURNING next_grn_no - 1 INTO _next;

      RETURN 'GRN-' || lpad(_next::text, 5, '0');
    END;
    $$;
  `);

  await knex.schema.createTable('goods_receipts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('grn_number', 30);
    t.string('status', 20).notNullable().defaultTo('draft');
    t.uuid('purchase_order_id').notNullable().references('id').inTable('purchase_orders').onDelete('RESTRICT');
    t.date('receive_date').notNullable().defaultTo(knex.fn.now());
    t.text('notes');
    t.uuid('created_by');
    t.uuid('completed_by');
    t.timestamp('completed_at', { useTz: true });
    t.uuid('cancelled_by');
    t.timestamp('cancelled_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('dealer_id');
    t.index(['dealer_id', 'status']);
    t.index('purchase_order_id');
  });

  await knex.raw(`
    ALTER TABLE public.goods_receipts
      ADD CONSTRAINT chk_goods_receipts_status
      CHECK (status IN ('draft', 'completed', 'cancelled'))
  `);

  await knex.schema.createTable('goods_receipt_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('goods_receipt_id').notNullable().references('id').inTable('goods_receipts').onDelete('CASCADE');
    t.uuid('purchase_order_item_id').notNullable().references('id').inTable('purchase_order_items').onDelete('RESTRICT');
    t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('RESTRICT');
    t.decimal('received_qty', 14, 3).notNullable().defaultTo(0);
    // Batch/Lot fields — reuses the exact product_batches identity columns
    // (batch_no, lot_no, shade_code, caliber) via the same null-safe
    // find-or-create matching purchases.ts already uses; manufacturing_date
    // is new (product_batches has no such column) and is stored here at the
    // per-receipt-event level, since a single batch identity can legitimately
    // be topped up across multiple GRNs with different manufacturing dates.
    t.string('batch_no', 50);
    t.string('lot_no', 50);
    t.string('shade_code', 30);
    t.string('caliber', 30);
    t.date('manufacturing_date');
    // Warehouse Receiving — reuses the exact Sprint 3B hierarchy.
    // bin_id is a location tag only (bins are not stock-tracked — see
    // migration 086's own comment); warehouse/godown/rack drive real
    // warehouse_stock/godown_stock/rack_stock updates.
    t.uuid('warehouse_id').references('id').inTable('warehouses').onDelete('RESTRICT');
    t.uuid('godown_id').references('id').inTable('godowns').onDelete('SET NULL');
    t.uuid('rack_id').references('id').inTable('racks').onDelete('SET NULL');
    t.uuid('bin_id').references('id').inTable('bins').onDelete('SET NULL');
    t.text('notes');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('goods_receipt_id');
    t.index('dealer_id');
    t.index('purchase_order_item_id');
    t.index('product_id');
  });

  // Additive extension of Sprint 5B's purchase_order_approvals history
  // action list — GRN completion records a 'received' event so a PO's full
  // timeline (submit/approve/reject/send/receive/cancel/close) is visible
  // in one place. Same "drop + re-add with a wider IN list" pattern used
  // for CHECK constraints throughout this codebase; every existing row's
  // action value is untouched.
  await knex.raw(`
    ALTER TABLE public.purchase_order_approvals
      DROP CONSTRAINT IF EXISTS chk_purchase_order_approvals_action
  `);
  await knex.raw(`
    ALTER TABLE public.purchase_order_approvals
      ADD CONSTRAINT chk_purchase_order_approvals_action
      CHECK (action IN ('submitted', 'approved', 'rejected', 'sent', 'received', 'cancelled', 'closed'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.purchase_order_approvals
      DROP CONSTRAINT IF EXISTS chk_purchase_order_approvals_action
  `);
  await knex.raw(`
    ALTER TABLE public.purchase_order_approvals
      ADD CONSTRAINT chk_purchase_order_approvals_action
      CHECK (action IN ('submitted', 'approved', 'rejected', 'sent', 'cancelled', 'closed'))
  `);

  await knex.schema.dropTableIfExists('goods_receipt_items');
  await knex.raw('ALTER TABLE public.goods_receipts DROP CONSTRAINT IF EXISTS chk_goods_receipts_status');
  await knex.schema.dropTableIfExists('goods_receipts');

  await knex.raw('DROP FUNCTION IF EXISTS generate_next_grn_no(uuid)');
  await knex.schema.alterTable('invoice_sequences', (t) => {
    t.dropColumn('next_grn_no');
  });
}
