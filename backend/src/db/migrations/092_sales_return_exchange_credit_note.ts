import type { Knex } from 'knex';

/**
 * V2 Sprint 4D — Sales Return, Exchange, Credit Note & Refund.
 *
 * Inspection found Sales Return + Partial Return already fully built and
 * battle-tested (backend/src/routes/returns.ts): row-locked state guards
 * (cannot return against a reversed/cancelled sale), LIFO batch-aware COGS
 * reversal, customer_ledger + cash_ledger posting, backorder cleanup, audit
 * logging. None of that is touched by this migration or this sprint.
 *
 * Genuinely new, purely additive:
 *   - `sales_returns.refund_paid_account_id` — the existing `refund_mode`
 *     column was captured but never actually branched on; every refund
 *     posted to `cash_ledger` regardless of value. This column lets a
 *     bank/cheque/card refund post to `bank_ledger` instead, mirroring the
 *     existing `paid_account_id` pattern already used for customer
 *     payments (Sprint 4A/4C).
 *   - `sales_returns.exchange_sale_id` — audit-only link from a return to
 *     the new replacement sale it was exchanged for (Sprint 4D's own
 *     "Exchange" requirement: "model Exchange as linked Return + New
 *     Sale"). Carries no money-math weight itself.
 *   - `customer_credit_note_applications` — mirrors Sprint 4C's own
 *     `customer_advance_applications` table exactly (same shape, same
 *     purpose: track how much of an unapplied credit balance has been
 *     applied to which invoice) but is a SEPARATE table so this sprint
 *     never touches Sprint 4C's frozen `advancePaymentService.ts`. A
 *     "Credit Note" in this system is a return whose `refund_mode='credit'`
 *     — no cash/bank leaves the till; the existing (already-unconditional)
 *     `customer_ledger` 'refund' row IS the credit, and this table tracks
 *     how much of it has since been drawn down against a specific invoice.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sales_returns', (t) => {
    t.uuid('refund_paid_account_id').references('id').inTable('bank_accounts').onDelete('SET NULL');
    t.uuid('exchange_sale_id').references('id').inTable('sales').onDelete('SET NULL');
  });

  await knex.schema.createTable('customer_credit_note_applications', (t) => {
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
  await knex.schema.dropTableIfExists('customer_credit_note_applications');
  await knex.schema.alterTable('sales_returns', (t) => {
    t.dropColumn('refund_paid_account_id');
    t.dropColumn('exchange_sale_id');
  });
}
