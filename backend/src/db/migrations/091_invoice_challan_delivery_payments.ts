import type { Knex } from 'knex';

/**
 * V2 Sprint 4C — Invoice, Challan, Delivery & Customer Payments.
 *
 * Purely ADDITIVE. Inspection found nearly all of this sprint's scope
 * already built and working (see docs/SPRINT4C_*.md §1 for the full
 * reuse table): the `sales` table IS the Invoice (draft via
 * sale_type='challan_mode', approved via the existing
 * POST /api/challans/convert-invoice/:saleId, numbered/statused/audited
 * already); Challan/Delivery generation, print, and status tracking
 * already exist (challans.ts, deliveries.ts); VAT calculation, dealer
 * settings, and the Mushak-6.3 print template already exist (migration
 * 063); Customer Payments (cash/bank/bKash/Nagad/SSLCommerz/cheque/card,
 * FIFO allocation, bank ledgers) already exist (collections.ts,
 * customerPayment.ts).
 *
 * What's genuinely new, requiring schema:
 *   - `sales_orders` conversion audit trail (mirrors quotations' own
 *     `converted_sale_id`/`converted_by`/`converted_at` columns) — Sales
 *     Order → Invoice is a new capability this sprint adds.
 *   - `challans.driver_phone` / `scheduled_delivery_date` — driver_name
 *     and vehicle_no already existed; phone and a planned (vs actual)
 *     delivery date did not.
 *   - `deliveries.confirmed_by` / `confirmed_at` — Delivery Confirmation
 *     as a distinct audited action, not just a status string flip.
 *   - `customer_advance_applications` — Advance Payment tracking.
 *     `recordCustomerPayment()` (customerPayment.ts) currently REJECTS a
 *     payment with no outstanding due sale ("No outstanding invoices to
 *     apply payment"), so today a customer literally cannot pay in
 *     advance. This new table tracks how much of an advance (a
 *     `customer_ledger` 'payment' row with `sale_id IS NULL`) has since
 *     been applied against a specific invoice — deliberately NOT another
 *     `customer_ledger` row, so the customer-level due_balance formula in
 *     customerStatements.ts (frozen, Sprint 4A) is never touched or
 *     double-counted: the advance's cash is only ever counted once, at
 *     receipt time.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sales_orders', (t) => {
    t.uuid('converted_sale_id').references('id').inTable('sales').onDelete('SET NULL');
    t.uuid('converted_to_sale_by');
    t.timestamp('converted_to_sale_at', { useTz: true });
  });

  await knex.schema.alterTable('challans', (t) => {
    t.string('driver_phone', 50);
    t.date('scheduled_delivery_date');
  });

  await knex.schema.alterTable('deliveries', (t) => {
    t.uuid('confirmed_by');
    t.timestamp('confirmed_at', { useTz: true });
  });

  await knex.schema.createTable('customer_advance_applications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.uuid('sale_id').notNullable().references('id').inTable('sales').onDelete('CASCADE');
    t.decimal('amount', 14, 2).notNullable();
    t.uuid('applied_by');
    t.timestamp('applied_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('dealer_id');
    t.index(['dealer_id', 'customer_id']);
    t.index('sale_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('customer_advance_applications');
  await knex.schema.alterTable('deliveries', (t) => {
    t.dropColumn('confirmed_by');
    t.dropColumn('confirmed_at');
  });
  await knex.schema.alterTable('challans', (t) => {
    t.dropColumn('driver_phone');
    t.dropColumn('scheduled_delivery_date');
  });
  await knex.schema.alterTable('sales_orders', (t) => {
    t.dropColumn('converted_sale_id');
    t.dropColumn('converted_to_sale_by');
    t.dropColumn('converted_to_sale_at');
  });
}
