import type { Knex } from 'knex';
import { db } from '../db/connection';

/** Default subscription end date when SA creates a dealer or omits end_date. */
export async function defaultSubscriptionEndDate(
  planId: string,
  trx?: Knex.Transaction,
): Promise<string> {
  const conn = trx ?? db;
  const plan = await conn('plans').where({ id: planId }).first();
  const trialDays = Number(plan?.trial_days ?? 0);
  const isTrial = Boolean(plan?.is_trial);
  const monthly = Number(plan?.price_monthly ?? 0);

  let days = 365;
  if (isTrial && trialDays > 0) {
    days = trialDays;
  } else if (trialDays > 0 && monthly === 0) {
    days = trialDays;
  } else if (!isTrial && monthly > 0) {
    days = 365;
  } else {
    days = trialDays > 0 ? trialDays : 30;
  }

  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
