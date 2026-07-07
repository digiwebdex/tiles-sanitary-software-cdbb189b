import { describe, expect, it } from 'vitest';
import { GL_CODES } from '../../lib/glChart';
import { balanceGlDrafts, mapPostingLineToGl, mapPostingLinesToGl } from './glLineMapper';

describe('glLineMapper — customer/sale (Bug A: VAT split)', () => {
  it('maps a sale with no VAT to a plain AR debit / Sales credit pair', () => {
    const drafts = mapPostingLineToGl({ id: 'pl1', line_domain: 'customer', line_type: 'sale', amount: 1000 });
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ accountCode: GL_CODES.AR, debit: 1000, credit: 0 });
    expect(drafts[1]).toMatchObject({ accountCode: GL_CODES.SALES, debit: 0, credit: 1000 });
  });

  it('splits a VAT-inclusive sale into AR-gross / Sales-taxable / VAT-Payable-tax (Bug A fix)', () => {
    // 1000 taxable + 150 VAT = 1150 gross, matching the exact worked example from the architecture doc.
    const drafts = mapPostingLineToGl(
      { id: 'pl1', line_domain: 'customer', line_type: 'sale', amount: 1150 },
      { taxAmount: 150, sdAmount: 0 },
    );
    expect(drafts).toHaveLength(3);
    expect(drafts.find((d) => d.accountCode === GL_CODES.AR)).toMatchObject({ debit: 1150, credit: 0 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.SALES)).toMatchObject({ debit: 0, credit: 1000 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.VAT_PAYABLE)).toMatchObject({ debit: 0, credit: 150 });
    // Sanity: the split must still balance on its own (before any batch-level cash/bank line).
    const debit = drafts.reduce((s, d) => s + d.debit, 0);
    const credit = drafts.reduce((s, d) => s + d.credit, 0);
    expect(debit).toBe(credit);
  });

  it('includes SD alongside VAT in the tax portion credited to VAT Payable', () => {
    const drafts = mapPostingLineToGl(
      { id: 'pl1', line_domain: 'customer', line_type: 'sale', amount: 1000 },
      { taxAmount: 100, sdAmount: 50 },
    );
    expect(drafts.find((d) => d.accountCode === GL_CODES.VAT_PAYABLE)).toMatchObject({ credit: 150 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.SALES)).toMatchObject({ credit: 850 });
  });
});

describe('glLineMapper — customer/sale reversal (Bug C: reversed sales previously posted nothing)', () => {
  it('mirrors a plain (no-VAT) sale reversal as credit AR / debit Sales', () => {
    const drafts = mapPostingLineToGl({ id: 'pl1', line_domain: 'customer', line_type: 'sale', amount: -1000 });
    expect(drafts).toHaveLength(2);
    expect(drafts.find((d) => d.accountCode === GL_CODES.AR)).toMatchObject({ debit: 0, credit: 1000 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.SALES)).toMatchObject({ debit: 1000, credit: 0 });
  });

  it('mirrors a VAT-inclusive sale reversal fully, including reversing VAT Payable', () => {
    const drafts = mapPostingLineToGl(
      { id: 'pl1', line_domain: 'customer', line_type: 'sale', amount: -1150 },
      { taxAmount: 150, sdAmount: 0 },
    );
    expect(drafts.find((d) => d.accountCode === GL_CODES.AR)).toMatchObject({ debit: 0, credit: 1150 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.SALES)).toMatchObject({ debit: 1000, credit: 0 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.VAT_PAYABLE)).toMatchObject({ debit: 150, credit: 0 });
    const debit = drafts.reduce((s, d) => s + d.debit, 0);
    const credit = drafts.reduce((s, d) => s + d.credit, 0);
    expect(debit).toBe(credit);
  });
});

describe('glLineMapper — supplier/purchase + reversal', () => {
  it('maps supplier purchase to inventory debit and AP credit', () => {
    const drafts = mapPostingLineToGl({ id: 'pl2', line_domain: 'supplier', line_type: 'purchase', amount: -5000 });
    expect(drafts[0]).toMatchObject({ accountCode: GL_CODES.INVENTORY, debit: 5000 });
    expect(drafts[1]).toMatchObject({ accountCode: GL_CODES.AP, credit: 5000 });
  });

  it('mirrors a purchase reversal as credit Inventory / debit AP (Bug C, purchase side)', () => {
    const drafts = mapPostingLineToGl({ id: 'pl2', line_domain: 'supplier', line_type: 'purchase', amount: 5000 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.INVENTORY)).toMatchObject({ debit: 0, credit: 5000 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.AP)).toMatchObject({ debit: 5000, credit: 0 });
  });
});

describe('glLineMapper — stock domain (Bug B: sale_out sign, Bug D: purchase_in double-count)', () => {
  it('maps a sale_out (positive cogsAmount) to debit COGS / credit Inventory, not the purchase-receipt shape', () => {
    const drafts = mapPostingLineToGl({ id: 'pl3', line_domain: 'stock', line_type: 'sale_out', amount: 400 });
    expect(drafts).toHaveLength(2);
    expect(drafts.find((d) => d.accountCode === GL_CODES.COGS)).toMatchObject({ debit: 400, credit: 0 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.INVENTORY)).toMatchObject({ debit: 0, credit: 400 });
  });

  it('mirrors a reversed sale_out (negative amount) as credit COGS / debit Inventory', () => {
    const drafts = mapPostingLineToGl({ id: 'pl3', line_domain: 'stock', line_type: 'sale_out', amount: -400 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.COGS)).toMatchObject({ debit: 0, credit: 400 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.INVENTORY)).toMatchObject({ debit: 400, credit: 0 });
  });

  it('produces ZERO GL lines for purchase_in (Bug D fix — supplier/purchase already covers the Inventory effect in the same batch)', () => {
    const drafts = mapPostingLineToGl({ id: 'pl4', line_domain: 'stock', line_type: 'purchase_in', amount: 5000 });
    expect(drafts).toHaveLength(0);
  });

  it('a full purchase batch (stock/purchase_in + supplier/purchase) posts Inventory exactly once, not twice', () => {
    const { drafts } = mapPostingLinesToGl([
      { id: 'a', line_domain: 'stock', line_type: 'purchase_in', amount: 5000 },
      { id: 'b', line_domain: 'supplier', line_type: 'purchase', amount: -5000 },
    ]);
    const inventoryDebits = drafts.filter((d) => d.accountCode === GL_CODES.INVENTORY);
    expect(inventoryDebits).toHaveLength(1);
    expect(inventoryDebits[0].debit).toBe(5000);
  });
});

describe('glLineMapper — cash/bank/expense (unchanged, re-verified)', () => {
  it('balances cash receipt against AR payment in a batch', () => {
    const { drafts } = mapPostingLinesToGl([
      { id: 'a', line_domain: 'customer', line_type: 'sale', amount: 1000 },
      { id: 'b', line_domain: 'customer', line_type: 'payment', amount: 400 },
      { id: 'c', line_domain: 'cash', line_type: 'receipt', amount: 400 },
    ]);
    const debit = drafts.reduce((s, d) => s + d.debit, 0);
    const credit = drafts.reduce((s, d) => s + d.credit, 0);
    expect(debit).toBe(credit);
  });

  it('maps an expense to debit Expense / credit Clearing', () => {
    const drafts = mapPostingLineToGl({ id: 'pl5', line_domain: 'expense', line_type: 'expense', amount: -200 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.EXPENSE)).toMatchObject({ debit: 200, credit: 0 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.CLEARING)).toMatchObject({ debit: 0, credit: 200 });
  });
});

describe('glLineMapper — opening_balance (V2 Sprint 6B)', () => {
  it('maps a positive customer opening balance to debit AR / credit Opening Balance Equity', () => {
    const drafts = mapPostingLineToGl({ id: 'ob1', line_domain: 'customer', line_type: 'opening_balance', amount: 5000 });
    expect(drafts).toHaveLength(2);
    expect(drafts.find((d) => d.accountCode === GL_CODES.AR)).toMatchObject({ debit: 5000, credit: 0 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.OPENING_BALANCE_EQUITY)).toMatchObject({ debit: 0, credit: 5000 });
  });

  it('maps a negative customer opening balance (credit balance) as the exact mirror', () => {
    const drafts = mapPostingLineToGl({ id: 'ob2', line_domain: 'customer', line_type: 'opening_balance', amount: -1200 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.AR)).toMatchObject({ debit: 0, credit: 1200 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.OPENING_BALANCE_EQUITY)).toMatchObject({ debit: 1200, credit: 0 });
  });

  it('maps a supplier opening balance (negative amount = we owe more, matching the purchase convention) to debit Opening Balance Equity / credit AP', () => {
    const drafts = mapPostingLineToGl({ id: 'ob3', line_domain: 'supplier', line_type: 'opening_balance', amount: -3000 });
    expect(drafts).toHaveLength(2);
    expect(drafts.find((d) => d.accountCode === GL_CODES.OPENING_BALANCE_EQUITY)).toMatchObject({ debit: 3000, credit: 0 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.AP)).toMatchObject({ debit: 0, credit: 3000 });
  });

  it('maps a positive supplier opening balance (credit in our favor) as the exact mirror', () => {
    const drafts = mapPostingLineToGl({ id: 'ob4', line_domain: 'supplier', line_type: 'opening_balance', amount: 800 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.OPENING_BALANCE_EQUITY)).toMatchObject({ debit: 0, credit: 800 });
    expect(drafts.find((d) => d.accountCode === GL_CODES.AP)).toMatchObject({ debit: 800, credit: 0 });
  });

  it('each opening_balance draft pair is independently balanced (no Clearing plug needed)', () => {
    const { wasUnbalanced } = mapPostingLinesToGl([
      { id: 'ob5', line_domain: 'customer', line_type: 'opening_balance', amount: 2500 },
    ]);
    expect(wasUnbalanced).toBe(false);
  });
});

describe('balanceGlDrafts — posting validation', () => {
  it('adds a clearing line and flags wasUnbalanced when a batch is unbalanced', () => {
    const result = balanceGlDrafts([
      { accountCode: GL_CODES.CASH, debit: 100, credit: 0, postingLineId: 'x' },
    ]);
    expect(result.wasUnbalanced).toBe(true);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[1].accountCode).toBe(GL_CODES.CLEARING);
    expect(result.drafts[1].credit).toBe(100);
  });

  it('does not flag wasUnbalanced or add a clearing line when a batch already balances', () => {
    const result = balanceGlDrafts([
      { accountCode: GL_CODES.CASH, debit: 100, credit: 0, postingLineId: 'x' },
      { accountCode: GL_CODES.AR, debit: 0, credit: 100, postingLineId: 'y' },
    ]);
    expect(result.wasUnbalanced).toBe(false);
    expect(result.drafts).toHaveLength(2);
  });

  it('a fully-fixed sale batch (customer/sale + stock/sale_out + cash) balances with no Clearing plug', () => {
    const { wasUnbalanced } = mapPostingLinesToGl(
      [
        { id: 'a', line_domain: 'customer', line_type: 'sale', amount: 1150 },
        { id: 'b', line_domain: 'stock', line_type: 'sale_out', amount: 400 },
        { id: 'c', line_domain: 'customer', line_type: 'payment', amount: 1150 },
        { id: 'd', line_domain: 'cash', line_type: 'receipt', amount: 1150 },
      ],
      { taxAmount: 150, sdAmount: 0 },
    );
    expect(wasUnbalanced).toBe(false);
  });
});
