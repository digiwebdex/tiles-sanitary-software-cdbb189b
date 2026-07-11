import type { Knex } from 'knex';

/**
 * V2 Sprint 5B — Purchase Order.
 *
 * Purely ADDITIVE: 2 new tables (`purchase_orders`, `purchase_order_items`)
 * plus a history table (`purchase_order_approvals`), 1 new sequence column
 * + function on the shared `invoice_sequences` table (mirroring the exact
 * pattern migration 090 used for `generate_next_sales_order_no`), and one
 * new value appended to the existing `whatsapp_message_type` enum.
 *
 * Why a new table instead of reusing `purchases`: `purchases` is the
 * existing GRN+Invoice-equivalent — `POST /api/purchases` deducts/adds
 * stock immediately (batch top-up, average-cost recompute) and posts
 * ledger entries atomically. A "Purchase Order" is an earlier, pre-receipt
 * commitment to a supplier that must NOT touch stock or ledgers — reusing
 * `purchases` would entangle this sprint with Goods Receipt/Batch
 * Receiving/Accounting Posting, all explicitly out of scope. This mirrors
 * exactly how `sales_orders` (migration 090) was kept separate from `sales`.
 *
 * Status model: the 8 statuses from the sprint brief (draft,
 * pending_approval, approved, sent, partially_received, fully_received,
 * cancelled, closed) do NOT include a distinct "rejected" status, even
 * though "Reject Purchase Order" is a required action. Modeled as: reject
 * sends a pending_approval PO back to 'draft' for revision (recorded in
 * `purchase_order_approvals` with action='rejected' + the reviewer's note)
 * — no 9th status introduced. `partially_received`/`fully_received` exist
 * in the CHECK constraint for schema completeness (same precedent as
 * `sales_orders.delivery_readiness` in migration 090) but are set via a
 * manual/administrative action only in this sprint — Goods Receipt/Batch
 * Receiving remain unbuilt, so nothing here writes to `stock`/`product_batches`.
 */
export async function up(knex: Knex): Promise<void> {
  // ── PO numbering — same concurrency-safe pattern as
  //    generate_next_sales_order_no (migration 090) ──
  const hasPoCol = await knex.schema.hasColumn('invoice_sequences', 'next_purchase_order_no');
  if (!hasPoCol) {
    await knex.schema.alterTable('invoice_sequences', (t) => {
      t.integer('next_purchase_order_no').notNullable().defaultTo(1);
    });
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION generate_next_purchase_order_no(_dealer_id uuid)
    RETURNS text LANGUAGE plpgsql AS $$
    DECLARE _next integer;
    BEGIN
      INSERT INTO invoice_sequences (dealer_id, next_purchase_order_no)
      VALUES (_dealer_id, 1)
      ON CONFLICT (dealer_id) DO NOTHING;

      PERFORM 1 FROM invoice_sequences
        WHERE dealer_id = _dealer_id FOR UPDATE;

      UPDATE invoice_sequences
        SET next_purchase_order_no = next_purchase_order_no + 1
        WHERE dealer_id = _dealer_id
        RETURNING next_purchase_order_no - 1 INTO _next;

      RETURN 'PO-' || lpad(_next::text, 5, '0');
    END;
    $$;
  `);

  // ── Purchase Order ──
  await knex.schema.createTable('purchase_orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('po_number', 30);
    t.string('status', 20).notNullable().defaultTo('draft');
    t.uuid('supplier_id').notNullable().references('id').inTable('suppliers').onDelete('RESTRICT');
    t.date('order_date').notNullable().defaultTo(knex.fn.now());
    t.date('expected_delivery_date');
    t.decimal('subtotal', 14, 2).notNullable().defaultTo(0);
    t.string('discount_type', 10).notNullable().defaultTo('flat');
    t.decimal('discount_value', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
    t.text('notes');
    t.text('terms_text');
    // RFQ integration audit trail (Sprint 5A tables — read-only references).
    t.uuid('source_rfq_id').references('id').inTable('rfqs').onDelete('SET NULL');
    t.uuid('source_purchase_request_id').references('id').inTable('purchase_requests').onDelete('SET NULL');
    // Clone audit trail (self-referential).
    t.uuid('cloned_from_id').references('id').inTable('purchase_orders').onDelete('SET NULL');
    t.uuid('submitted_by');
    t.timestamp('submitted_at', { useTz: true });
    t.uuid('approved_by');
    t.timestamp('approved_at', { useTz: true });
    t.uuid('sent_by');
    t.timestamp('sent_at', { useTz: true });
    t.uuid('cancelled_by');
    t.timestamp('cancelled_at', { useTz: true });
    t.text('cancel_reason');
    t.uuid('closed_by');
    t.timestamp('closed_at', { useTz: true });
    t.uuid('created_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('dealer_id');
    t.index(['dealer_id', 'status']);
    t.index('supplier_id');
    t.index('source_rfq_id');
  });

  await knex.raw(`
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT chk_purchase_orders_status
      CHECK (status IN ('draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'fully_received', 'cancelled', 'closed')),
      ADD CONSTRAINT chk_purchase_orders_discount_type
      CHECK (discount_type IN ('flat', 'percent'))
  `);

  await knex.schema.createTable('purchase_order_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('purchase_order_id').notNullable().references('id').inTable('purchase_orders').onDelete('CASCADE');
    t.uuid('product_id').references('id').inTable('products').onDelete('SET NULL');
    t.string('product_name_snapshot', 200);
    t.string('product_sku_snapshot', 100);
    t.string('unit_type', 20);
    t.decimal('per_box_sft', 10, 4);
    t.decimal('ordered_qty', 14, 3).notNullable().defaultTo(0);
    t.decimal('rate', 14, 2).notNullable().defaultTo(0);
    t.string('rate_unit', 20);
    t.decimal('line_total', 14, 2).notNullable().defaultTo(0);
    // RFQ integration — which invited-supplier quote this line came from.
    t.uuid('source_rfq_item_id').references('id').inTable('rfq_items').onDelete('SET NULL');
    t.text('notes');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('purchase_order_id');
    t.index('dealer_id');
    t.index('product_id');
  });

  // ── Approval History (Sprint 5B — distinct from Purchase Request's single
  //    approved_by/rejected_by columns in Sprint 5A: a PO can be submitted,
  //    rejected, revised, and resubmitted multiple times, so a proper
  //    append-only history table is needed rather than single columns) ──
  await knex.schema.createTable('purchase_order_approvals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('purchase_order_id').notNullable().references('id').inTable('purchase_orders').onDelete('CASCADE');
    t.string('action', 20).notNullable();
    t.uuid('actor_id');
    t.text('note');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('purchase_order_id');
    t.index('dealer_id');
  });

  await knex.raw(`
    ALTER TABLE public.purchase_order_approvals
      ADD CONSTRAINT chk_purchase_order_approvals_action
      CHECK (action IN ('submitted', 'approved', 'rejected', 'sent', 'cancelled', 'closed'))
  `);

  // ── WhatsApp Purchase Order sharing — additive enum value, same pattern
  //    already used for customer_type/app_role/payment_status_type
  //    (migrations 016, 075, 079, 089). Postgres requires ADD VALUE outside
  //    an explicit transaction; this migration only adds the value and never
  //    reads/writes a row using it, so it's safe under any PG version. ──
  await knex.raw(`ALTER TYPE whatsapp_message_type ADD VALUE IF NOT EXISTS 'purchase_order_share'`);

  // whatsapp_settings (migration 022) has one enable_X/template_X column
  // pair per message type — add the pair for the new type so it's toggled
  // and templated the exact same way as the 5 existing ones.
  await knex.schema.alterTable('whatsapp_settings', (t) => {
    t.boolean('enable_purchase_order_share').notNullable().defaultTo(true);
    t.text('template_purchase_order_share');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('whatsapp_settings', (t) => {
    t.dropColumn('template_purchase_order_share');
    t.dropColumn('enable_purchase_order_share');
  });

  await knex.schema.dropTableIfExists('purchase_order_approvals');
  await knex.schema.dropTableIfExists('purchase_order_items');
  await knex.raw('ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS chk_purchase_orders_status');
  await knex.raw('ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS chk_purchase_orders_discount_type');
  await knex.schema.dropTableIfExists('purchase_orders');

  await knex.raw('DROP FUNCTION IF EXISTS generate_next_purchase_order_no(uuid)');
  await knex.schema.alterTable('invoice_sequences', (t) => {
    t.dropColumn('next_purchase_order_no');
  });

  // Note: PostgreSQL cannot remove a value from an enum type; the
  // 'purchase_order_share' whatsapp_message_type value is left in place on
  // rollback (harmless — matches how migrations 016/075/079/089 handle this).
}
