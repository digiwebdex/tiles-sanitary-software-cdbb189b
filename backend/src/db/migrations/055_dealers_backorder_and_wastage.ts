import type { Knex } from 'knex';

/**
 * dealers.allow_backorder + default_wastage_pct — required for sale create and settings.
 * Present in Supabase migrations; missing from Knex chain on VPS.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.dealers
      ADD COLUMN IF NOT EXISTS allow_backorder boolean NOT NULL DEFAULT false;
  `);

  await knex.raw(`
    ALTER TABLE public.dealers
      ADD COLUMN IF NOT EXISTS default_wastage_pct numeric NOT NULL DEFAULT 10;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.dealers
      DROP COLUMN IF EXISTS default_wastage_pct,
      DROP COLUMN IF EXISTS allow_backorder;
  `);
}
