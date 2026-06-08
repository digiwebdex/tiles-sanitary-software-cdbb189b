import type { Knex } from 'knex';

/**
 * Phase 2 — Posting engine spine (P2-01).
 *
 *   posting_batches  — one row per post/reverse event on a business document
 *   posting_lines    — append-only stock + money effects for audit and future reports
 *
 * Legacy ledgers (customer_ledger, supplier_ledger, cash_ledger, stock_ledger, …)
 * remain the runtime source during dual-write migration; posting_lines mirror them.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('posting_batches', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id')
      .notNullable()
      .references('id')
      .inTable('dealers')
      .onDelete('CASCADE');
    t.text('document_type').notNullable();
    t.uuid('document_id').notNullable();
    t.text('event_type').notNullable();
    t.uuid('reverses_batch_id')
      .nullable()
      .references('id')
      .inTable('posting_batches')
      .onDelete('SET NULL');
    t.text('idempotency_key').nullable();
    t.uuid('posted_by').nullable();
    t.timestamp('posted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['dealer_id', 'idempotency_key']);
    t.index(['dealer_id', 'document_type', 'document_id']);
    t.index(['dealer_id', 'posted_at']);
  });

  await knex.raw(`
    ALTER TABLE public.posting_batches
      ADD CONSTRAINT posting_batches_event_type_check
      CHECK (event_type IN ('posted', 'reversed'));
  `);

  await knex.schema.createTable('posting_lines', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('posting_batch_id')
      .notNullable()
      .references('id')
      .inTable('posting_batches')
      .onDelete('CASCADE');
    t.uuid('dealer_id')
      .notNullable()
      .references('id')
      .inTable('dealers')
      .onDelete('CASCADE');

    /** stock | customer | supplier | cash | bank | expense | tax */
    t.text('line_domain').notNullable();
    /** Domain-specific type, e.g. sale, payment, purchase, receipt, purchase_in, sale_out */
    t.text('line_type').notNullable();

    t.uuid('party_id').nullable();
    t.uuid('product_id').nullable();
    /** product_batches.id — named product_batch_id to avoid confusion with posting_batch_id */
    t.uuid('product_batch_id').nullable();
    t.uuid('warehouse_id').nullable();
    t.uuid('purchase_id').nullable();
    t.uuid('sale_id').nullable();

    t.decimal('qty_delta', 14, 4).nullable();
    t.text('qty_unit').nullable();
    t.decimal('amount', 14, 2).notNullable();
    t.string('currency', 3).notNullable().defaultTo('BDT');
    t.date('entry_date').notNullable();
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['posting_batch_id']);
    t.index(['dealer_id', 'line_domain', 'entry_date']);
    t.index(['dealer_id', 'line_domain', 'party_id']);
    t.index(['dealer_id', 'sale_id']);
    t.index(['dealer_id', 'purchase_id']);
  });

  await knex.raw(`
    ALTER TABLE public.posting_lines
      ADD CONSTRAINT posting_lines_line_domain_check
      CHECK (line_domain IN ('stock', 'customer', 'supplier', 'cash', 'bank', 'expense', 'tax'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.posting_lines
      DROP CONSTRAINT IF EXISTS posting_lines_line_domain_check;
  `);
  await knex.schema.dropTableIfExists('posting_lines');

  await knex.raw(`
    ALTER TABLE public.posting_batches
      DROP CONSTRAINT IF EXISTS posting_batches_event_type_check;
  `);
  await knex.schema.dropTableIfExists('posting_batches');
}
