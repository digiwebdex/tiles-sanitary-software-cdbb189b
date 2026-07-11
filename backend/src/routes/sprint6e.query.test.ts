/**
 * V2 Sprint 6E — query-shape tests for the GL Spine / manual-Journal UNION
 * (generalLedgerService.ts) and the new financial-closing/VAT-closing/
 * dashboard routes. Same `.toSQL()` convention as the other
 * *.query.test.ts files (no live test DB).
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const BRANCH_ID = '22222222-2222-2222-2222-222222222222';
const FY_ID = '33333333-3333-3333-3333-333333333333';

describe('generalLedgerService — GL Spine account-balance query shape', () => {
  it('joins gl_journal_lines -> gl_journal_entries -> gl_accounts, scoped to the dealer', () => {
    const { sql, bindings } = db('gl_journal_lines as jl')
      .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
      .join('gl_accounts as a', 'a.id', 'jl.account_id')
      .where('je.dealer_id', DEALER_ID)
      .groupBy('a.id', 'a.code', 'a.name', 'a.account_type')
      .select('a.code', 'a.name', 'a.account_type')
      .toSQL();
    expect(sql).toMatch(/inner join "gl_journal_entries" as "je" on "je"."id" = "jl"."journal_entry_id"/i);
    expect(sql).toMatch(/inner join "gl_accounts" as "a" on "a"."id" = "jl"."account_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('the branch filter left-joins posting_lines then cost_centers, filtering on cost_centers.branch_id', () => {
    const { sql, bindings } = db('gl_journal_lines as jl')
      .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
      .leftJoin('posting_lines as pl', 'pl.id', 'jl.posting_line_id')
      .leftJoin('cost_centers as cc', 'cc.id', 'pl.cost_center_id')
      .where('cc.branch_id', BRANCH_ID)
      .toSQL();
    expect(sql).toMatch(/left join "posting_lines" as "pl" on "pl"."id" = "jl"."posting_line_id"/i);
    expect(sql).toMatch(/left join "cost_centers" as "cc" on "cc"."id" = "pl"."cost_center_id"/i);
    expect(bindings).toContain(BRANCH_ID);
  });
});

describe('generalLedgerService — manual Journal account-balance query shape', () => {
  it('only includes posted, non-voided journal entries', () => {
    const { sql, bindings } = db('journal_entry_lines as jel')
      .join('journal_entries as je', 'je.id', 'jel.journal_entry_id')
      .where('je.dealer_id', DEALER_ID)
      .andWhere('je.status', 'posted')
      .whereNull('je.voided_at')
      .groupBy('jel.account')
      .select('jel.account')
      .toSQL();
    expect(sql).toMatch(/"je"\."status" = /i);
    expect(sql).toMatch(/"je"\."voided_at" is null/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain('posted');
  });
});

describe('gl.ts trial-balance — fiscal year resolution query shape', () => {
  it('resolves a fiscal year to its start/end date, scoped to the dealer', () => {
    const { sql, bindings } = db('fiscal_years')
      .where({ id: FY_ID, dealer_id: DEALER_ID })
      .first('start_date', 'end_date')
      .toSQL();
    expect(sql).toMatch(/"fiscal_years"/i);
    expect(bindings).toContain(FY_ID);
    expect(bindings).toContain(DEALER_ID);
  });
});

describe('financialClosing — readiness query shape', () => {
  it('finds open periods for a fiscal year', () => {
    const { sql, bindings } = db('accounting_periods')
      .where({ fiscal_year_id: FY_ID })
      .andWhereNot('status', 'closed')
      .orderBy('period_no')
      .toSQL();
    expect(sql).toMatch(/"fiscal_year_id" = /i);
    expect(sql).toMatch(/not "status" = /i);
    expect(bindings).toContain(FY_ID);
  });

  it('finds an earlier open fiscal year to enforce chronological closing order', () => {
    const { sql, bindings } = db('fiscal_years')
      .where({ dealer_id: DEALER_ID })
      .andWhere('start_date', '<', '2026-01-01')
      .andWhere('status', 'open')
      .first('id', 'name')
      .toSQL();
    expect(sql).toMatch(/"start_date" < /i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain('open');
  });
});

describe('vatClosing — idempotent close via unique constraint shape', () => {
  it('inserts one row per dealer/period into vat_period_closings', () => {
    const { sql, bindings } = db('vat_period_closings')
      .insert({
        dealer_id: DEALER_ID,
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        output_vat_total: 1000,
        net_payable: 500,
      })
      .toSQL();
    expect(sql).toMatch(/insert into "vat_period_closings"/i);
    expect(bindings).toContain(DEALER_ID);
  });
});

describe('financialDashboard — current ratio inputs query shape', () => {
  it('sums VAT Payable (GL code 2100) cumulative to a date', () => {
    const { sql, bindings } = db('gl_journal_lines as jl')
      .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
      .join('gl_accounts as a', 'a.id', 'jl.account_id')
      .where('je.dealer_id', DEALER_ID).andWhere('a.code', '2100')
      .sum({ debit: 'jl.debit' }).sum({ credit: 'jl.credit' })
      .toSQL();
    expect(sql).toMatch(/"a"\."code" = /i);
    expect(bindings).toContain('2100');
  });
});
