import type { Knex } from 'knex';

/** P4-01 — Read-model views for AR/AP (always fresh; refresh not required). */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE VIEW public.mv_customer_outstanding AS
    SELECT
      s.dealer_id,
      s.customer_id,
      ROUND(SUM(COALESCE(s.due_amount, 0))::numeric, 2) AS outstanding,
      MIN(s.sale_date) FILTER (WHERE COALESCE(s.due_amount, 0) > 0.01) AS oldest_unpaid_date,
      COUNT(*) FILTER (WHERE COALESCE(s.due_amount, 0) > 0.01) AS open_invoice_count
    FROM public.sales s
    WHERE COALESCE(s.document_status, 'posted') <> 'reversed'
      AND s.customer_id IS NOT NULL
    GROUP BY s.dealer_id, s.customer_id
    HAVING SUM(COALESCE(s.due_amount, 0)) > 0.01;
  `);

  await knex.raw(`
    CREATE OR REPLACE VIEW public.mv_supplier_payable AS
    SELECT
      sl.dealer_id,
      sl.supplier_id,
      ROUND(GREATEST(0,
        SUM(
          CASE
            WHEN sl.type = 'purchase' THEN -sl.amount::numeric
            WHEN sl.type IN ('payment', 'refund') THEN -sl.amount::numeric
            ELSE -sl.amount::numeric
          END
        )
      )::numeric, 2) AS outstanding
    FROM public.supplier_ledger sl
    WHERE sl.supplier_id IS NOT NULL
    GROUP BY sl.dealer_id, sl.supplier_id
    HAVING ROUND(GREATEST(0,
      SUM(
        CASE
          WHEN sl.type = 'purchase' THEN -sl.amount::numeric
          WHEN sl.type IN ('payment', 'refund') THEN -sl.amount::numeric
          ELSE -sl.amount::numeric
        END
      )
    )::numeric, 2) > 0.01;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP VIEW IF EXISTS public.mv_supplier_payable;');
  await knex.raw('DROP VIEW IF EXISTS public.mv_customer_outstanding;');
}
