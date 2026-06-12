import type { Knex } from 'knex';
import { db } from '../db/connection';
import { notifySubscriptionActivated } from './subscriptionRenewalNotify';

function toDateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function addMonthsIso(baseIso: string, months: number): string {
  const d = new Date(baseIso + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function activateSubscriptionFromPayment(
  trx: Knex.Transaction,
  input: {
    subscriptionId: string;
    dealerId: string;
    billingCycle: 'monthly' | 'yearly';
    extendMonths?: number;
    planId?: string | null;
    collectedBy?: string | null;
  },
): Promise<{ subscription: any; yearlyDiscountApplied: boolean }> {
  const cycle = input.billingCycle;
  const extendMonths = input.extendMonths ?? (cycle === 'yearly' ? 12 : 1);

  let yearlyDiscountApplied = false;
  if (cycle === 'yearly') {
    const prev = await trx('subscriptions')
      .where({ dealer_id: input.dealerId, yearly_discount_applied: true })
      .first();
    yearlyDiscountApplied = !prev;
  }

  const sub = await trx('subscriptions').where({ id: input.subscriptionId }).first();
  if (!sub) throw new Error('Subscription not found');

  const todayIso = new Date().toISOString().slice(0, 10);
  const currentEnd = toDateOnly(sub.end_date);
  const baseIso =
    currentEnd && currentEnd >= todayIso
      ? currentEnd
      : todayIso;
  const newEnd = addMonthsIso(baseIso, extendMonths);

  const patch: Record<string, unknown> = {
    end_date: newEnd,
    status: 'active',
    billing_cycle: cycle,
    yearly_discount_applied: yearlyDiscountApplied,
  };
  if (input.planId) patch.plan_id = input.planId;

  const [row] = await trx('subscriptions')
    .where({ id: input.subscriptionId })
    .update(patch)
    .returning('*');

  await trx('dealers')
    .where({ id: input.dealerId })
    .update({ status: 'active', updated_at: new Date() });

  const adminProfile = await trx('profiles').where({ dealer_id: input.dealerId }).first();
  if (adminProfile) {
    await trx('users')
      .where({ id: adminProfile.id })
      .update({ status: 'active', updated_at: new Date() });
  }

  return { subscription: row, yearlyDiscountApplied };
}

export async function sendActivationNotice(dealerId: string, planName: string, endDate: string): Promise<void> {
  const dealer = await db('dealers').where({ id: dealerId }).first();
  if (!dealer) return;
  void notifySubscriptionActivated({
    dealerName: dealer.name || 'Dealer',
    dealerEmail: dealer.email || '',
    dealerPhone: dealer.phone || '',
    planName,
    endDate,
  });
}
