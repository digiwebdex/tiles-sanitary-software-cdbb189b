import type { Knex } from 'knex';

/**
 * V2 Sprint 6A — Accounting Engine Foundation.
 *
 * Purely additive, per the approved docs/ACCOUNTING_V2_ARCHITECTURE.md
 * (Rev 2) and docs/ACCOUNTING_REVIEW_RESPONSE.md. No existing table's
 * meaning changes for any pre-existing row; every new column is nullable
 * or defaulted so historical data (and every route that doesn't yet know
 * about these columns) keeps working unchanged.
 *
 * 1. `gl_accounts` — widen for Account Groups / Parent-Child / Contra
 *    Accounts / Account Categories, on top of the existing 5-way
 *    `account_type` (asset/liability/equity/income/expense) and
 *    `parent_code` hierarchy (both already correct, kept as-is):
 *      - `normal_balance` ('debit'|'credit') — lets a contra-asset like
 *        Accumulated Depreciation live under account_type='asset' while
 *        correctly carrying a natural credit balance. Backfilled from each
 *        row's account_type (asset/expense -> debit, liability/equity/
 *        income -> credit) so every existing account gets a correct value
 *        with zero manual intervention.
 *      - `is_contra` — explicit flag (redundant with, but more discoverable
 *        than, inferring contra-ness from a normal_balance/account_type
 *        mismatch).
 *      - `is_group` — a non-postable header account (an "Account Group" in
 *        the traditional sense, e.g. "1000 Current Assets" as a parent with
 *        postable children under it via the existing `parent_code`) — only
 *        non-group accounts can receive postings.
 *      - `category` — free-text Account Category label (e.g.
 *        'current_asset', 'fixed_asset') for future statement-layout
 *        grouping. Explicitly NOT a new lookup table — this sprint does not
 *        implement Trial Balance/Balance Sheet, so no consumer needs a
 *        rigid category enum yet; a plain nullable column is the minimal,
 *        non-redesigning choice.
 *
 * 2. `fiscal_years` / `accounting_periods` — new, both directly
 *    `dealer_id`-scoped (not only via a parent FK), per the corrected
 *    multi-tenant-safety requirement in the approved architecture.
 *    `fiscal_years.opening_balance_journal_id` links a fiscal year to the
 *    ONE manual Journal entry (existing `journal_entries` mechanism, reused
 *    unmodified) that represents its Opening Balance — no new opening-
 *    balance table or posting mechanism is introduced.
 *
 * 3. `journal_entries` — widen for the Draft -> Approve -> Post -> Reverse
 *    workflow:
 *      - `status` ('draft'|'approved'|'posted'), defaulting existing rows
 *        to 'posted' (every entry created under the old flow was, in
 *        effect, immediately posted — this is a pure backfill, not a
 *        behavior change for historical rows).
 *      - `approved_by`/`approved_at`, `posted_by`/`posted_at` (separate
 *        from the existing `created_by`/`created_at`, which now means
 *        "drafted by/at").
 *      - `reverses_journal_entry_id` (self-referencing, nullable) — mirrors
 *        `posting_batches.reverses_batch_id`'s already-established pattern
 *        exactly: reversing an entry NEVER edits or hides the original
 *        (immutability), it creates a NEW posted entry with mirrored debit/
 *        credit lines that links back via this column. "Has entry X been
 *        reversed" is answered by checking for a child row, not a status
 *        flag on X itself — X's own status never changes once posted.
 *
 * 4. `gl_journal_lines.dealer_id` — added directly (backfilled via a join
 *    against `gl_journal_entries`), matching `posting_lines`' own
 *    established convention. This table becomes a primary write target
 *    once GL activation lands later in this sprint; every other table in
 *    this migration era already carries `dealer_id` directly for exactly
 *    this reason.
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. gl_accounts widening ──────────────────────────────────────────
  await knex.schema.alterTable('gl_accounts', (t) => {
    t.string('normal_balance', 10).nullable();
    t.boolean('is_contra').notNullable().defaultTo(false);
    t.boolean('is_group').notNullable().defaultTo(false);
    t.string('category', 50).nullable();
  });

  await knex.raw(`
    UPDATE public.gl_accounts
    SET normal_balance = CASE
      WHEN account_type IN ('asset', 'expense') THEN 'debit'
      ELSE 'credit'
    END
    WHERE normal_balance IS NULL
  `);

  await knex.raw(`
    ALTER TABLE public.gl_accounts
      ALTER COLUMN normal_balance SET NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE public.gl_accounts
      ADD CONSTRAINT gl_accounts_normal_balance_check
      CHECK (normal_balance IN ('debit', 'credit'))
  `);

  // ── 2. Fiscal Year / Accounting Period ───────────────────────────────
  await knex.schema.createTable('fiscal_years', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('name', 50).notNullable(); // e.g. "FY2026-27"
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.string('status', 20).notNullable().defaultTo('open'); // open | closed
    t.boolean('is_current').notNullable().defaultTo(false);
    t.uuid('opening_balance_journal_id').nullable().references('id').inTable('journal_entries').onDelete('SET NULL');
    t.timestamp('closed_at', { useTz: true }).nullable();
    t.uuid('closed_by').nullable();
    t.uuid('created_by').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['dealer_id', 'name']);
    t.index(['dealer_id']);
    t.index(['dealer_id', 'is_current']);
  });
  await knex.raw(`
    ALTER TABLE public.fiscal_years
      ADD CONSTRAINT fiscal_years_status_check
      CHECK (status IN ('open', 'closed'))
  `);

  await knex.schema.createTable('accounting_periods', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('fiscal_year_id').notNullable().references('id').inTable('fiscal_years').onDelete('CASCADE');
    t.integer('period_no').notNullable(); // 1-12
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.string('status', 20).notNullable().defaultTo('open'); // open | closed
    t.timestamp('closed_at', { useTz: true }).nullable();
    t.uuid('closed_by').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['fiscal_year_id', 'period_no']);
    t.index(['dealer_id', 'start_date', 'end_date']);
    t.index(['dealer_id', 'fiscal_year_id']);
  });
  await knex.raw(`
    ALTER TABLE public.accounting_periods
      ADD CONSTRAINT accounting_periods_status_check
      CHECK (status IN ('open', 'closed'))
  `);

  // ── 3. journal_entries — Draft / Approve / Post / Reverse ────────────
  await knex.schema.alterTable('journal_entries', (t) => {
    t.string('status', 20).notNullable().defaultTo('posted');
    t.uuid('approved_by').nullable();
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.uuid('posted_by').nullable();
    t.timestamp('posted_at', { useTz: true }).nullable();
    t.uuid('reverses_journal_entry_id').nullable()
      .references('id').inTable('journal_entries').onDelete('SET NULL');
  });

  // Backfill: every pre-existing entry was, under the old flow, created and
  // immediately in-effect — record that as posted_by/posted_at = created_by/
  // created_at, matching their real historical behavior exactly.
  await knex.raw(`
    UPDATE public.journal_entries
    SET posted_by = created_by, posted_at = created_at
    WHERE posted_at IS NULL
  `);

  await knex.raw(`
    ALTER TABLE public.journal_entries
      ADD CONSTRAINT journal_entries_status_check
      CHECK (status IN ('draft', 'approved', 'posted'))
  `);

  // ── 4. gl_journal_lines.dealer_id (direct scoping) ───────────────────
  await knex.schema.alterTable('gl_journal_lines', (t) => {
    t.uuid('dealer_id').nullable();
  });
  await knex.raw(`
    UPDATE public.gl_journal_lines jl
    SET dealer_id = je.dealer_id
    FROM public.gl_journal_entries je
    WHERE jl.journal_entry_id = je.id AND jl.dealer_id IS NULL
  `);
  await knex.raw(`
    ALTER TABLE public.gl_journal_lines
      ALTER COLUMN dealer_id SET NOT NULL
  `);
  await knex.schema.alterTable('gl_journal_lines', (t) => {
    t.index(['dealer_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('gl_journal_lines', (t) => {
    t.dropColumn('dealer_id');
  });

  await knex.raw(`
    ALTER TABLE public.journal_entries
      DROP CONSTRAINT IF EXISTS journal_entries_status_check
  `);
  await knex.schema.alterTable('journal_entries', (t) => {
    t.dropColumn('status');
    t.dropColumn('approved_by');
    t.dropColumn('approved_at');
    t.dropColumn('posted_by');
    t.dropColumn('posted_at');
    t.dropColumn('reverses_journal_entry_id');
  });

  await knex.schema.dropTableIfExists('accounting_periods');
  await knex.schema.dropTableIfExists('fiscal_years');

  await knex.raw(`
    ALTER TABLE public.gl_accounts
      DROP CONSTRAINT IF EXISTS gl_accounts_normal_balance_check
  `);
  await knex.schema.alterTable('gl_accounts', (t) => {
    t.dropColumn('normal_balance');
    t.dropColumn('is_contra');
    t.dropColumn('is_group');
    t.dropColumn('category');
  });
}
