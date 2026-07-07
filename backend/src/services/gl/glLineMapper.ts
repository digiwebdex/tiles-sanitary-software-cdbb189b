/**
 * Map posting_lines money effects → balanced GL journal lines (P6-01,
 * corrected V2 Sprint 6A per the approved docs/ACCOUNTING_V2_ARCHITECTURE.md
 * Rev 2 / docs/ACCOUNTING_REVIEW_RESPONSE.md).
 *
 * Four bugs fixed this sprint (none required touching Sales/Purchase route
 * files — all four live entirely within this GL-mirroring layer):
 *
 * Bug A — the `tax` line_domain was dead: nothing ever constructs a
 * posting_lines row with line_domain='tax' (VAT flows through the separate
 * `tax_posting_lines` table instead), so VAT never reached the GL and Sales
 * Revenue was overstated by the VAT-inclusive gross. Fixed by having the
 * caller (`glJournalWriter.mirrorPostingBatchToGl`) look up the matching
 * `tax_posting_lines` row and pass it in as `taxSplit` — this file no longer
 * has a `tax` domain case at all (retired, not "fixed in place", per the
 * approved architecture's explicit recommendation to source VAT from
 * tax_posting_lines directly rather than duplicate VAT computation into a
 * second code path).
 *
 * Bug B — the `stock` domain branched on numeric sign alone, so a sale's
 * always-positive `cogsAmount` fell into the purchase-receipt branch
 * (debit Inventory / credit Clearing) instead of the correct COGS branch.
 * Fixed: branches on `line_type` (`sale_out` vs `purchase_in`) now.
 *
 * Bug C — the `customer`/`'return'` line_type branch was dead (the actual
 * reversal mechanism, `invertPostingLines`, preserves `line_type: 'sale'`
 * and only negates `amount`), so a reversed sale posted nothing to the GL.
 * Fixed: the `sale`/`purchase` branches now handle their own negative-amount
 * (reversed) form directly; the never-populated `'return'` type is removed.
 *
 * Bug D — newly found during Sprint 6A implementation (not in the original
 * review): a single quick-entry purchase (`purchases.ts`) posts BOTH a
 * `stock`/`purchase_in` line (positive `landedCost`) AND a `supplier`/
 * `purchase` line (negative `netPayable`) into the SAME batch. The old
 * mapper turned both into a "debit Inventory" GL line — once against
 * Clearing (from `stock`/`purchase_in`), once against AP (from `supplier`/
 * `purchase`) — double-counting Inventory on every purchase. A purchase has
 * exactly one real financial effect (debit Inventory / credit AP), fully
 * captured by the `supplier`/`purchase` line alone; `stock`/`purchase_in`
 * remains a legitimate posting_lines row (audit trail / quantity-tracking,
 * untouched), it simply produces zero GL lines now. This is asymmetric with
 * `stock`/`sale_out`, which DOES need its own GL line (debit COGS / credit
 * Inventory is a genuinely separate effect from debit AR / credit Sales
 * Revenue — standard perpetual-inventory double-entry, not a duplicate).
 *
 * V2 Sprint 6B addition — `customer`/`'opening_balance'` and `supplier`/
 * `'opening_balance'` line types (see services/accounting/openingBalancePosting.ts):
 * a per-party balance predating the system, booked against a dedicated
 * Opening Balance Equity suspense account (GL_CODES.OPENING_BALANCE_EQUITY)
 * rather than Sales/COGS/Inventory, since it isn't a current-period
 * transaction. Additive only — no existing case's behavior changes.
 */
import { GL_CODES } from '../../lib/glChart';

export interface PostingLineForGl {
  id: string;
  line_domain: string;
  line_type: string;
  amount: number;
  metadata?: Record<string, unknown>;
}

/** Output-VAT effect on a customer/sale line, sourced from tax_posting_lines by the caller. */
export interface TaxSplit {
  taxAmount: number;
  sdAmount: number;
}

export interface GlJournalLineDraft {
  accountCode: string;
  debit: number;
  credit: number;
  postingLineId: string;
  metadata?: Record<string, unknown>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function abs(n: number): number {
  return round2(Math.abs(n));
}

/**
 * Translate one posting line into debit/credit GL drafts.
 *
 * `taxSplit`, when provided, applies ONLY to `customer`/`sale` lines (both
 * the original positive-amount form and the reversed negative-amount form)
 * — it is the total output VAT+SD effect for the same document, looked up
 * by the caller from `tax_posting_lines`. When present, the gross amount is
 * split: the tax portion goes to VAT Payable, the remainder to Sales
 * Revenue; AR is always debited/credited at the full gross amount (a
 * customer owes the gross, tax included).
 */
export function mapPostingLineToGl(line: PostingLineForGl, taxSplit?: TaxSplit): GlJournalLineDraft[] {
  const amt = round2(Number(line.amount));
  if (amt === 0) return [];

  const meta = line.metadata ?? {};
  const drafts: GlJournalLineDraft[] = [];
  const base = { postingLineId: line.id, metadata: meta };

  switch (line.line_domain) {
    case 'customer': {
      if (line.line_type === 'sale' && amt !== 0) {
        const gross = abs(amt);
        const taxEffect = taxSplit ? round2(taxSplit.taxAmount + taxSplit.sdAmount) : 0;
        const taxable = round2(Math.max(0, gross - taxEffect));
        if (amt > 0) {
          // Original sale: debit AR gross, credit Sales taxable, credit VAT Payable tax.
          drafts.push({ ...base, accountCode: GL_CODES.AR, debit: gross, credit: 0 });
          if (taxable > 0) drafts.push({ ...base, accountCode: GL_CODES.SALES, debit: 0, credit: taxable });
          if (taxEffect > 0) drafts.push({ ...base, accountCode: GL_CODES.VAT_PAYABLE, debit: 0, credit: taxEffect });
        } else {
          // Reversed sale: exact mirror — credit AR gross, debit Sales taxable, debit VAT Payable tax.
          drafts.push({ ...base, accountCode: GL_CODES.AR, debit: 0, credit: gross });
          if (taxable > 0) drafts.push({ ...base, accountCode: GL_CODES.SALES, debit: taxable, credit: 0 });
          if (taxEffect > 0) drafts.push({ ...base, accountCode: GL_CODES.VAT_PAYABLE, debit: taxEffect, credit: 0 });
        }
      } else if (line.line_type === 'payment' && amt > 0) {
        drafts.push(
          { ...base, accountCode: GL_CODES.AR, debit: 0, credit: amt },
        );
      } else if (line.line_type === 'opening_balance' && amt !== 0) {
        const a = abs(amt);
        if (amt > 0) {
          drafts.push(
            { ...base, accountCode: GL_CODES.AR, debit: a, credit: 0 },
            { ...base, accountCode: GL_CODES.OPENING_BALANCE_EQUITY, debit: 0, credit: a },
          );
        } else {
          drafts.push(
            { ...base, accountCode: GL_CODES.AR, debit: 0, credit: a },
            { ...base, accountCode: GL_CODES.OPENING_BALANCE_EQUITY, debit: a, credit: 0 },
          );
        }
      }
      break;
    }
    case 'supplier': {
      if (line.line_type === 'purchase' && amt !== 0) {
        const gross = abs(amt);
        if (amt < 0) {
          // Original purchase: debit Inventory, credit AP.
          drafts.push(
            { ...base, accountCode: GL_CODES.INVENTORY, debit: gross, credit: 0 },
            { ...base, accountCode: GL_CODES.AP, debit: 0, credit: gross },
          );
        } else {
          // Reversed purchase: exact mirror — credit Inventory, debit AP.
          drafts.push(
            { ...base, accountCode: GL_CODES.INVENTORY, debit: 0, credit: gross },
            { ...base, accountCode: GL_CODES.AP, debit: gross, credit: 0 },
          );
        }
      } else if (line.line_type === 'payment' && amt > 0) {
        drafts.push(
          { ...base, accountCode: GL_CODES.AP, debit: amt, credit: 0 },
        );
      } else if (line.line_type === 'opening_balance' && amt !== 0) {
        // Supplier convention matches the 'purchase' branch above exactly
        // (ledgerBalance.ts computeSupplierBalance's `else` bucket: balance
        // += -amt): a NEGATIVE amount is what we owe more of, same as a
        // purchase; a positive amount is a credit balance in our favor.
        const a = abs(amt);
        if (amt < 0) {
          drafts.push(
            { ...base, accountCode: GL_CODES.OPENING_BALANCE_EQUITY, debit: a, credit: 0 },
            { ...base, accountCode: GL_CODES.AP, debit: 0, credit: a },
          );
        } else {
          drafts.push(
            { ...base, accountCode: GL_CODES.OPENING_BALANCE_EQUITY, debit: 0, credit: a },
            { ...base, accountCode: GL_CODES.AP, debit: a, credit: 0 },
          );
        }
      }
      break;
    }
    case 'cash': {
      if (amt > 0) {
        drafts.push({ ...base, accountCode: GL_CODES.CASH, debit: amt, credit: 0 });
      } else if (amt < 0) {
        drafts.push({ ...base, accountCode: GL_CODES.CASH, debit: 0, credit: abs(amt) });
      }
      break;
    }
    case 'bank': {
      if (amt > 0) {
        drafts.push({ ...base, accountCode: GL_CODES.BANK, debit: amt, credit: 0 });
      } else if (amt < 0) {
        drafts.push({ ...base, accountCode: GL_CODES.BANK, debit: 0, credit: abs(amt) });
      }
      break;
    }
    case 'expense': {
      const a = abs(amt);
      if (a > 0) {
        drafts.push(
          { ...base, accountCode: GL_CODES.EXPENSE, debit: a, credit: 0 },
          { ...base, accountCode: GL_CODES.CLEARING, debit: 0, credit: a },
        );
      }
      break;
    }
    case 'stock': {
      // Bug D fix: 'purchase_in' produces NO GL lines — the supplier/purchase
      // case above already fully captures the purchase's Inventory effect in
      // the same batch. 'sale_out' DOES need its own line (COGS recognition
      // is a genuinely separate effect from AR/Sales Revenue recognition).
      if (line.line_type === 'sale_out') {
        const a = abs(amt);
        if (a > 0) {
          if (amt > 0) {
            // Original sale COGS: debit COGS, credit Inventory (amount is
            // always a positive cost magnitude regardless of amt's sign in
            // practice — this branch is the normal case).
            drafts.push(
              { ...base, accountCode: GL_CODES.COGS, debit: a, credit: 0 },
              { ...base, accountCode: GL_CODES.INVENTORY, debit: 0, credit: a },
            );
          } else {
            // Reversed sale COGS (negative amount from invertPostingLines):
            // exact mirror — credit COGS, debit Inventory.
            drafts.push(
              { ...base, accountCode: GL_CODES.COGS, debit: 0, credit: a },
              { ...base, accountCode: GL_CODES.INVENTORY, debit: a, credit: 0 },
            );
          }
        }
      }
      // 'purchase_in': intentionally no drafts (Bug D).
      break;
    }
    default:
      break;
  }

  return drafts;
}

/** Balance unpaired cash/bank receipts/payments within a batch via clearing. */
export function balanceGlDrafts(drafts: GlJournalLineDraft[]): { drafts: GlJournalLineDraft[]; wasUnbalanced: boolean } {
  let debit = 0;
  let credit = 0;
  for (const d of drafts) {
    debit += d.debit;
    credit += d.credit;
  }
  const diff = round2(debit - credit);
  if (diff === 0) return { drafts, wasUnbalanced: false };

  const clearingLine: GlJournalLineDraft = diff > 0
    ? {
        accountCode: GL_CODES.CLEARING,
        debit: 0,
        credit: diff,
        postingLineId: drafts[0]?.postingLineId ?? 'balance',
        metadata: { balance_adjustment: true },
      }
    : {
        accountCode: GL_CODES.CLEARING,
        debit: abs(diff),
        credit: 0,
        postingLineId: drafts[0]?.postingLineId ?? 'balance',
        metadata: { balance_adjustment: true },
      };

  return { drafts: [...drafts, clearingLine], wasUnbalanced: true };
}

export interface MapPostingLinesResult {
  drafts: GlJournalLineDraft[];
  /**
   * True if `balanceGlDrafts` had to inject a Clearing plug. Now that
   * tax/stock/reversal are correctly mapped, this should be rare — expense
   * and genuine Clearing-designated events (landed cost rounding, cost
   * adjustments) are the only expected sources. A caller seeing this fire
   * for a plain sale/purchase should treat it as a signal something is
   * newly wrong, not routine (posting validation, per architecture §2.5).
   */
  wasUnbalanced: boolean;
}

export function mapPostingLinesToGl(
  lines: PostingLineForGl[],
  taxSplit?: TaxSplit,
): MapPostingLinesResult {
  const drafts = lines.flatMap((line) => mapPostingLineToGl(line, taxSplit));
  return balanceGlDrafts(drafts);
}
