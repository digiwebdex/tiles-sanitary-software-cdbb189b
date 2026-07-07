import type { Knex } from 'knex';

/**
 * V2 Sprint 6D — Cost Centers, Project Accounting, Fixed Assets & Depreciation,
 * Budget Management.
 *
 * Purely additive. New tables:
 *   departments                    lightweight org entity (nothing existed
 *                                   beyond free-text `department` varchar
 *                                   columns on employees/purchase_requests,
 *                                   which are left untouched — this is a new,
 *                                   parallel, referenceable entity, not a
 *                                   migration of that free text)
 *   cost_centers                   parent/child hierarchy, dealer_id direct,
 *                                   maps to a department and/or branch
 *   asset_categories                default depreciation policy per category
 *   asset_depreciation_schedule     one row per fixed asset per period
 *   budgets                        fiscal-year-scoped, versioned via revisions
 *
 * Extended tables (new nullable columns only):
 *   posting_lines           + cost_center_id, project_id
 *   journal_entry_lines     + cost_center_id
 *   expenses                + project_id, cost_center_id
 *   assets (Phase 18, HR)   + asset_category_id, useful_life_months,
 *                             salvage_value, depreciation_method,
 *                             depreciation_rate, accumulated_depreciation,
 *                             disposed_at, disposal_proceeds, disposal_reason,
 *                             purchase_posting_batch_id, disposal_posting_batch_id
 *                           — the existing `assets` table (HR "who has the
 *                             company laptop" tracking) already carries tag/
 *                             name/category/serial_no/purchase_date/
 *                             purchase_cost/assigned_to; every new column
 *                             here is nullable, so existing HR asset-assignment
 *                             rows and behavior are completely unaffected.
 *                             `assets.category` (free text) is untouched;
 *                             `asset_category_id` is a new, optional FK for
 *                             assets that ARE capitalized fixed assets.
 */
export async function up(knex: Knex): Promise<void> {
  // ── Departments ───────────────────────────────────────────────────────
  await knex.schema.createTable('departments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('code', 32).notNullable();
    t.string('name', 150).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['dealer_id', 'code']);
    t.index(['dealer_id', 'is_active']);
  });

  // ── Cost Centers ──────────────────────────────────────────────────────
  await knex.schema.createTable('cost_centers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('code', 32).notNullable();
    t.string('name', 150).notNullable();
    t.uuid('parent_id').nullable().references('id').inTable('cost_centers').onDelete('SET NULL');
    t.uuid('department_id').nullable().references('id').inTable('departments').onDelete('SET NULL');
    t.uuid('branch_id').nullable().references('id').inTable('branches').onDelete('SET NULL');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.text('notes');
    t.uuid('created_by').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['dealer_id', 'code']);
    t.index(['dealer_id', 'is_active']);
    t.index(['dealer_id', 'parent_id']);
  });

  // ── posting_lines line_domain widened: 'asset' (Fixed Asset purchase/
  //    disposal/depreciation — none of the existing 7 domains represent a
  //    capitalized-asset GL effect) — additive, existing 7 values unchanged.
  await knex.raw('ALTER TABLE public.posting_lines DROP CONSTRAINT IF EXISTS posting_lines_line_domain_check');
  await knex.raw(`
    ALTER TABLE public.posting_lines
      ADD CONSTRAINT posting_lines_line_domain_check
      CHECK (line_domain IN ('stock', 'customer', 'supplier', 'cash', 'bank', 'expense', 'tax', 'asset'))
  `);

  // ── posting_lines / journal_entry_lines / expenses — cost center + project ──
  await knex.schema.alterTable('posting_lines', (t) => {
    t.uuid('cost_center_id').nullable().references('id').inTable('cost_centers').onDelete('SET NULL');
    t.uuid('project_id').nullable().references('id').inTable('projects').onDelete('SET NULL');
  });
  await knex.schema.alterTable('posting_lines', (t) => {
    t.index(['dealer_id', 'cost_center_id']);
    t.index(['dealer_id', 'project_id']);
  });

  await knex.schema.alterTable('journal_entry_lines', (t) => {
    t.uuid('cost_center_id').nullable().references('id').inTable('cost_centers').onDelete('SET NULL');
  });

  await knex.schema.alterTable('expenses', (t) => {
    t.uuid('project_id').nullable().references('id').inTable('projects').onDelete('SET NULL');
    t.uuid('cost_center_id').nullable().references('id').inTable('cost_centers').onDelete('SET NULL');
  });
  await knex.schema.alterTable('expenses', (t) => {
    t.index(['dealer_id', 'project_id']);
    t.index(['dealer_id', 'cost_center_id']);
  });

  // ── Asset Categories ──────────────────────────────────────────────────
  await knex.schema.createTable('asset_categories', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('name', 150).notNullable();
    t.integer('default_useful_life_months').nullable();
    t.decimal('default_salvage_percent', 5, 2).notNullable().defaultTo(0);
    t.string('default_depreciation_method', 20).notNullable().defaultTo('straight_line');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['dealer_id', 'name']);
    t.index(['dealer_id', 'is_active']);
  });
  await knex.raw(`
    ALTER TABLE public.asset_categories
      ADD CONSTRAINT asset_categories_depr_method_check
      CHECK (default_depreciation_method IN ('straight_line', 'declining_balance'))
  `);

  // ── Fixed-asset extensions on the existing (Phase 18) `assets` table ────
  await knex.schema.alterTable('assets', (t) => {
    t.uuid('asset_category_id').nullable().references('id').inTable('asset_categories').onDelete('SET NULL');
    t.integer('useful_life_months').nullable();
    t.decimal('salvage_value', 12, 2).notNullable().defaultTo(0);
    t.string('depreciation_method', 20).nullable(); // NULL = not depreciated (not a capitalized fixed asset)
    t.decimal('depreciation_rate', 5, 2).nullable(); // annual %, used for declining_balance
    t.decimal('accumulated_depreciation', 12, 2).notNullable().defaultTo(0);
    t.date('depreciation_start_date').nullable();
    t.timestamp('disposed_at', { useTz: true }).nullable();
    t.decimal('disposal_proceeds', 12, 2).nullable();
    t.text('disposal_reason').nullable();
    t.uuid('purchase_posting_batch_id').nullable().references('id').inTable('posting_batches').onDelete('SET NULL');
    t.uuid('disposal_posting_batch_id').nullable().references('id').inTable('posting_batches').onDelete('SET NULL');
    t.uuid('cost_center_id').nullable().references('id').inTable('cost_centers').onDelete('SET NULL');
    t.uuid('project_id').nullable().references('id').inTable('projects').onDelete('SET NULL');
  });
  await knex.raw(`
    ALTER TABLE public.assets
      ADD CONSTRAINT assets_depreciation_method_check
      CHECK (depreciation_method IS NULL OR depreciation_method IN ('straight_line', 'declining_balance'))
  `);

  // ── Depreciation schedule ─────────────────────────────────────────────
  await knex.schema.createTable('asset_depreciation_schedule', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('asset_id').notNullable().references('id').inTable('assets').onDelete('CASCADE');
    t.integer('period_no').notNullable();
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.decimal('depreciation_amount', 12, 2).notNullable();
    t.decimal('accumulated_after', 12, 2).notNullable();
    t.decimal('book_value_after', 12, 2).notNullable();
    t.string('status', 20).notNullable().defaultTo('posted'); // posted only — schedule rows are written at posting time, not pre-generated
    t.uuid('posting_batch_id').nullable().references('id').inTable('posting_batches').onDelete('SET NULL');
    t.timestamp('posted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('posted_by').nullable();
    t.unique(['dealer_id', 'asset_id', 'period_no']);
    t.index(['dealer_id', 'asset_id']);
  });

  // ── Budgets ───────────────────────────────────────────────────────────
  await knex.schema.createTable('budgets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('fiscal_year_id').notNullable().references('id').inTable('fiscal_years').onDelete('CASCADE');
    t.string('scope_type', 20).notNullable(); // department | cost_center | project | account
    t.uuid('department_id').nullable().references('id').inTable('departments').onDelete('CASCADE');
    t.uuid('cost_center_id').nullable().references('id').inTable('cost_centers').onDelete('CASCADE');
    t.uuid('project_id').nullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('account_code', 20).nullable();
    t.string('period_type', 10).notNullable().defaultTo('annual'); // annual | monthly
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.decimal('amount', 14, 2).notNullable();
    t.integer('revision_no').notNullable().defaultTo(1);
    t.uuid('supersedes_id').nullable().references('id').inTable('budgets').onDelete('SET NULL');
    t.boolean('is_active').notNullable().defaultTo(true); // superseded revisions flip to false, never deleted
    t.text('notes');
    t.uuid('created_by').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['dealer_id', 'fiscal_year_id']);
    t.index(['dealer_id', 'scope_type']);
    t.index(['dealer_id', 'is_active']);
  });
  await knex.raw(`
    ALTER TABLE public.budgets
      ADD CONSTRAINT budgets_scope_type_check
      CHECK (scope_type IN ('department', 'cost_center', 'project', 'account')),
      ADD CONSTRAINT budgets_period_type_check
      CHECK (period_type IN ('annual', 'monthly'))
  `);

  // ── New GL accounts for Asset Disposal gain/loss (additive to the chart;
  //    seeded via glChart.ts's DEFAULT_GL_CHART for new dealers going
  //    forward — existing dealers get them the next time ensureDealerGlChart
  //    runs, same pattern as every prior sprint's chart addition) ─────────
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('budgets');
  await knex.schema.dropTableIfExists('asset_depreciation_schedule');
  await knex.raw('ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_depreciation_method_check');
  await knex.schema.alterTable('assets', (t) => {
    t.dropColumn('asset_category_id');
    t.dropColumn('useful_life_months');
    t.dropColumn('salvage_value');
    t.dropColumn('depreciation_method');
    t.dropColumn('depreciation_rate');
    t.dropColumn('accumulated_depreciation');
    t.dropColumn('depreciation_start_date');
    t.dropColumn('disposed_at');
    t.dropColumn('disposal_proceeds');
    t.dropColumn('disposal_reason');
    t.dropColumn('purchase_posting_batch_id');
    t.dropColumn('disposal_posting_batch_id');
    t.dropColumn('cost_center_id');
    t.dropColumn('project_id');
  });
  await knex.schema.dropTableIfExists('asset_categories');
  await knex.schema.alterTable('expenses', (t) => {
    t.dropColumn('project_id');
    t.dropColumn('cost_center_id');
  });
  await knex.schema.alterTable('journal_entry_lines', (t) => {
    t.dropColumn('cost_center_id');
  });
  await knex.schema.alterTable('posting_lines', (t) => {
    t.dropColumn('cost_center_id');
    t.dropColumn('project_id');
  });
  await knex.raw('ALTER TABLE public.posting_lines DROP CONSTRAINT IF EXISTS posting_lines_line_domain_check');
  await knex.raw(`
    ALTER TABLE public.posting_lines
      ADD CONSTRAINT posting_lines_line_domain_check
      CHECK (line_domain IN ('stock', 'customer', 'supplier', 'cash', 'bank', 'expense', 'tax'))
  `);
  await knex.schema.dropTableIfExists('cost_centers');
  await knex.schema.dropTableIfExists('departments');
}
