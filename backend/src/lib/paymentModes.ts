/**
 * Phase 5 (P5-06) — Bangladesh payment channels for receipts & postings.
 */
export const PAYMENT_MODES = [
  { id: 'cash', label: 'Cash', labelBn: 'নগদ' },
  { id: 'bank', label: 'Bank Transfer', labelBn: 'ব্যাংক' },
  { id: 'bkash', label: 'bKash', labelBn: 'বিকাশ' },
  { id: 'nagad', label: 'Nagad', labelBn: 'নগদ (MFS)' },
  { id: 'sslcommerz', label: 'SSLCommerz', labelBn: 'SSLCommerz' },
  { id: 'cheque', label: 'Cheque', labelBn: 'চেক' },
  { id: 'card', label: 'Card', labelBn: 'কার্ড' },
] as const;

export type PaymentModeId = (typeof PAYMENT_MODES)[number]['id'];

const MODE_SET = new Set<string>(PAYMENT_MODES.map((m) => m.id));

const ALIASES: Record<string, PaymentModeId> = {
  mobile_banking: 'bkash',
  mbanking: 'bkash',
  mfs: 'bkash',
  ssl_commerz: 'sslcommerz',
  sslcommerz: 'sslcommerz',
  ssmcommerz: 'sslcommerz',
  ssl: 'sslcommerz',
};

export function normalizePaymentMode(raw?: string | null): PaymentModeId | null {
  if (!raw?.trim()) return null;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (ALIASES[v]) return ALIASES[v];
  if (MODE_SET.has(v)) return v as PaymentModeId;
  return null;
}

export function paymentModeLabel(id: PaymentModeId | null | undefined): string {
  if (!id) return 'Cash';
  return PAYMENT_MODES.find((m) => m.id === id)?.label ?? id;
}

export function paymentModeRequiresBankAccount(id: PaymentModeId | null | undefined): boolean {
  return id === 'bank' || id === 'cheque' || id === 'card';
}

/** Posting line_type suffix for mobile / gateway channels (P5-06). */
export function receiptPostingLineType(
  base: 'receipt' | 'payment',
  mode: PaymentModeId | null | undefined,
): string {
  if (mode === 'bkash') return `${base}_bkash`;
  if (mode === 'nagad') return `${base}_nagad`;
  if (mode === 'sslcommerz') return `${base}_sslcommerz`;
  return base;
}

export function formatReceiptDescription(base: string, mode: PaymentModeId | null): string {
  if (!mode || mode === 'cash') return base;
  const label = paymentModeLabel(mode);
  if (base.toLowerCase().includes(label.toLowerCase())) return base;
  return `[${label}] ${base}`;
}

export const PAYMENT_MODE_IDS = PAYMENT_MODES.map((m) => m.id);
