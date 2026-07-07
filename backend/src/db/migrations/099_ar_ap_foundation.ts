import type { Knex } from 'knex';

/**
 * V2 Sprint 6B — AR/AP Foundation.
 *
 * Purely additive, mirroring the established pattern from migrations
 * 096/097 (enum widening) and 062 (view redefinition):
 *
 * 1. `ledger_entry_type` enum — add 'opening_balance'. `customer_ledger.type`
 *    is a free varchar and already accepts this value; `supplier_ledger.type`
 *    is bound to this Postgres enum and would otherwise hard-fail on insert
 *    (the gap documented in docs/SPRINT6B_AR_AP.md's inspection section).
 * 2. `mv_customer_outstanding` — redefined (CREATE OR REPLACE VIEW, no data
 *    loss) to also include `customer_ledger` 'opening_balance'/'adjustment'
 *    rows, which today silently contribute 0 to AR/Aging even though they
 *    correctly affect `computeCustomerBalance()`. `mv_supplier_payable` is
 *    NOT touched — it already sums every `supplier_ledger` row generically
 *    regardless of type, so it will pick up 'opening_balance' rows for free
 *    once (1) lands.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'opening_balance'`);

  await knex.raw(`
    CREATE OR REPLACE VIEW public.mv_customer_outstanding AS
    SELECT
      dealer_id,
      customer_id,
      ROUND(SUM(due)::numeric, 2) AS outstanding,
      MIN(oldest_unpaid_date) AS oldest_unpaid_date,
      SUM(open_invoice_count) AS open_invoice_count
    FROM (
      SELECT
        s.dealer_id,
        s.customer_id,
        COALESCE(s.due_amount, 0)::numeric AS due,
        CASE WHEN COALESCE(s.due_amount, 0) > 0.01 THEN s.sale_date END AS oldest_unpaid_date,
        (CASE WHEN COALESCE(s.due_amount, 0) > 0.01 THEN 1 ELSE 0 END) AS open_invoice_count
      FROM public.sales s
      WHERE COALESCE(s.document_status, 'posted') <> 'reversed'
        AND s.customer_id IS NOT NULL

      UNION ALL

      SELECT
        cl.dealer_id,
        cl.customer_id,
        cl.amount::numeric AS due,
        NULL::date AS oldest_unpaid_date,
        0 AS open_invoice_count
      FROM public.customer_ledger cl
      WHERE cl.customer_id IS NOT NULL
        AND cl.type IN ('opening_balance', 'adjustment')
    ) combined
    GROUP BY dealer_id, customer_id
    HAVING SUM(due) > 0.01;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Restore the pre-6B view exactly (sales.due_amount only).
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
  // Postgres cannot drop a single enum value; leaving 'opening_balance' in
  // place on rollback is safe (unused going forward, matches precedent from
  // migrations 096/097's own down()).
}
