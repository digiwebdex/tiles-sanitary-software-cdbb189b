import type { Knex } from 'knex';

/**
 * V2 Sprint 6C — Cash/Bank Reconciliation Foundation.
 *
 * Purely additive:
 * 1. `bank_ledger` gains cheque tracking (`cheque_no`, `cheque_status`) and
 *    a cleared/reconciled flag (`is_cleared`, `cleared_at`) — every existing
 *    row defaults to `is_cleared=false`, `cheque_status=NULL`, matching
 *    current (pre-reconciliation) reality exactly.
 * 2. `bank_statement_lines` (new table) — one row per imported/manual bank
 *    statement line, optionally matched to a `bank_ledger` row. This is the
 *    only new table this sprint needs; a "reconciliation session" concept
 *    was deliberately NOT introduced — the reconciliation summary (Cleared
 *    Transactions / Outstanding Deposits / Outstanding Cheques) is computed
 *    on demand from `bank_ledger`+`bank_statement_lines`, not stored.
 * 3. `ledger_entry_type` enum — add 'transfer' (mirrors migrations 096/097/
 *    099's own widening pattern). `cash_ledger.type` and `supplier_ledger.type`
 *    are both bound to this one shared enum; `bank_ledger.type` is a free
 *    varchar and already accepted 'transfer' as a matter of convention
 *    (see bankAccounts.ts's existing EntrySchema) but never had a real
 *    paired-transfer caller until this sprint.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'transfer'`);

  await knex.schema.alterTable('bank_ledger', (t) => {
    t.string('cheque_no', 30).nullable();
    t.string('cheque_status', 20).nullable();
    t.boolean('is_cleared').notNullable().defaultTo(false);
    t.timestamp('cleared_at', { useTz: true }).nullable();
  });
  await knex.raw(`
    ALTER TABLE public.bank_ledger
      ADD CONSTRAINT bank_ledger_cheque_status_check
      CHECK (cheque_status IS NULL OR cheque_status IN ('issued', 'presented', 'cleared', 'bounced', 'cancelled'))
  `);
  await knex.schema.alterTable('bank_ledger', (t) => {
    t.index(['dealer_id', 'bank_account_id', 'is_cleared']);
    t.index(['dealer_id', 'cheque_no']);
  });

  await knex.schema.createTable('bank_statement_lines', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('bank_account_id').notNullable().references('id').inTable('bank_accounts').onDelete('CASCADE');
    t.date('entry_date').notNullable();
    t.text('description');
    t.decimal('amount', 14, 2).notNullable(); // signed, as it appears on the statement
    t.string('reference', 100);
    t.string('source', 10).notNullable().defaultTo('manual'); // 'csv' | 'manual'
    t.string('status', 20).notNullable().defaultTo('unmatched'); // 'unmatched' | 'matched' | 'ignored'
    t.uuid('matched_bank_ledger_id').nullable().references('id').inTable('bank_ledger').onDelete('SET NULL');
    t.uuid('created_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['dealer_id', 'bank_account_id', 'status']);
    t.index(['dealer_id', 'bank_account_id', 'entry_date']);
  });
  await knex.raw(`
    ALTER TABLE public.bank_statement_lines
      ADD CONSTRAINT bank_statement_lines_source_check CHECK (source IN ('csv', 'manual')),
      ADD CONSTRAINT bank_statement_lines_status_check CHECK (status IN ('unmatched', 'matched', 'ignored'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('bank_statement_lines');
  await knex.raw('ALTER TABLE public.bank_ledger DROP CONSTRAINT IF EXISTS bank_ledger_cheque_status_check');
  await knex.schema.alterTable('bank_ledger', (t) => {
    t.dropColumn('cheque_no');
    t.dropColumn('cheque_status');
    t.dropColumn('is_cleared');
    t.dropColumn('cleared_at');
  });
}
