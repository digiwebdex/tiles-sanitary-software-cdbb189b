import type { PostingLineInput } from './types';
import {
  paymentModeLabel,
  receiptPostingLineType,
  type PaymentModeId,
} from '../../lib/paymentModes';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cashOrBankDomain(paidAccountId?: string | null): 'cash' | 'bank' {
  return paidAccountId ? 'bank' : 'cash';
}

function buildCashOrBankLine(input: {
  paidAccountId?: string | null;
  lineType: string;
  amount: number;
  entryDate: string;
  paymentMode?: PaymentModeId | null;
  metadata?: Record<string, unknown>;
}): PostingLineInput {
  const domain = cashOrBankDomain(input.paidAccountId);
  const baseType = input.lineType as 'receipt' | 'payment';
  const lineType = receiptPostingLineType(baseType, input.paymentMode);
  return {
    lineDomain: domain,
    lineType,
    amount: round2(input.amount),
    entryDate: input.entryDate,
    metadata: {
      ...(input.paidAccountId ? { bank_account_id: input.paidAccountId } : {}),
      ...(input.paymentMode
        ? {
            payment_mode: input.paymentMode,
            payment_channel: paymentModeLabel(input.paymentMode),
          }
        : {}),
      ...input.metadata,
    },
  };
}

/** Ledger effects when a purchase bill is posted. */
export interface PurchaseLedgerPostContext {
  purchaseId: string;
  supplierId: string;
  entryDate: string;
  /** Net payable after voucher discount (matches supplier_ledger purchase row). */
  netPayable: number;
  paidOnCreate?: number;
  paidAccountId?: string | null;
  paymentMode?: PaymentModeId | null;
  description?: string;
  paymentDescription?: string;
}

/** Ledger effects when a sale invoice is posted. */
export interface SaleLedgerPostContext {
  saleId: string;
  customerId: string;
  entryDate: string;
  totalAmount: number;
  paidAmount?: number;
  paidAccountId?: string | null;
  paymentMode?: PaymentModeId | null;
  description?: string;
  paymentDescription?: string;
}

/** Ledger effects from recordCustomerPayment allocations. */
export interface CustomerPaymentLedgerContext {
  customerId: string;
  entryDate: string;
  paidAccountId?: string | null;
  paymentMode?: PaymentModeId | null;
  allocations: Array<{ saleId: string; amount: number; description?: string }>;
  totalApplied: number;
}

/** Ledger effects from recordSupplierPaymentFifo allocations. */
export interface SupplierPaymentLedgerContext {
  supplierId: string;
  entryDate: string;
  paidAccountId?: string | null;
  allocations: Array<{ purchaseId: string; amount: number; description?: string }>;
  totalApplied: number;
}

/**
 * Build ledger posting lines for purchase.posted.
 * Mirrors supplier_ledger purchase/payment + cash/bank outflow on create.
 */
export function buildPurchaseLedgerLines(ctx: PurchaseLedgerPostContext): PostingLineInput[] {
  const lines: PostingLineInput[] = [];
  const netPayable = round2(ctx.netPayable);
  if (netPayable <= 0) return lines;

  lines.push({
    lineDomain: 'supplier',
    lineType: 'purchase',
    amount: -netPayable,
    entryDate: ctx.entryDate,
    partyId: ctx.supplierId,
    purchaseId: ctx.purchaseId,
    metadata: ctx.description ? { description: ctx.description } : {},
  });

  const paid = round2(ctx.paidOnCreate ?? 0);
  if (paid > 0) {
    lines.push({
      lineDomain: 'supplier',
      lineType: 'payment',
      amount: paid,
      entryDate: ctx.entryDate,
      partyId: ctx.supplierId,
      purchaseId: ctx.purchaseId,
      metadata: ctx.paymentDescription ? { description: ctx.paymentDescription } : {},
    });

    lines.push(
      buildCashOrBankLine({
        paidAccountId: ctx.paidAccountId,
        lineType: 'payment',
        amount: -paid,
        entryDate: ctx.entryDate,
        paymentMode: ctx.paymentMode,
        metadata: {
          reference_type: 'purchases',
          reference_id: ctx.purchaseId,
          ...(ctx.paymentDescription ? { description: ctx.paymentDescription } : {}),
        },
      }),
    );
  }

  return lines;
}

/**
 * Build ledger posting lines for sale.posted.
 * Mirrors customer_ledger sale/payment + cash/bank receipt on create.
 */
export function buildSaleLedgerLines(ctx: SaleLedgerPostContext): PostingLineInput[] {
  const lines: PostingLineInput[] = [];
  const total = round2(ctx.totalAmount);
  if (total <= 0) return lines;

  lines.push({
    lineDomain: 'customer',
    lineType: 'sale',
    amount: total,
    entryDate: ctx.entryDate,
    partyId: ctx.customerId,
    saleId: ctx.saleId,
    metadata: ctx.description ? { description: ctx.description } : {},
  });

  const paid = round2(ctx.paidAmount ?? 0);
  if (paid > 0) {
    lines.push({
      lineDomain: 'customer',
      lineType: 'payment',
      amount: paid,
      entryDate: ctx.entryDate,
      partyId: ctx.customerId,
      saleId: ctx.saleId,
      metadata: ctx.paymentDescription ? { description: ctx.paymentDescription } : {},
    });

    lines.push(
      buildCashOrBankLine({
        paidAccountId: ctx.paidAccountId,
        lineType: 'receipt',
        amount: paid,
        entryDate: ctx.entryDate,
        paymentMode: ctx.paymentMode,
        metadata: {
          reference_type: 'sales',
          reference_id: ctx.saleId,
          ...(ctx.paymentDescription ? { description: ctx.paymentDescription } : {}),
        },
      }),
    );
  }

  return lines;
}

/**
 * Build ledger posting lines for a customer collection payment.
 * Mirrors recordCustomerPayment: one customer line per allocation + one receipt.
 */
export function buildCustomerPaymentLines(ctx: CustomerPaymentLedgerContext): PostingLineInput[] {
  const lines: PostingLineInput[] = [];

  for (const alloc of ctx.allocations) {
    if (!(alloc.amount > 0)) continue;
    lines.push({
      lineDomain: 'customer',
      lineType: 'payment',
      amount: round2(alloc.amount),
      entryDate: ctx.entryDate,
      partyId: ctx.customerId,
      saleId: alloc.saleId,
      metadata: alloc.description ? { description: alloc.description } : {},
    });
  }

  if (ctx.totalApplied > 0) {
    lines.push(
      buildCashOrBankLine({
        paidAccountId: ctx.paidAccountId,
        lineType: 'receipt',
        amount: ctx.totalApplied,
        entryDate: ctx.entryDate,
        paymentMode: ctx.paymentMode,
        metadata: {
          reference_type: 'customer_payment',
          reference_id: ctx.allocations[0]?.saleId ?? null,
        },
      }),
    );
  }

  return lines;
}

/**
 * Build ledger posting lines for a supplier bill payment.
 * Mirrors recordSupplierPaymentFifo: one supplier line per allocation + one outflow.
 */
export function buildSupplierPaymentLines(ctx: SupplierPaymentLedgerContext): PostingLineInput[] {
  const lines: PostingLineInput[] = [];

  for (const alloc of ctx.allocations) {
    if (!(alloc.amount > 0)) continue;
    lines.push({
      lineDomain: 'supplier',
      lineType: 'payment',
      amount: round2(alloc.amount),
      entryDate: ctx.entryDate,
      partyId: ctx.supplierId,
      purchaseId: alloc.purchaseId,
      metadata: alloc.description ? { description: alloc.description } : {},
    });
  }

  if (ctx.totalApplied > 0) {
    lines.push(
      buildCashOrBankLine({
        paidAccountId: ctx.paidAccountId,
        lineType: 'payment',
        amount: -ctx.totalApplied,
        entryDate: ctx.entryDate,
        metadata: {
          reference_type: 'purchases',
          reference_id: ctx.allocations[0]?.purchaseId ?? null,
        },
      }),
    );
  }

  return lines;
}
