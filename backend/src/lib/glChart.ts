/**
 * Default chart of accounts for Bangladesh tiles dealers (P6-01).
 */
export type GlAccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface GlAccountTemplate {
  code: string;
  name: string;
  account_type: GlAccountType;
  parent_code?: string;
}

export const DEFAULT_GL_CHART: GlAccountTemplate[] = [
  { code: '1000', name: 'Cash in Hand', account_type: 'asset' },
  { code: '1010', name: 'Bank Accounts', account_type: 'asset' },
  { code: '1100', name: 'Accounts Receivable', account_type: 'asset' },
  { code: '1200', name: 'Inventory', account_type: 'asset' },
  { code: '2000', name: 'Accounts Payable', account_type: 'liability' },
  { code: '2100', name: 'VAT Payable', account_type: 'liability' },
  { code: '3000', name: 'Owner Equity', account_type: 'equity' },
  { code: '4000', name: 'Sales Revenue', account_type: 'income' },
  { code: '5000', name: 'Cost of Goods Sold', account_type: 'expense' },
  { code: '5100', name: 'Operating Expenses', account_type: 'expense' },
  { code: '5900', name: 'GL Clearing / Suspense', account_type: 'asset' },
];

/** Standard account codes referenced by the posting mapper. */
export const GL_CODES = {
  CASH: '1000',
  BANK: '1010',
  AR: '1100',
  INVENTORY: '1200',
  AP: '2000',
  VAT_PAYABLE: '2100',
  SALES: '4000',
  COGS: '5000',
  EXPENSE: '5100',
  CLEARING: '5900',
} as const;
