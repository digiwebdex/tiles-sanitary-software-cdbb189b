import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.sales
      ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.project_sites(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_sales_project ON public.sales(project_id);
    CREATE INDEX IF NOT EXISTS idx_sales_site ON public.sales(site_id);
    CREATE INDEX IF NOT EXISTS idx_sales_quotation ON public.sales(quotation_id);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.sales
      DROP COLUMN IF EXISTS project_id,
      DROP COLUMN IF EXISTS site_id,
      DROP COLUMN IF EXISTS quotation_id;
  `);
}
