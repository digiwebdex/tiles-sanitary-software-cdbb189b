import type { Knex } from 'knex';

/**
 * V2 Sprint 6E — Financial Statements & Closing.
 *
 * Purely additive:
 *   fiscal_years  + closing_journal_entry_id (nullable FK to journal_entries)
 *                   — mirrors the existing opening_balance_journal_id column
 *                   exactly (Sprint 6A already anticipated a paired closing
 *                   link when it named that column "opening_..." rather than
 *                   just "balance_journal_id"). Set when Fiscal Year Closing
 *                   generates its system closing journal entry.
 *
 *   vat_period_closings (new table) — a compliance RECORD of a closed VAT
 *   period's net position (Output VAT/SD totals, Input VAT/SD totals, net
 *   payable), NOT a GL/cash posting — no bank/cash payment date or method is
 *   captured because none is specified by the closing action itself (see
 *   docs/SPRINT6E_FINANCIAL_STATEMENTS_CLOSING.md §"VAT" for the reasoning).
 *   One row per dealer per closed period (enforced by a unique constraint),
 *   idempotent — closing the same period twice is rejected, not double-counted.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('fiscal_years', (t) => {
    t.uuid('closing_journal_entry_id').nullable().references('id').inTable('journal_entries').onDelete('SET NULL');
  });

  await knex.schema.createTable('vat_period_closings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.decimal('output_vat_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('output_sd_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('input_vat_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('input_sd_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('net_payable', 14, 2).notNullable().defaultTo(0);
    t.text('notes');
    t.timestamp('closed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('closed_by').nullable();
    t.unique(['dealer_id', 'period_start', 'period_end']);
    t.index(['dealer_id', 'period_start']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vat_period_closings');
  await knex.schema.alterTable('fiscal_years', (t) => {
    t.dropColumn('closing_journal_entry_id');
  });
}
