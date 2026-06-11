import type { Knex } from 'knex';

/**
 * P2-07 — Document lifecycle columns on sales and purchases.
 * Enables immutable posted docs and reverse+repost (P2-08/09).
 */
export async function up(knex: Knex): Promise<void> {
  for (const table of ['sales', 'purchases'] as const) {
    await knex.raw(`
      ALTER TABLE public.${table}
        ADD COLUMN IF NOT EXISTS document_status text NOT NULL DEFAULT 'posted',
        ADD COLUMN IF NOT EXISTS posting_batch_id uuid NULL,
        ADD COLUMN IF NOT EXISTS reverses_document_id uuid NULL,
        ADD COLUMN IF NOT EXISTS posted_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS posted_by uuid NULL;
    `);
  }

  await knex.raw(`
    ALTER TABLE public.sales
      DROP CONSTRAINT IF EXISTS sales_document_status_check;
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_document_status_check
      CHECK (document_status IN ('draft', 'pending_approval', 'posted', 'reversed'));
  `);

  await knex.raw(`
    ALTER TABLE public.purchases
      DROP CONSTRAINT IF EXISTS purchases_document_status_check;
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_document_status_check
      CHECK (document_status IN ('draft', 'pending_approval', 'posted', 'reversed'));
  `);

  await knex.raw(`
    ALTER TABLE public.sales
      DROP CONSTRAINT IF EXISTS sales_posting_batch_id_fkey;
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_posting_batch_id_fkey
      FOREIGN KEY (posting_batch_id) REFERENCES public.posting_batches(id) ON DELETE SET NULL;
  `);

  await knex.raw(`
    ALTER TABLE public.purchases
      DROP CONSTRAINT IF EXISTS purchases_posting_batch_id_fkey;
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_posting_batch_id_fkey
      FOREIGN KEY (posting_batch_id) REFERENCES public.posting_batches(id) ON DELETE SET NULL;
  `);

  await knex.raw(`
    ALTER TABLE public.sales
      DROP CONSTRAINT IF EXISTS sales_reverses_document_id_fkey;
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_reverses_document_id_fkey
      FOREIGN KEY (reverses_document_id) REFERENCES public.sales(id) ON DELETE SET NULL;
  `);

  await knex.raw(`
    ALTER TABLE public.purchases
      DROP CONSTRAINT IF EXISTS purchases_reverses_document_id_fkey;
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_reverses_document_id_fkey
      FOREIGN KEY (reverses_document_id) REFERENCES public.purchases(id) ON DELETE SET NULL;
  `);

  // Existing rows were live-posted via legacy ledger writes.
  await knex.raw(`
    UPDATE public.sales
    SET document_status = 'posted',
        posted_at = COALESCE(posted_at, created_at)
    WHERE document_status = 'posted'
      AND posted_at IS NULL;
  `);

  await knex.raw(`
    UPDATE public.purchases
    SET document_status = 'posted',
        posted_at = COALESCE(posted_at, created_at)
    WHERE document_status = 'posted'
      AND posted_at IS NULL;
  `);

  // Challan-mode sales never hit stock/ledger — mark as draft.
  await knex.raw(`
    UPDATE public.sales
    SET document_status = 'draft',
        posted_at = NULL,
        posted_by = NULL
    WHERE sale_type = 'challan_mode'
      AND sale_status = 'draft';
  `);

  // Link posting_batch_id where dual-write already ran (e.g. INV-00007).
  await knex.raw(`
    UPDATE public.sales s
    SET posting_batch_id = sub.id
    FROM (
      SELECT DISTINCT ON (document_id) document_id, id
      FROM public.posting_batches
      WHERE document_type = 'sale' AND event_type = 'posted'
      ORDER BY document_id, posted_at DESC
    ) sub
    WHERE s.id = sub.document_id
      AND s.posting_batch_id IS NULL;
  `);

  await knex.raw(`
    UPDATE public.purchases p
    SET posting_batch_id = sub.id
    FROM (
      SELECT DISTINCT ON (document_id) document_id, id
      FROM public.posting_batches
      WHERE document_type = 'purchase' AND event_type = 'posted'
      ORDER BY document_id, posted_at DESC
    ) sub
    WHERE p.id = sub.document_id
      AND p.posting_batch_id IS NULL;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sales_document_status
      ON public.sales (dealer_id, document_status, sale_date);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_purchases_document_status
      ON public.purchases (dealer_id, document_status, purchase_date);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS public.idx_purchases_document_status;`);
  await knex.raw(`DROP INDEX IF EXISTS public.idx_sales_document_status;`);

  for (const table of ['sales', 'purchases'] as const) {
    await knex.raw(`
      ALTER TABLE public.${table}
        DROP CONSTRAINT IF EXISTS ${table}_reverses_document_id_fkey;
      ALTER TABLE public.${table}
        DROP CONSTRAINT IF EXISTS ${table}_posting_batch_id_fkey;
      ALTER TABLE public.${table}
        DROP CONSTRAINT IF EXISTS ${table}_document_status_check;
      ALTER TABLE public.${table}
        DROP COLUMN IF EXISTS posted_by,
        DROP COLUMN IF EXISTS posted_at,
        DROP COLUMN IF EXISTS reverses_document_id,
        DROP COLUMN IF EXISTS posting_batch_id,
        DROP COLUMN IF EXISTS document_status;
    `);
  }
}
