import type { Knex } from 'knex';

/**
 * Add pricing source tracking to sale items.
 *
 * Existing report and sales code reads `sale_items.rate_source` to distinguish
 * default, tier, and manual pricing. Some databases had the pricing-tier tables
 * but not this column, so keep it idempotent for VPS migrations.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.sale_items
      ADD COLUMN IF NOT EXISTS rate_source text NOT NULL DEFAULT 'default';

    UPDATE public.sale_items
      SET rate_source = 'default'
      WHERE rate_source IS NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.sale_items
      DROP COLUMN IF EXISTS rate_source;
  `);
}
