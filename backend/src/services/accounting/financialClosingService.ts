/**
 * V2 Sprint 6E — Financial Closing (Fiscal Year Closing).
 *
 * Period Closing itself is NOT rebuilt here — `fiscalYears.ts`'s existing
 * `POST /:fiscalYearId/periods/:periodId/close` (Sprint 6A) already does it
 * and is reused as-is; "Closing Validation" below just requires every
 * period in the fiscal year to already be in that closed state.
 *
 * Fiscal Year Closing generates a system Closing Journal using the SAME
 * manual-journal mechanism `journal.ts` uses for human-entered entries
 * (`journal_entries`/`journal_entry_lines`, its exported `validateBalance`)
 * rather than the Posting Engine — the Posting Engine's line-domain mapper
 * (glLineMapper.ts) is shaped around business events (a sale, a payment, an
 * asset purchase), not arbitrary "debit this GL account, credit that one"
 * postings, which is exactly what a closing entry is.
 *
 * Only GL Spine income/expense accounts (account_type IN income/expense,
 * which have a real, structured type) are zeroed automatically. Manual
 * Journal entries booked to a free-text account that happens to *look*
 * like income/expense are deliberately left alone — there's no reliable
 * way to know a free-text label's account_type, and guessing risks closing
 * the wrong thing into Retained Earnings. See the Deferred Items section
 * of docs/SPRINT6E_FINANCIAL_STATEMENTS_CLOSING.md.
 *
 * Opening Balance Carry Forward needs no separate mechanism: once income/
 * expense accounts are zeroed, every asset/liability/equity account's
 * balance simply continues into the next fiscal year automatically — the
 * GL Spine's balances are cumulative by construction, not period-scoped.
 */
import type { Knex } from 'knex';
import { db } from '../../db/connection';
import { validateBalance } from '../../routes/journal';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export class FiscalYearCloseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalYearCloseError';
  }
}

export interface ClosingSourceAccount {
  code: string;
  name: string;
  debit: number;
  credit: number;
}

export interface ClosingLine {
  account: string;
  debit: number;
  credit: number;
  line_narration: string;
}

export interface ComputedClosing {
  lines: ClosingLine[];
  retainedEarningsNet: number;
}

/**
 * Pure closing-entry math, extracted for direct unit testing: for each
 * income/expense account with a nonzero cumulative balance, generate the
 * line that zeroes it, and accumulate the net effect that lands on
 * Retained Earnings (positive = net income/credit RE, negative = net
 * loss/debit RE). Does not include the final Retained Earnings line itself
 * — callers add that once they know the fiscal year name for its narration.
 */
export function computeClosingLines(accountRows: ClosingSourceAccount[]): ComputedClosing {
  const lines: ClosingLine[] = [];
  let retainedEarningsNet = 0;

  for (const r of accountRows) {
    const debit = round2(r.debit);
    const credit = round2(r.credit);
    const net = round2(debit - credit);
    if (Math.abs(net) < 0.005) continue;
    if (net > 0) {
      // Net debit balance (e.g. an expense account, or a net-debit income account) — credit it to zero.
      lines.push({ account: `${r.code} — ${r.name}`, debit: 0, credit: net, line_narration: 'Fiscal year closing' });
      retainedEarningsNet -= net;
    } else {
      // Net credit balance (normal for income) — debit it to zero.
      lines.push({ account: `${r.code} — ${r.name}`, debit: -net, credit: 0, line_narration: 'Fiscal year closing' });
      retainedEarningsNet += -net;
    }
  }

  return { lines, retainedEarningsNet: round2(retainedEarningsNet) };
}

interface CloseFiscalYearInput {
  dealerId: string;
  fiscalYearId: string;
  userId: string | null;
}

export interface CloseFiscalYearResult {
  fiscalYearId: string;
  closingJournalEntryId: string | null;
  netIncomeClosedToRetainedEarnings: number;
  accountsClosedCount: number;
}

async function fetchOpenPeriods(trx: Knex.Transaction, fiscalYearId: string): Promise<{ period_no: number }[]> {
  return trx('accounting_periods').where({ fiscal_year_id: fiscalYearId }).andWhereNot('status', 'closed').select('period_no');
}

export async function closeFiscalYear(input: CloseFiscalYearInput): Promise<CloseFiscalYearResult> {
  return db.transaction(async (trx) => {
    const fy = await trx('fiscal_years').where({ id: input.fiscalYearId, dealer_id: input.dealerId }).forUpdate().first();
    if (!fy) throw new FiscalYearCloseError('Fiscal year not found');
    if (fy.status === 'closed') throw new FiscalYearCloseError('Fiscal year is already closed');

    // Chronological order: an earlier fiscal year must be closed first, or
    // Retained Earnings would carry a gap.
    const earlierOpen = await trx('fiscal_years')
      .where({ dealer_id: input.dealerId })
      .andWhere('start_date', '<', fy.start_date)
      .andWhere('status', 'open')
      .first('id', 'name');
    if (earlierOpen) {
      throw new FiscalYearCloseError(`Fiscal year "${earlierOpen.name}" starts earlier and is still open — close fiscal years in chronological order.`);
    }

    // Closing Validation: every period inside this fiscal year must already be closed.
    const openPeriods = await fetchOpenPeriods(trx, fy.id);
    if (openPeriods.length) {
      const nums = openPeriods.map((p) => p.period_no).sort((a, b) => a - b).join(', ');
      throw new FiscalYearCloseError(`Cannot close fiscal year — period(s) ${nums} are still open. Close every period first.`);
    }

    // Zero every income/expense GL account's cumulative-to-date balance.
    const accountRows = await trx('gl_journal_lines as jl')
      .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
      .join('gl_accounts as a', 'a.id', 'jl.account_id')
      .where('je.dealer_id', input.dealerId)
      .whereIn('a.account_type', ['income', 'expense'])
      .andWhere('je.entry_date', '<=', fy.end_date)
      .groupBy('a.id', 'a.code', 'a.name')
      .select('a.code', 'a.name')
      .sum({ debit: 'jl.debit' }).sum({ credit: 'jl.credit' });

    const { lines: closingLines, retainedEarningsNet } = computeClosingLines(
      (accountRows as any[]).map((r) => ({ code: r.code, name: r.name, debit: r.debit, credit: r.credit })),
    );

    if (!closingLines.length) {
      // No income/expense activity this fiscal year — nothing to close, just mark it closed.
      await trx('fiscal_years').where({ id: fy.id }).update({ status: 'closed', closed_at: trx.fn.now(), closed_by: input.userId });
      return { fiscalYearId: fy.id, closingJournalEntryId: null, netIncomeClosedToRetainedEarnings: 0, accountsClosedCount: 0 };
    }

    closingLines.push({
      account: 'Retained Earnings',
      debit: retainedEarningsNet < 0 ? round2(-retainedEarningsNet) : 0,
      credit: retainedEarningsNet > 0 ? round2(retainedEarningsNet) : 0,
      line_narration: `Net ${retainedEarningsNet >= 0 ? 'income' : 'loss'} for ${fy.name}`,
    });

    const balance = validateBalance(closingLines as any);
    if (!balance.ok) {
      // Should be unreachable (closingLines are constructed to balance by
      // definition) — surfaced defensively rather than silently posting an
      // unbalanced entry.
      throw new FiscalYearCloseError(`Closing journal failed to balance: ${balance.error}`);
    }

    const voucherNo = `FYC-${fy.name}`;
    // Deliberately bypasses assertPeriodOpen: this system-generated closing
    // entry is dated at fiscal_year.end_date, which by this point is inside
    // an already-closed period — that's the whole point of a closing entry.
    const [hdr] = await trx('journal_entries')
      .insert({
        dealer_id: input.dealerId,
        voucher_no: voucherNo,
        entry_date: fy.end_date,
        narration: `System-generated Fiscal Year Closing for ${fy.name}`,
        created_by: input.userId,
        status: 'posted',
        posted_by: input.userId,
        posted_at: trx.fn.now(),
      })
      .returning('id');

    const lineRows = closingLines.map((l, i) => ({
      journal_entry_id: hdr.id,
      dealer_id: input.dealerId,
      account: l.account,
      debit: l.debit,
      credit: l.credit,
      line_narration: l.line_narration,
      line_order: i,
    }));
    await trx('journal_entry_lines').insert(lineRows);

    await trx('fiscal_years')
      .where({ id: fy.id })
      .update({ status: 'closed', closed_at: trx.fn.now(), closed_by: input.userId, closing_journal_entry_id: hdr.id });

    return {
      fiscalYearId: fy.id,
      closingJournalEntryId: hdr.id as string,
      netIncomeClosedToRetainedEarnings: round2(retainedEarningsNet),
      accountsClosedCount: closingLines.length - 1,
    };
  });
}
