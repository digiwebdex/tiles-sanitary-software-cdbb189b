import type { Knex } from 'knex';

/**
 * customers.price_tier_id — pricing tier assignment per customer.
 * Supabase had this column; Knex chain was missing it, breaking pricing-tier reports.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.customers
      ADD COLUMN IF NOT EXISTS price_tier_id uuid
        REFERENCES public.price_tiers(id) ON DELETE SET NULL;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_customers_price_tier
      ON public.customers (price_tier_id)
      WHERE price_tier_id IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS public.idx_customers_price_tier;`);
  await knex.raw(`
    ALTER TABLE public.customers
      DROP COLUMN IF EXISTS price_tier_id;
  `);
}
