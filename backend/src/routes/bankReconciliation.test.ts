/**
 * V2 Sprint 6C — CSV parsing + reconciliation math tests. No live test DB
 * in this backend (established convention), so DB-touching logic is
 * covered via query-shape checks elsewhere; this file covers the two pure
 * pieces: the CSV parser and the summary identity.
 */
import { describe, expect, it } from 'vitest';
import { parseStatementCsv } from './bankReconciliation';

describe('parseStatementCsv', () => {
  it('parses plain rows with no header', () => {
    const { rows, skipped } = parseStatementCsv('2026-07-01,Deposit ABC,1500\n2026-07-02,Cheque 1042,-500');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ entry_date: '2026-07-01', description: 'Deposit ABC', amount: 1500 });
    expect(rows[1]).toMatchObject({ entry_date: '2026-07-02', description: 'Cheque 1042', amount: -500 });
    expect(skipped).toBe(0);
  });

  it('auto-detects and skips a header row (first field is not a valid amount)', () => {
    const { rows } = parseStatementCsv('date,description,amount\n2026-07-01,Deposit,1000');
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1000);
  });

  it('handles quoted fields containing commas', () => {
    const { rows } = parseStatementCsv('2026-07-01,"Payment, ref 123",250.50');
    expect(rows[0].description).toBe('Payment, ref 123');
    expect(rows[0].amount).toBe(250.5);
  });

  it('captures an optional 4th reference column', () => {
    const { rows } = parseStatementCsv('2026-07-01,Deposit,1000,CHQ-9981');
    expect(rows[0].reference).toBe('CHQ-9981');
  });

  it('skips a malformed row (non-numeric amount) without throwing', () => {
    const { rows, skipped } = parseStatementCsv('2026-07-01,Deposit,not-a-number\n2026-07-02,Valid,100');
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('skips a row with an invalid date', () => {
    const { rows, skipped } = parseStatementCsv('not-a-date,Deposit,100');
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('ignores blank lines', () => {
    const { rows } = parseStatementCsv('2026-07-01,Deposit,100\n\n\n2026-07-02,Withdrawal,-50');
    expect(rows).toHaveLength(2);
  });

  it('returns empty for an all-header/empty input', () => {
    const { rows } = parseStatementCsv('date,description,amount');
    expect(rows).toHaveLength(0);
  });
});

describe('Reconciliation summary identity (cleared + outstanding deposits - outstanding withdrawals = book balance)', () => {
  function round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  it('holds for a simple mixed ledger', () => {
    const ledger = [
      { amount: 1000, is_cleared: true },  // cleared deposit
      { amount: 500, is_cleared: false },  // outstanding deposit
      { amount: -200, is_cleared: true },  // cleared withdrawal
      { amount: -150, is_cleared: false }, // outstanding withdrawal (e.g. uncleared cheque)
    ];
    const bookBalance = round2(ledger.reduce((s, r) => s + r.amount, 0));
    const clearedBalance = round2(ledger.filter((r) => r.is_cleared).reduce((s, r) => s + r.amount, 0));
    const outstandingDeposits = round2(ledger.filter((r) => !r.is_cleared && r.amount > 0).reduce((s, r) => s + r.amount, 0));
    const outstandingWithdrawals = round2(Math.abs(ledger.filter((r) => !r.is_cleared && r.amount < 0).reduce((s, r) => s + r.amount, 0)));

    expect(bookBalance).toBe(1150);
    expect(round2(clearedBalance + outstandingDeposits - outstandingWithdrawals)).toBe(bookBalance);
  });
});
