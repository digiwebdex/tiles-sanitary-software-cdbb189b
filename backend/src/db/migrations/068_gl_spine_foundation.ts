import type { Knex } from 'knex';

/**
 * P6-01 — GL spine foundation: chart of accounts + double-entry journal.
 * Mirrors posting_batches/lines when USE_GL_SPINE is enabled.
 */
export async function up(knex: Knex): Promise<void> {
  const hasAccounts = await knex.schema.hasTable('gl_accounts');
  if (!hasAccounts) {
    await knex.schema.createTable('gl_accounts', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
      t.string('code', 20).notNullable();
      t.string('name', 255).notNullable();
      t.string('account_type', 20).notNullable();
      t.string('parent_code', 20).nullable();
      t.boolean('is_system').notNullable().defaultTo(true);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['dealer_id', 'code']);
      t.index(['dealer_id', 'account_type']);
    });

    await knex.raw(`
      ALTER TABLE gl_accounts
      ADD CONSTRAINT gl_accounts_type_check
      CHECK (account_type IN ('asset','liability','equity','income','expense'))
    `);
  }

  const hasEntries = await knex.schema.hasTable('gl_journal_entries');
  if (!hasEntries) {
    await knex.schema.createTable('gl_journal_entries', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
      t.uuid('posting_batch_id').nullable().references('id').inTable('posting_batches').onDelete('SET NULL');
      t.date('entry_date').notNullable();
      t.text('description').nullable();
      t.string('document_type', 50).nullable();
      t.uuid('document_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['posting_batch_id']);
      t.index(['dealer_id', 'entry_date']);
    });
  }

  const hasLines = await knex.schema.hasTable('gl_journal_lines');
  if (!hasLines) {
    await knex.schema.createTable('gl_journal_lines', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('journal_entry_id')
        .notNullable()
        .references('id')
        .inTable('gl_journal_entries')
        .onDelete('CASCADE');
      t.uuid('account_id').notNullable().references('id').inTable('gl_accounts').onDelete('RESTRICT');
      t.decimal('debit', 14, 2).notNullable().defaultTo(0);
      t.decimal('credit', 14, 2).notNullable().defaultTo(0);
      t.uuid('posting_line_id').nullable().references('id').inTable('posting_lines').onDelete('SET NULL');
      t.jsonb('metadata').notNullable().defaultTo('{}');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['journal_entry_id']);
      t.index(['account_id']);
    });

    await knex.raw(`
      ALTER TABLE gl_journal_lines
      ADD CONSTRAINT gl_journal_lines_dc_check
      CHECK (
        (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0) OR (debit = 0 AND credit = 0)
      )
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('gl_journal_lines');
  await knex.schema.dropTableIfExists('gl_journal_entries');
  await knex.schema.dropTableIfExists('gl_accounts');
}
