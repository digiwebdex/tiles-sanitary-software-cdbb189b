/**
 * Fiscal period lock enforcement — V2 Sprint 6A.
 *
 * Per the approved architecture (docs/ACCOUNTING_V2_ARCHITECTURE.md §2.2),
 * this check lives in exactly the two choke points every financial write
 * already funnels through — `createPostingBatch` (posting engine, used by
 * every dual-writing route) and `journal.ts` (manual entries) — rather than
 * being added to 20+ individual route files, several of them frozen.
 *
 * Both choke points already receive `dealerId` and an entry date as
 * parameters, so this check is inherently dealer-scoped by construction: it
 * can never accidentally evaluate a different dealer's period, because it
 * is only ever given the specific dealer's own id and date.
 *
 * Backward-compatible by design: a dealer with no `accounting_periods` rows
 * at all (the case for every dealer until Fiscal Year setup is used) sees
 * zero behavior change — only an EXPLICITLY CLOSED period for that date
 * blocks a new post. This is what lets Sprint 6A activate posting-engine/GL
 * defaults without requiring every existing dealer to configure a fiscal
 * calendar first.
 */
import type { Knex } from 'knex';

export class PeriodClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeriodClosedError';
  }
}

export async function assertPeriodOpen(
  trx: Knex.Transaction,
  dealerId: string,
  entryDate: string,
): Promise<void> {
  const period = await trx('accounting_periods')
    .where({ dealer_id: dealerId })
    .andWhere('start_date', '<=', entryDate)
    .andWhere('end_date', '>=', entryDate)
    .first('id', 'status', 'period_no');

  if (period && period.status === 'closed') {
    throw new PeriodClosedError(
      `Cannot post to ${entryDate} — accounting period ${period.period_no} is closed. Ask a Finance Manager to reopen it if this entry is genuinely needed here.`,
    );
  }
}
