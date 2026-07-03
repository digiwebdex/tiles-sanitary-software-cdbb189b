import { describe, expect, it } from 'vitest';
import { GL_CODES } from '../../lib/glChart';
import { balanceGlDrafts, mapPostingLineToGl, mapPostingLinesToGl } from './glLineMapper';

describe('glLineMapper', () => {
  it('maps customer sale to AR debit and sales credit', () => {
    const drafts = mapPostingLineToGl({
      id: 'pl1',
      line_domain: 'customer',
      line_type: 'sale',
      amount: 1000,
    });
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ accountCode: GL_CODES.AR, debit: 1000, credit: 0 });
    expect(drafts[1]).toMatchObject({ accountCode: GL_CODES.SALES, debit: 0, credit: 1000 });
  });

  it('maps supplier purchase to inventory debit and AP credit', () => {
    const drafts = mapPostingLineToGl({
      id: 'pl2',
      line_domain: 'supplier',
      line_type: 'purchase',
      amount: -5000,
    });
    expect(drafts[0]).toMatchObject({ accountCode: GL_CODES.INVENTORY, debit: 5000 });
    expect(drafts[1]).toMatchObject({ accountCode: GL_CODES.AP, credit: 5000 });
  });

  it('balances cash receipt against AR payment in a batch', () => {
    const drafts = mapPostingLinesToGl([
      { id: 'a', line_domain: 'customer', line_type: 'sale', amount: 1000 },
      { id: 'b', line_domain: 'customer', line_type: 'payment', amount: 400 },
      { id: 'c', line_domain: 'cash', line_type: 'receipt', amount: 400 },
    ]);
    const debit = drafts.reduce((s, d) => s + d.debit, 0);
    const credit = drafts.reduce((s, d) => s + d.credit, 0);
    expect(debit).toBe(credit);
  });

  it('adds clearing line when batch is unbalanced', () => {
    const balanced = balanceGlDrafts([
      { accountCode: GL_CODES.CASH, debit: 100, credit: 0, postingLineId: 'x' },
    ]);
    expect(balanced).toHaveLength(2);
    expect(balanced[1].accountCode).toBe(GL_CODES.CLEARING);
    expect(balanced[1].credit).toBe(100);
  });
});
