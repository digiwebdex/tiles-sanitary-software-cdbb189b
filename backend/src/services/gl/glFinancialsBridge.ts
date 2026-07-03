/**
 * Bridge GL journal data into financials API response shapes (P6-02).
 */
import { db } from '../../db/connection';
import { isGlSpineEnabled } from './glConfig';
import { getTrialBalance } from './glJournalWriter';

export async function dealerHasGlJournals(dealerId: string): Promise<boolean> {
  const row = await db('gl_journal_entries').where({ dealer_id: dealerId }).first('id');
  return !!row;
}

export async function shouldUseGlTrialBalance(
  dealerId: string,
  source: string | undefined,
): Promise<boolean> {
  if (source === 'legacy') return false;
  if (source === 'gl') return true;
  if (!isGlSpineEnabled()) return false;
  return dealerHasGlJournals(dealerId);
}

export async function buildFinancialsTrialBalanceFromGl(
  dealerId: string,
  asOf: string | null,
) {
  const rows = await getTrialBalance(dealerId, asOf ?? undefined);
  const accounts = rows
    .filter((r) => r.debit > 0.005 || r.credit > 0.005)
    .map((r) => ({
      account: `${r.code} — ${r.name}`,
      debit: Math.round(r.debit * 100) / 100,
      credit: Math.round(r.credit * 100) / 100,
    }))
    .sort((a, b) => a.account.localeCompare(b.account));

  const total_debit = accounts.reduce((s, r) => s + r.debit, 0);
  const total_credit = accounts.reduce((s, r) => s + r.credit, 0);

  return {
    as_of: asOf,
    accounts,
    total_debit: Math.round(total_debit * 100) / 100,
    total_credit: Math.round(total_credit * 100) / 100,
    difference: Math.round((total_debit - total_credit) * 100) / 100,
    data_source: 'gl_spine' as const,
    warnings: [] as string[],
  };
}
