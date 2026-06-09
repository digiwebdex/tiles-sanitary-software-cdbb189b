import type { Knex } from 'knex';

/** P3-02 — Store COGS reversal amount on each sales return for accurate P&L. */
export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasTable('sales_returns');
  if (!has) return;

  const hasCol = await knex.schema.hasColumn('sales_returns', 'cogs_reversal');
  if (!hasCol) {
    await knex.schema.alterTable('sales_returns', (t) => {
      t.decimal('cogs_reversal', 14, 2).notNullable().defaultTo(0);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasTable('sales_returns');
  if (!has) return;
  const hasCol = await knex.schema.hasColumn('sales_returns', 'cogs_reversal');
  if (hasCol) {
    await knex.schema.alterTable('sales_returns', (t) => {
      t.dropColumn('cogs_reversal');
    });
  }
}
