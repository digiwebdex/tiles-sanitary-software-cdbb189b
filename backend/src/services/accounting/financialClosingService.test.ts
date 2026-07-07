import { describe, expect, it } from 'vitest';
import { computeClosingLines } from './financialClosingService';

describe('computeClosingLines — Fiscal Year Closing math', () => {
  it('credits Retained Earnings for a net-income year (income exceeds expense)', () => {
    const { lines, retainedEarningsNet } = computeClosingLines([
      { code: '4000', name: 'Sales Revenue', debit: 0, credit: 100000 }, // normal credit balance
      { code: '5000', name: 'Cost of Goods Sold', debit: 60000, credit: 0 }, // normal debit balance
      { code: '5100', name: 'Operating Expenses', debit: 15000, credit: 0 },
    ]);
    // Net income = 100000 - 60000 - 15000 = 25000 -> credited to Retained Earnings.
    expect(retainedEarningsNet).toBe(25000);
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.account.includes('Sales Revenue'))).toMatchObject({ debit: 100000, credit: 0 });
    expect(lines.find((l) => l.account.includes('Cost of Goods Sold'))).toMatchObject({ debit: 0, credit: 60000 });
    expect(lines.find((l) => l.account.includes('Operating Expenses'))).toMatchObject({ debit: 0, credit: 15000 });
  });

  it('debits Retained Earnings for a net-loss year (expense exceeds income)', () => {
    const { lines, retainedEarningsNet } = computeClosingLines([
      { code: '4000', name: 'Sales Revenue', debit: 0, credit: 10000 },
      { code: '5100', name: 'Operating Expenses', debit: 18000, credit: 0 },
    ]);
    expect(retainedEarningsNet).toBe(-8000);
    expect(lines.find((l) => l.account.includes('Sales Revenue'))).toMatchObject({ debit: 10000, credit: 0 });
    expect(lines.find((l) => l.account.includes('Operating Expenses'))).toMatchObject({ debit: 0, credit: 18000 });
  });

  it('skips accounts whose net balance rounds to zero', () => {
    const { lines } = computeClosingLines([
      { code: '4000', name: 'Sales Revenue', debit: 100, credit: 100 },
    ]);
    expect(lines).toHaveLength(0);
  });

  it('returns an empty result for no income/expense activity', () => {
    const { lines, retainedEarningsNet } = computeClosingLines([]);
    expect(lines).toHaveLength(0);
    expect(retainedEarningsNet).toBe(0);
  });

  it('the closing lines plus the Retained Earnings line always balance (debit = credit)', () => {
    const { lines, retainedEarningsNet } = computeClosingLines([
      { code: '4000', name: 'Sales Revenue', debit: 500, credit: 120500 },
      { code: '5000', name: 'Cost of Goods Sold', debit: 70000, credit: 0 },
      { code: '5100', name: 'Operating Expenses', debit: 22000, credit: 300 },
    ]);
    const retainedEarningsLine = {
      debit: retainedEarningsNet < 0 ? Math.abs(retainedEarningsNet) : 0,
      credit: retainedEarningsNet > 0 ? retainedEarningsNet : 0,
    };
    const allLines = [...lines, retainedEarningsLine];
    const totalDebit = allLines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = allLines.reduce((s, l) => s + l.credit, 0);
    expect(Math.round((totalDebit - totalCredit) * 100) / 100).toBe(0);
  });
});
