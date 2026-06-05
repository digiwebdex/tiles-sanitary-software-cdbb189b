import type { Knex } from "knex";

/**
 * Track 1 Phase 1A — Tile COGS unit-conversion fix.
 *
 * Adds a sentinel column to `sales` that distinguishes rows written by:
 *   - The pre-fix code path (where tile-product `cogs` was understated by
 *     a factor of `per_box_sft` due to a units mismatch on
 *     routes/sales.ts:512 and :975); and
 *   - The post-fix code path (Phase 1A onward) that uses the
 *     dimensionally-correct `computeLineCogs` helper.
 *
 * The column is intentionally a free-form TEXT (not an enum) so future
 * phases can introduce additional states such as 'recomputed_approx'
 * (Phase 1B opt-in backfill) without an enum-rebuild migration.
 *
 * Backward compatibility:
 *   • Every existing row receives `cogs_method = 'legacy_pre_fix'` by
 *     the NOT NULL DEFAULT.
 *   • The migration is purely additive — no data is rewritten, no row
 *     is locked beyond a brief metadata change.
 *
 * Down migration drops only the column + index. No data loss possible.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.sales
      ADD COLUMN IF NOT EXISTS cogs_method TEXT NOT NULL DEFAULT 'legacy_pre_fix';
  `);

  // Partial index speeds up the "any legacy rows in this period?" detector
  // used by GET /api/financials/p-and-l and /trial-balance. Partial because
  // post-fix rows are not interesting to scan.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sales_cogs_method_legacy
      ON public.sales (dealer_id, sale_date)
      WHERE cogs_method = 'legacy_pre_fix';
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS public.idx_sales_cogs_method_legacy;`);
  await knex.raw(`ALTER TABLE public.sales DROP COLUMN IF EXISTS cogs_method;`);
}
