import type { Knex } from 'knex';

/**
 * V2 Sprint 5A — Supplier & Purchase Foundation.
 *
 * Purely ADDITIVE: 3 new columns on `suppliers` (mirroring the exact
 * category/group/credit_limit fields Sprint 4A added to `customers` in
 * migration 089), 2 new numbering columns on the shared `invoice_sequences`
 * table plus 2 new sequence functions (mirroring the exact pattern migration
 * 090 used for `generate_next_sales_order_no`), and 6 new tables:
 *
 *   purchase_requests / purchase_request_items  — internal PR workflow
 *   rfqs / rfq_items / rfq_suppliers / rfq_responses — RFQ workflow
 *
 * No existing table/column is renamed, retyped, or dropped. `purchases`,
 * `purchase_items`, `suppliers`' existing columns, and the (separately
 * broken, pre-existing) `purchase_drafts`/`purchase_draft_items` tables used
 * by autoPo.ts are untouched — this sprint deliberately avoids that table
 * name collision by using `purchase_requests` (distinct name/shape).
 *
 * PR and RFQ do NOT create a `purchases` row themselves — Purchase Order
 * creation from an approved PR/RFQ is explicitly out of this sprint's scope
 * (per instruction); `purchase_requests.status`/`rfq_items.selected_supplier_id`
 * simply record the approved outcome for a future sprint to act on.
 */
export async function up(knex: Knex): Promise<void> {
  // ── Suppliers: category/group/credit_limit (mirrors migration 089's
  //    customer_group/default_discount_type additions) ──
  await knex.schema.alterTable('suppliers', (t) => {
    t.string('category', 100);
    t.string('supplier_group', 100);
    t.decimal('credit_limit', 14, 2).notNullable().defaultTo(0);
  });

  // ── PR / RFQ numbering — same concurrency-safe pattern as
  //    generate_next_sales_order_no (migration 090) ──
  const hasPrCol = await knex.schema.hasColumn('invoice_sequences', 'next_purchase_request_no');
  const hasRfqCol = await knex.schema.hasColumn('invoice_sequences', 'next_rfq_no');
  await knex.schema.alterTable('invoice_sequences', (t) => {
    if (!hasPrCol) t.integer('next_purchase_request_no').notNullable().defaultTo(1);
    if (!hasRfqCol) t.integer('next_rfq_no').notNullable().defaultTo(1);
  });

  await knex.raw(`
    CREATE OR REPLACE FUNCTION generate_next_purchase_request_no(_dealer_id uuid)
    RETURNS text LANGUAGE plpgsql AS $$
    DECLARE _next integer;
    BEGIN
      INSERT INTO invoice_sequences (dealer_id, next_purchase_request_no)
      VALUES (_dealer_id, 1)
      ON CONFLICT (dealer_id) DO NOTHING;

      PERFORM 1 FROM invoice_sequences
        WHERE dealer_id = _dealer_id FOR UPDATE;

      UPDATE invoice_sequences
        SET next_purchase_request_no = next_purchase_request_no + 1
        WHERE dealer_id = _dealer_id
        RETURNING next_purchase_request_no - 1 INTO _next;

      RETURN 'PR-' || lpad(_next::text, 5, '0');
    END;
    $$;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION generate_next_rfq_no(_dealer_id uuid)
    RETURNS text LANGUAGE plpgsql AS $$
    DECLARE _next integer;
    BEGIN
      INSERT INTO invoice_sequences (dealer_id, next_rfq_no)
      VALUES (_dealer_id, 1)
      ON CONFLICT (dealer_id) DO NOTHING;

      PERFORM 1 FROM invoice_sequences
        WHERE dealer_id = _dealer_id FOR UPDATE;

      UPDATE invoice_sequences
        SET next_rfq_no = next_rfq_no + 1
        WHERE dealer_id = _dealer_id
        RETURNING next_rfq_no - 1 INTO _next;

      RETURN 'RFQ-' || lpad(_next::text, 5, '0');
    END;
    $$;
  `);

  // ── Purchase Request ──
  await knex.schema.createTable('purchase_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('pr_number', 30);
    t.string('status', 20).notNullable().defaultTo('draft');
    t.string('department', 100);
    // Soft references (no FK) — matches the existing created_by/confirmed_by
    // convention used elsewhere (sales_orders, quotations, reservations)
    // rather than hard-coupling to a users/profiles table.
    t.uuid('requested_by');
    t.uuid('approved_by');
    t.timestamp('approved_at', { useTz: true });
    t.uuid('rejected_by');
    t.timestamp('rejected_at', { useTz: true });
    t.text('rejection_reason');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('dealer_id');
    t.index(['dealer_id', 'status']);
  });

  await knex.raw(`
    ALTER TABLE public.purchase_requests
      ADD CONSTRAINT chk_purchase_requests_status
      CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled'))
  `);

  await knex.schema.createTable('purchase_request_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('purchase_request_id').notNullable().references('id').inTable('purchase_requests').onDelete('CASCADE');
    t.uuid('product_id').references('id').inTable('products').onDelete('SET NULL');
    t.string('product_name_snapshot', 200);
    t.decimal('requested_qty', 14, 3).notNullable().defaultTo(0);
    // Tags a line prefilled from the existing Purchase Planning / Demand
    // Planning reorder suggestions vs. one a requester typed in manually —
    // informational only, no behavior branches on it.
    t.string('source', 20).notNullable().defaultTo('manual');
    t.text('notes');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('purchase_request_id');
    t.index('dealer_id');
  });

  await knex.raw(`
    ALTER TABLE public.purchase_request_items
      ADD CONSTRAINT chk_purchase_request_items_source
      CHECK (source IN ('manual', 'reorder_suggestion'))
  `);

  // ── RFQ ──
  await knex.schema.createTable('rfqs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('rfq_number', 30);
    t.string('status', 20).notNullable().defaultTo('draft');
    t.uuid('purchase_request_id').references('id').inTable('purchase_requests').onDelete('SET NULL');
    t.text('notes');
    t.uuid('created_by');
    t.timestamp('sent_at', { useTz: true });
    t.uuid('approved_by');
    t.timestamp('approved_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('dealer_id');
    t.index(['dealer_id', 'status']);
    t.index('purchase_request_id');
  });

  await knex.raw(`
    ALTER TABLE public.rfqs
      ADD CONSTRAINT chk_rfqs_status
      CHECK (status IN ('draft', 'sent', 'comparing', 'approved', 'cancelled'))
  `);

  await knex.schema.createTable('rfq_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('rfq_id').notNullable().references('id').inTable('rfqs').onDelete('CASCADE');
    t.uuid('product_id').references('id').inTable('products').onDelete('SET NULL');
    t.string('product_name_snapshot', 200);
    t.decimal('qty', 14, 3).notNullable().defaultTo(0);
    // RFQ Approval outcome: which supplier's quote was selected for this
    // line. Nullable until approved; deliberately does NOT create a
    // `purchases` row (Purchase Order creation is out of this sprint's scope).
    t.uuid('selected_supplier_id').references('id').inTable('suppliers').onDelete('SET NULL');
    t.text('notes');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('rfq_id');
    t.index('dealer_id');
  });

  await knex.schema.createTable('rfq_suppliers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('rfq_id').notNullable().references('id').inTable('rfqs').onDelete('CASCADE');
    t.uuid('supplier_id').notNullable().references('id').inTable('suppliers').onDelete('CASCADE');
    t.string('status', 20).notNullable().defaultTo('invited');
    t.timestamp('sent_at', { useTz: true });
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('rfq_id');
    t.index('dealer_id');
    t.unique(['rfq_id', 'supplier_id']);
  });

  await knex.raw(`
    ALTER TABLE public.rfq_suppliers
      ADD CONSTRAINT chk_rfq_suppliers_status
      CHECK (status IN ('invited', 'responded', 'declined'))
  `);

  // Suppliers have no login/portal in this system today — RFQ responses are
  // captured by dealer staff (phone/WhatsApp/email happens outside the
  // system), not submitted by suppliers directly.
  await knex.schema.createTable('rfq_responses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('rfq_id').notNullable().references('id').inTable('rfqs').onDelete('CASCADE');
    t.uuid('rfq_item_id').notNullable().references('id').inTable('rfq_items').onDelete('CASCADE');
    t.uuid('supplier_id').notNullable().references('id').inTable('suppliers').onDelete('CASCADE');
    t.decimal('quoted_rate', 14, 2).notNullable();
    t.integer('quoted_lead_time_days');
    t.text('notes');
    t.uuid('recorded_by');
    t.timestamp('responded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('rfq_id');
    t.index('dealer_id');
    t.unique(['rfq_item_id', 'supplier_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('rfq_responses');
  await knex.schema.dropTableIfExists('rfq_suppliers');
  await knex.schema.dropTableIfExists('rfq_items');
  await knex.raw('ALTER TABLE public.rfqs DROP CONSTRAINT IF EXISTS chk_rfqs_status');
  await knex.schema.dropTableIfExists('rfqs');

  await knex.raw('ALTER TABLE public.purchase_request_items DROP CONSTRAINT IF EXISTS chk_purchase_request_items_source');
  await knex.schema.dropTableIfExists('purchase_request_items');
  await knex.raw('ALTER TABLE public.purchase_requests DROP CONSTRAINT IF EXISTS chk_purchase_requests_status');
  await knex.schema.dropTableIfExists('purchase_requests');

  await knex.raw('DROP FUNCTION IF EXISTS generate_next_rfq_no(uuid)');
  await knex.raw('DROP FUNCTION IF EXISTS generate_next_purchase_request_no(uuid)');
  await knex.schema.alterTable('invoice_sequences', (t) => {
    t.dropColumn('next_rfq_no');
    t.dropColumn('next_purchase_request_no');
  });

  await knex.schema.alterTable('suppliers', (t) => {
    t.dropColumn('credit_limit');
    t.dropColumn('supplier_group');
    t.dropColumn('category');
  });
}
