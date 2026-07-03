/**
 * Map posting_lines money effects → balanced GL journal lines (P6-01).
 */
import { GL_CODES } from '../../lib/glChart';

export interface PostingLineForGl {
  id: string;
  line_domain: string;
  line_type: string;
  amount: number;
  metadata?: Record<string, unknown>;
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
 * Stock lines use inventory + clearing; money lines use standard accounts.
 */
export function mapPostingLineToGl(line: PostingLineForGl): GlJournalLineDraft[] {
  const amt = round2(Number(line.amount));
  if (amt === 0) return [];

  const meta = line.metadata ?? {};
  const drafts: GlJournalLineDraft[] = [];
  const base = { postingLineId: line.id, metadata: meta };

  switch (line.line_domain) {
    case 'customer': {
      if (line.line_type === 'sale' && amt > 0) {
        drafts.push(
          { ...base, accountCode: GL_CODES.AR, debit: amt, credit: 0 },
          { ...base, accountCode: GL_CODES.SALES, debit: 0, credit: amt },
        );
      } else if (line.line_type === 'payment' && amt > 0) {
        drafts.push(
          { ...base, accountCode: GL_CODES.AR, debit: 0, credit: amt },
        );
      } else if (line.line_type === 'return' && amt !== 0) {
        const a = abs(amt);
        drafts.push(
          { ...base, accountCode: GL_CODES.SALES, debit: a, credit: 0 },
          { ...base, accountCode: GL_CODES.AR, debit: 0, credit: a },
        );
      }
      break;
    }
    case 'supplier': {
      if (line.line_type === 'purchase' && amt < 0) {
        const a = abs(amt);
        drafts.push(
          { ...base, accountCode: GL_CODES.INVENTORY, debit: a, credit: 0 },
          { ...base, accountCode: GL_CODES.AP, debit: 0, credit: a },
        );
      } else if (line.line_type === 'payment' && amt > 0) {
        drafts.push(
          { ...base, accountCode: GL_CODES.AP, debit: amt, credit: 0 },
        );
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
    case 'tax': {
      const a = abs(amt);
      if (a > 0) {
        drafts.push(
          { ...base, accountCode: GL_CODES.VAT_PAYABLE, debit: 0, credit: a },
          { ...base, accountCode: GL_CODES.CLEARING, debit: a, credit: 0 },
        );
      }
      break;
    }
    case 'stock': {
      const a = abs(amt);
      if (a > 0 && amt > 0) {
        drafts.push(
          { ...base, accountCode: GL_CODES.INVENTORY, debit: a, credit: 0 },
          { ...base, accountCode: GL_CODES.CLEARING, debit: 0, credit: a },
        );
      } else if (a > 0 && amt < 0) {
        drafts.push(
          { ...base, accountCode: GL_CODES.COGS, debit: a, credit: 0 },
          { ...base, accountCode: GL_CODES.INVENTORY, debit: 0, credit: a },
        );
      }
      break;
    }
    default:
      break;
  }

  return drafts;
}

/** Balance unpaired cash/bank receipts/payments within a batch via clearing. */
export function balanceGlDrafts(drafts: GlJournalLineDraft[]): GlJournalLineDraft[] {
  let debit = 0;
  let credit = 0;
  for (const d of drafts) {
    debit += d.debit;
    credit += d.credit;
  }
  const diff = round2(debit - credit);
  if (diff === 0) return drafts;

  if (diff > 0) {
    return [
      ...drafts,
      {
        accountCode: GL_CODES.CLEARING,
        debit: 0,
        credit: diff,
        postingLineId: drafts[0]?.postingLineId ?? 'balance',
        metadata: { balance_adjustment: true },
      },
    ];
  }

  return [
    ...drafts,
    {
      accountCode: GL_CODES.CLEARING,
      debit: abs(diff),
      credit: 0,
      postingLineId: drafts[0]?.postingLineId ?? 'balance',
      metadata: { balance_adjustment: true },
    },
  ];
}

export function mapPostingLinesToGl(
  lines: PostingLineForGl[],
): GlJournalLineDraft[] {
  const drafts = lines.flatMap(mapPostingLineToGl);
  return balanceGlDrafts(drafts);
}
