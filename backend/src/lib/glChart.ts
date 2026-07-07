/**
 * Default chart of accounts for Bangladesh tiles dealers (P6-01, extended
 * V2 Sprint 6A per the approved docs/ACCOUNTING_V2_ARCHITECTURE.md Rev 2).
 *
 * `normal_balance` lets a contra-asset (Accumulated Depreciation) live under
 * account_type='asset' while correctly carrying a natural credit balance —
 * a Balance Sheet renderer must net `is_contra` asset rows against the rest
 * rather than summing account_type='asset' blindly (not built this sprint;
 * Trial Balance/Balance Sheet are explicitly out of scope for 6A, but the
 * chart is seeded correctly now so later sprints don't need a migration).
 *
 * 1300/1310/2200/3100/6000 are seeded now (Account Foundation work) even
 * though the features that post to them (Fixed Assets/Depreciation, Input
 * VAT Recovery) are deferred to Sprint 6D/6E — this avoids a second
 * chart-seeding migration later.
 */
export type GlAccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type GlNormalBalance = 'debit' | 'credit';

export interface GlAccountTemplate {
  code: string;
  name: string;
  account_type: GlAccountType;
  parent_code?: string;
  normal_balance: GlNormalBalance;
  is_contra?: boolean;
  is_group?: boolean;
  category?: string;
}

export const DEFAULT_GL_CHART: GlAccountTemplate[] = [
  { code: '1000', name: 'Cash in Hand', account_type: 'asset', normal_balance: 'debit', category: 'current_asset' },
  { code: '1010', name: 'Bank Accounts', account_type: 'asset', normal_balance: 'debit', category: 'current_asset' },
  { code: '1100', name: 'Accounts Receivable', account_type: 'asset', normal_balance: 'debit', category: 'current_asset' },
  { code: '1200', name: 'Inventory', account_type: 'asset', normal_balance: 'debit', category: 'current_asset' },
  { code: '1300', name: 'Fixed Assets', account_type: 'asset', normal_balance: 'debit', category: 'fixed_asset' },
  { code: '1310', name: 'Accumulated Depreciation', account_type: 'asset', parent_code: '1300', normal_balance: 'credit', is_contra: true, category: 'fixed_asset' },
  { code: '2000', name: 'Accounts Payable', account_type: 'liability', normal_balance: 'credit', category: 'current_liability' },
  { code: '2100', name: 'VAT Payable', account_type: 'liability', normal_balance: 'credit', category: 'current_liability' },
  { code: '2200', name: 'VAT Receivable / Input VAT', account_type: 'asset', normal_balance: 'debit', category: 'current_asset' },
  { code: '3000', name: 'Owner Equity', account_type: 'equity', normal_balance: 'credit', category: 'capital' },
  { code: '3100', name: 'Retained Earnings', account_type: 'equity', normal_balance: 'credit', category: 'retained_earnings' },
  { code: '4000', name: 'Sales Revenue', account_type: 'income', normal_balance: 'credit', category: 'operating_revenue' },
  { code: '5000', name: 'Cost of Goods Sold', account_type: 'expense', normal_balance: 'debit', category: 'cogs' },
  { code: '5100', name: 'Operating Expenses', account_type: 'expense', normal_balance: 'debit', category: 'operating_expense' },
  { code: '5900', name: 'GL Clearing / Suspense', account_type: 'asset', normal_balance: 'debit', category: 'other_asset' },
  { code: '6000', name: 'Depreciation Expense', account_type: 'expense', normal_balance: 'debit', category: 'operating_expense' },
  { code: '6100', name: 'Bad Debt Expense', account_type: 'expense', normal_balance: 'debit', category: 'operating_expense' },
];

/** Standard account codes referenced by the posting mapper. */
export const GL_CODES = {
  CASH: '1000',
  BANK: '1010',
  AR: '1100',
  INVENTORY: '1200',
  FIXED_ASSETS: '1300',
  ACCUMULATED_DEPRECIATION: '1310',
  AP: '2000',
  VAT_PAYABLE: '2100',
  VAT_RECEIVABLE: '2200',
  EQUITY: '3000',
  RETAINED_EARNINGS: '3100',
  SALES: '4000',
  COGS: '5000',
  EXPENSE: '5100',
  CLEARING: '5900',
  DEPRECIATION_EXPENSE: '6000',
  BAD_DEBT_EXPENSE: '6100',
} as const;
