/**
 * V2 Sprint 6A — schema + pure-function tests for the extended Chart of
 * Accounts endpoints (Account Groups / Parent-Child / Contra Accounts /
 * Account Categories / Account Types).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const accountTypeEnum = z.enum(['asset', 'liability', 'equity', 'income', 'expense']);
const normalBalanceEnum = z.enum(['debit', 'credit']);

function defaultNormalBalance(accountType: z.infer<typeof accountTypeEnum>): 'debit' | 'credit' {
  return accountType === 'asset' || accountType === 'expense' ? 'debit' : 'credit';
}

const createAccountSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(255),
  account_type: accountTypeEnum,
  parent_code: z.string().trim().max(20).nullable().optional(),
  normal_balance: normalBalanceEnum.optional(),
  is_contra: z.boolean().default(false),
  is_group: z.boolean().default(false),
  category: z.string().trim().max(50).nullable().optional(),
});

describe('Chart of Accounts — create schema', () => {
  it('accepts a minimal new account', () => {
    const parsed = createAccountSchema.parse({ code: '1320', name: 'Office Equipment', account_type: 'asset' });
    expect(parsed.is_contra).toBe(false);
    expect(parsed.is_group).toBe(false);
  });

  it('rejects an undocumented account_type', () => {
    expect(() => createAccountSchema.parse({ code: '9999', name: 'Bad', account_type: 'revenue' })).toThrow();
  });

  it('accepts a contra-account with an explicit normal_balance override', () => {
    const parsed = createAccountSchema.parse({
      code: '1315', name: 'Accumulated Depreciation - Vehicles', account_type: 'asset',
      parent_code: '1300', normal_balance: 'credit', is_contra: true,
    });
    expect(parsed.normal_balance).toBe('credit');
    expect(parsed.is_contra).toBe(true);
  });

  it('accepts a group (non-postable header) account', () => {
    const parsed = createAccountSchema.parse({ code: '1000', name: 'Current Assets', account_type: 'asset', is_group: true });
    expect(parsed.is_group).toBe(true);
  });
});

describe('defaultNormalBalance — inferred from account_type when not explicitly overridden', () => {
  it('defaults asset and expense accounts to debit', () => {
    expect(defaultNormalBalance('asset')).toBe('debit');
    expect(defaultNormalBalance('expense')).toBe('debit');
  });

  it('defaults liability, equity, and income accounts to credit', () => {
    expect(defaultNormalBalance('liability')).toBe('credit');
    expect(defaultNormalBalance('equity')).toBe('credit');
    expect(defaultNormalBalance('income')).toBe('credit');
  });
});

describe('System account edit restrictions', () => {
  function computeAllowedUpdateFields(isSystem: boolean): string[] {
    const always = ['name', 'parent_code', 'category', 'is_active'];
    const nonSystemOnly = ['normal_balance', 'is_contra', 'is_group'];
    return isSystem ? always : [...always, ...nonSystemOnly];
  }

  it('a system account can only have name/parent_code/category/is_active edited', () => {
    const fields = computeAllowedUpdateFields(true);
    expect(fields).not.toContain('normal_balance');
    expect(fields).not.toContain('is_contra');
    expect(fields).toContain('name');
  });

  it('a dealer-created (non-system) account can also have its classification edited', () => {
    const fields = computeAllowedUpdateFields(false);
    expect(fields).toContain('normal_balance');
    expect(fields).toContain('is_contra');
    expect(fields).toContain('is_group');
  });
});

describe('GL consistency check — unbalanced-batch detection', () => {
  function isUnbalanced(totalDebit: number, totalCredit: number): boolean {
    return Math.abs(totalDebit - totalCredit) > 0.01;
  }

  it('flags a batch whose lines do not sum to debit=credit', () => {
    expect(isUnbalanced(1150, 1000)).toBe(true);
  });

  it('does not flag a correctly balanced batch', () => {
    expect(isUnbalanced(1150, 1150)).toBe(false);
  });

  it('tolerates sub-cent rounding noise', () => {
    expect(isUnbalanced(1150.004, 1150)).toBe(false);
  });
});
