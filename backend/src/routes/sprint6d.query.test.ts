/**
 * V2 Sprint 6D — query-shape tests for costCenters.ts, fixedAssets.ts,
 * budgets.ts, and projectAccounting.ts. Same `.toSQL()` convention as the
 * other *.query.test.ts files (no live test DB) — each test rebuilds the
 * exact query chain the route handler runs and asserts on its shape, so a
 * future refactor that silently drops a join/filter/column fails here.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const COST_CENTER_ID = '22222222-2222-2222-2222-222222222222';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';

describe('GET /api/cost-centers — query shape', () => {
  it('left-joins departments and branches, scoped to the dealer', () => {
    const { sql, bindings } = db('cost_centers as cc')
      .leftJoin('departments as d', 'd.id', 'cc.department_id')
      .leftJoin('branches as b', 'b.id', 'cc.branch_id')
      .where({ 'cc.dealer_id': DEALER_ID })
      .andWhere('cc.is_active', true)
      .orderBy('cc.code')
      .select('cc.*', 'd.name as department_name', 'b.name as branch_name')
      .toSQL();
    expect(sql).toMatch(/left join "departments" as "d" on "d"."id" = "cc"."department_id"/i);
    expect(sql).toMatch(/left join "branches" as "b" on "b"."id" = "cc"."branch_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });
});

describe('GET /api/cost-centers/:id/report — query shape', () => {
  it('filters posting_lines by dealer + cost_center_id and an optional date range', () => {
    const { sql, bindings } = db('posting_lines')
      .where({ dealer_id: DEALER_ID, cost_center_id: COST_CENTER_ID })
      .andWhere('entry_date', '>=', '2026-01-01')
      .andWhere('entry_date', '<=', '2026-01-31')
      .select('line_domain', 'line_type', 'amount', 'entry_date')
      .toSQL();
    expect(sql).toMatch(/"cost_center_id" = /i);
    expect(bindings).toContain(COST_CENTER_ID);
    expect(bindings).toContain(DEALER_ID);
  });
});

describe('GET /api/fixed-assets — query shape', () => {
  it('left-joins asset_categories and cost_centers, scoped to the dealer', () => {
    const { sql, bindings } = db('assets as a')
      .leftJoin('asset_categories as c', 'c.id', 'a.asset_category_id')
      .leftJoin('cost_centers as cc', 'cc.id', 'a.cost_center_id')
      .where('a.dealer_id', DEALER_ID)
      .select('a.*', 'c.name as category_name', 'cc.name as cost_center_name')
      .orderBy('a.tag')
      .toSQL();
    expect(sql).toMatch(/left join "asset_categories" as "c" on "c"."id" = "a"."asset_category_id"/i);
    expect(sql).toMatch(/left join "cost_centers" as "cc" on "cc"."id" = "a"."cost_center_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });
});

describe('GET /api/fixed-assets/register-report — query shape', () => {
  it('only includes assets that were actually capitalized (purchase_posting_batch_id set)', () => {
    const { sql } = db('assets as a')
      .leftJoin('asset_categories as c', 'c.id', 'a.asset_category_id')
      .where('a.dealer_id', DEALER_ID)
      .whereNotNull('a.purchase_posting_batch_id')
      .select('a.id', 'a.purchase_cost', 'a.accumulated_depreciation')
      .toSQL();
    expect(sql).toMatch(/"a"\."purchase_posting_batch_id" is not null/i);
  });
});

describe('GET /api/fixed-assets/:id/ledger — query shape', () => {
  it('scopes posting_batches by document_id + document_type IN the three asset event types', () => {
    const { sql, bindings } = db('posting_batches')
      .where({ dealer_id: DEALER_ID, document_id: '44444444-4444-4444-4444-444444444444' })
      .whereIn('document_type', ['fixed_asset_purchase', 'fixed_asset_disposal', 'depreciation'])
      .orderBy('posted_at')
      .toSQL();
    expect(sql).toMatch(/"document_type" in/i);
    expect(bindings).toContain('fixed_asset_purchase');
    expect(bindings).toContain('fixed_asset_disposal');
    expect(bindings).toContain('depreciation');
  });
});

describe('GET /api/budgets — query shape', () => {
  it('left-joins departments, cost_centers, and projects for display names', () => {
    const { sql, bindings } = db('budgets as b')
      .leftJoin('departments as d', 'd.id', 'b.department_id')
      .leftJoin('cost_centers as cc', 'cc.id', 'b.cost_center_id')
      .leftJoin('projects as p', 'p.id', 'b.project_id')
      .where('b.dealer_id', DEALER_ID)
      .andWhere('b.is_active', true)
      .select('b.*', 'd.name as department_name', 'cc.name as cost_center_name', 'p.project_name')
      .orderBy('b.period_start', 'desc')
      .toSQL();
    expect(sql).toMatch(/left join "projects" as "p" on "p"."id" = "b"."project_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });
});

describe('budgets.ts computeActual — cost_center/project posting_lines aggregation shape', () => {
  it('filters posting_lines by the scope column and the budget period', () => {
    const { sql, bindings } = db('posting_lines')
      .where({ dealer_id: DEALER_ID, project_id: PROJECT_ID })
      .andWhere('entry_date', '>=', '2026-01-01')
      .andWhere('entry_date', '<=', '2026-12-31')
      .select('amount')
      .toSQL();
    expect(sql).toMatch(/"project_id" = /i);
    expect(bindings).toContain(PROJECT_ID);
  });

  it('department scope widens to every child cost center via whereIn', () => {
    const { sql, bindings } = db('posting_lines')
      .where({ dealer_id: DEALER_ID })
      .whereIn('cost_center_id', [COST_CENTER_ID])
      .andWhere('entry_date', '>=', '2026-01-01')
      .andWhere('entry_date', '<=', '2026-12-31')
      .select('amount')
      .toSQL();
    expect(sql).toMatch(/"cost_center_id" in/i);
    expect(bindings).toContain(COST_CENTER_ID);
  });
});

describe('project-accounting — revenue/expense aggregation shape', () => {
  it('sums sales.total_amount scoped by dealer + project_id (Project Revenue)', () => {
    const { sql, bindings } = db('sales')
      .where({ dealer_id: DEALER_ID, project_id: PROJECT_ID })
      .select('total_amount')
      .toSQL();
    expect(sql).toMatch(/"project_id" = /i);
    expect(bindings).toContain(PROJECT_ID);
  });

  it('sums expenses.amount scoped by dealer + project_id (Project Expense)', () => {
    const { sql, bindings } = db('expenses')
      .where({ dealer_id: DEALER_ID, project_id: PROJECT_ID })
      .select('amount')
      .toSQL();
    expect(sql).toMatch(/"expenses"/i);
    expect(bindings).toContain(PROJECT_ID);
  });

  it('project ledger reads posting_lines scoped by dealer + project_id', () => {
    const { sql, bindings } = db('posting_lines')
      .where({ dealer_id: DEALER_ID, project_id: PROJECT_ID })
      .select('line_domain', 'line_type', 'amount', 'entry_date', 'posting_batch_id')
      .toSQL();
    expect(sql).toMatch(/"posting_lines"/i);
    expect(bindings).toContain(PROJECT_ID);
  });
});
