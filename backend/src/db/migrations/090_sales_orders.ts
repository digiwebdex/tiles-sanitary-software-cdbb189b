import type { Knex } from 'knex';

/**
 * V2 Sprint 4B — Sales Order & Reservation Integration.
 *
 * Purely ADDITIVE: 2 new tables, 1 new function, 1 new column on the shared
 * `invoice_sequences` table (mirroring the exact pattern migration 008 used
 * to add `next_quotation_no`), and 3 new nullable columns on `quotations`
 * for the conversion audit trail. No existing table/column is
 * renamed/retyped/dropped; the existing Quotation→Sale flow
 * (`quotations.converted_sale_id`/`converted_by`/`converted_at`,
 * `link_quotation_to_sale`) is completely untouched — Sales Order
 * conversion uses its own, separate audit columns so both paths can coexist
 * without ambiguity.
 *
 * Why a new table instead of reusing `sales`: `sales` is the existing
 * Invoice-equivalent — `POST /api/sales` deducts stock immediately (FIFO
 * batch allocation) and posts VAT/ledger entries atomically. A "Sales
 * Order" is an earlier, non-monetary commitment stage that should only
 * *reserve* stock (via the existing Sprint 3C reservation RPCs), never
 * deduct it — reusing `sales` would risk entangling this sprint with
 * Invoice/VAT/Accounting posting, all explicitly out of scope.
 */
export async function up(knex: Knex): Promise<void> {
  // ── Sales Order numbering — same concurrency-safe pattern as
  //    generate_next_quotation_no (migration 008) ──
  const hasSoCol = await knex.schema.hasColumn('invoice_sequences', 'next_sales_order_no');
  if (!hasSoCol) {
    await knex.schema.alterTable('invoice_sequences', (t) => {
      t.integer('next_sales_order_no').notNullable().defaultTo(1);
    });
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION generate_next_sales_order_no(_dealer_id uuid)
    RETURNS text LANGUAGE plpgsql AS $$
    DECLARE _next integer;
    BEGIN
      INSERT INTO invoice_sequences (dealer_id, next_sales_order_no)
      VALUES (_dealer_id, 1)
      ON CONFLICT (dealer_id) DO NOTHING;

      PERFORM 1 FROM invoice_sequences
        WHERE dealer_id = _dealer_id FOR UPDATE;

      UPDATE invoice_sequences
        SET next_sales_order_no = next_sales_order_no + 1
        WHERE dealer_id = _dealer_id
        RETURNING next_sales_order_no - 1 INTO _next;

      RETURN 'SO-' || lpad(_next::text, 5, '0');
    END;
    $$;
  `);

  await knex.schema.createTable('sales_orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('so_number', 30);
    t.string('status', 20).notNullable().defaultTo('draft');
    t.uuid('customer_id').references('id').inTable('customers').onDelete('SET NULL');
    t.string('customer_name_text', 255);
    t.string('customer_phone_text', 50);
    t.text('customer_address_text');
    t.uuid('quotation_id').references('id').inTable('quotations').onDelete('SET NULL');
    t.uuid('project_id').references('id').inTable('projects').onDelete('SET NULL');
    t.uuid('site_id').references('id').inTable('project_sites').onDelete('SET NULL');
    // Soft reference (no FK) — matches the existing created_by/confirmed_by
    // convention used elsewhere (e.g. reservations, quotations) rather than
    // hard-coupling to profiles/users.
    t.uuid('salesperson_id');
    t.date('order_date').notNullable().defaultTo(knex.fn.now());
    t.decimal('subtotal', 14, 2).notNullable().defaultTo(0);
    t.string('discount_type', 10).notNullable().defaultTo('flat');
    t.decimal('discount_value', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
    t.date('planned_delivery_date');
    t.string('delivery_readiness', 20).notNullable().defaultTo('pending');
    t.text('notes');
    t.text('terms_text');
    t.uuid('confirmed_by');
    t.timestamp('confirmed_at', { useTz: true });
    t.uuid('cancelled_by');
    t.timestamp('cancelled_at', { useTz: true });
    t.text('cancel_reason');
    t.uuid('created_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('dealer_id');
    t.index(['dealer_id', 'status']);
    t.index('customer_id');
    t.index('quotation_id');
  });

  await knex.raw(`
    ALTER TABLE public.sales_orders
      ADD CONSTRAINT chk_sales_orders_status
      CHECK (status IN ('draft', 'confirmed', 'partially_delivered', 'completed', 'cancelled')),
      ADD CONSTRAINT chk_sales_orders_discount_type
      CHECK (discount_type IN ('flat', 'percent')),
      ADD CONSTRAINT chk_sales_orders_delivery_readiness
      CHECK (delivery_readiness IN ('pending', 'ready', 'partially_ready'))
  `);

  await knex.schema.createTable('sales_order_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('sales_order_id').notNullable().references('id').inTable('sales_orders').onDelete('CASCADE');
    t.uuid('product_id').references('id').inTable('products').onDelete('SET NULL');
    t.string('product_name_snapshot', 200);
    t.string('product_sku_snapshot', 100);
    t.string('unit_type', 20);
    t.decimal('per_box_sft', 10, 4);
    t.decimal('quantity', 14, 3).notNullable().defaultTo(0);
    t.decimal('rate', 14, 2).notNullable().defaultTo(0);
    t.decimal('discount_value', 14, 2).notNullable().defaultTo(0);
    t.decimal('line_total', 14, 2).notNullable().defaultTo(0);
    t.string('rate_source', 20).notNullable().defaultTo('default');
    t.uuid('tier_id').references('id').inTable('price_tiers').onDelete('SET NULL');
    t.string('preferred_shade_code', 50);
    t.string('preferred_caliber', 30);
    t.string('preferred_batch_no', 50);
    // The reservation created for this line once the order is confirmed —
    // reused from Sprint 3C's stock_reservations, never duplicated.
    t.uuid('reservation_id').references('id').inTable('stock_reservations').onDelete('SET NULL');
    t.decimal('reserved_qty', 14, 3).notNullable().defaultTo(0);
    // Present for schema completeness (supports the 'partially_delivered'/
    // 'completed' status values) — NOT written to by this sprint's own
    // logic, since Challan/Delivery execution is explicitly out of scope.
    t.decimal('delivered_qty', 14, 3).notNullable().defaultTo(0);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('sales_order_id');
    t.index('dealer_id');
    t.index('product_id');
  });

  // ── Quotation → Sales Order conversion audit trail (separate from the
  //    existing Quotation → Sale columns, so both paths coexist cleanly) ──
  await knex.schema.alterTable('quotations', (t) => {
    t.uuid('converted_sales_order_id').references('id').inTable('sales_orders').onDelete('SET NULL');
    t.uuid('converted_to_so_by');
    t.timestamp('converted_to_so_at', { useTz: true });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('quotations', (t) => {
    t.dropColumn('converted_sales_order_id');
    t.dropColumn('converted_to_so_by');
    t.dropColumn('converted_to_so_at');
  });
  await knex.schema.dropTableIfExists('sales_order_items');
  await knex.raw('ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS chk_sales_orders_status');
  await knex.raw('ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS chk_sales_orders_discount_type');
  await knex.raw('ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS chk_sales_orders_delivery_readiness');
  await knex.schema.dropTableIfExists('sales_orders');
  await knex.raw('DROP FUNCTION IF EXISTS generate_next_sales_order_no(uuid)');
  await knex.schema.alterTable('invoice_sequences', (t) => {
    t.dropColumn('next_sales_order_no');
  });
}
