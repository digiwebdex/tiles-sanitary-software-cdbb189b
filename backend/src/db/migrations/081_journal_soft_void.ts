import type { Knex } from 'knex';

/**
 * P1-H10 — Journal entries must never be physically deleted.
 *
 * A posted, balanced journal entry silently changes the trial balance if it is
 * hard-deleted, destroying the audit trail. Replace hard delete with a soft
 * void: the row is retained and excluded from balances, with who/when/why
 * recorded.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('journal_entries', (t) => {
    t.timestamp('voided_at').nullable();
    t.uuid('voided_by').nullable();
    t.text('void_reason').nullable();
    t.index(['dealer_id', 'voided_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('journal_entries', (t) => {
    t.dropColumn('voided_at');
    t.dropColumn('voided_by');
    t.dropColumn('void_reason');
  });
}
