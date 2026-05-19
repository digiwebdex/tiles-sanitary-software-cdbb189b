import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.sale_items
      ADD COLUMN IF NOT EXISTS original_resolved_rate numeric(14,2);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.sale_items
      DROP COLUMN IF EXISTS original_resolved_rate;
  `);
}
