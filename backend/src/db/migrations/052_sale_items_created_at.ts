import type { Knex } from 'knex';

/**
 * sale_items.created_at — required for FIFO backorder allocation on purchase create
 * and backorder report ordering. Initial Knex schema omitted this column; Supabase
 * portal functions also reference si.created_at.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.sale_items
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  `);

  // Backfill from parent sale so existing rows sort correctly in FIFO queues.
  await knex.raw(`
    UPDATE public.sale_items si
    SET created_at = s.created_at
    FROM public.sales s
    WHERE si.sale_id = s.id;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sale_items_dealer_product_created
      ON public.sale_items (dealer_id, product_id, created_at)
      WHERE backorder_qty > 0;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS public.idx_sale_items_dealer_product_created;
    ALTER TABLE public.sale_items DROP COLUMN IF EXISTS created_at;
  `);
}
