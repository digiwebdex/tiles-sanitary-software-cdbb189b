import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

async function vpsJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

interface RecordPaymentInput {
  subscription_id: string;
  dealer_id: string;
  amount: number;
  payment_date: string;
  payment_method: "cash" | "bank" | "mobile_banking";
  payment_status: "paid" | "partial" | "pending";
  collected_by: string;
  note?: string;
  /** Used to extend subscription on full payment */
  extend_months?: number;
  /** Billing cycle for this renewal period */
  billing_cycle?: "monthly" | "yearly";
}

/**
 * Records a subscription payment via the VPS backend.
 * – Prevents duplicate full payments for the same subscription period.
 * – On full payment: extends subscription end_date and sets status = active.
 * – Yearly billing: 30% discount only applies on first yearly renewal per dealer.
 *   Subsequent yearly renewals are charged at full price (monthly_price × 12).
 * – Logs the action in audit_logs server-side.
 */
export async function recordSubscriptionPayment(input: RecordPaymentInput) {
  const {
    subscription_id,
    dealer_id,
    amount,
    payment_date,
    payment_method,
    payment_status,
    note,
    extend_months = 1,
    billing_cycle = "monthly",
  } = input;

  const result = await vpsJson<{
    payment: { id: string };
    yearly_discount_applied: boolean;
  }>("/api/subscriptions/payments", {
    method: "POST",
    body: JSON.stringify({
      subscription_id,
      dealer_id,
      amount,
      payment_date,
      payment_method,
      payment_status,
      note,
      extend_months,
      billing_cycle,
    }),
  });
  return {
    payment: result.payment,
    yearlyDiscountApplied: result.yearly_discount_applied,
  };
}

export async function confirmPendingSubscriptionPayment(paymentId: string) {
  return vpsJson<{
    payment: { id: string; payment_status: string };
    subscription: { end_date: string; status: string } | null;
  }>(`/api/subscriptions/payments/${paymentId}/confirm`, {
    method: "PATCH",
  });
}

/**
 * Check if a dealer is eligible for the 30% yearly discount.
 * Returns true if they have NEVER received a yearly discount before.
 */
export async function checkYearlyDiscountEligibility(dealer_id: string): Promise<boolean> {
  const r = await vpsJson<{ eligible: boolean }>(
    `/api/subscriptions/yearly-discount-eligibility?dealer_id=${encodeURIComponent(dealer_id)}`,
  );
  return !!r.eligible;
}
