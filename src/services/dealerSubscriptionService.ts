import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

async function vpsJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface DealerSubscription {
  id: string;
  dealer_id: string;
  plan_id: string;
  status: string;
  billing_cycle: string;
  start_date: string;
  end_date: string | null;
  yearly_discount_applied: boolean;
  plan_name: string | null;
  price_monthly: string | number | null;
  price_yearly: string | number | null;
  max_users: number | null;
  sms_enabled: boolean | null;
  email_enabled: boolean | null;
  daily_summary_enabled: boolean | null;
  plan_features: string[] | null;
  is_trial: boolean | null;
  trial_days: number | null;
  sort_order: number | null;
}

export interface PlanOption {
  id: string;
  name: string;
  price_monthly: string | number;
  price_yearly: string | number;
  max_users: number;
  sms_enabled: boolean;
  email_enabled: boolean;
  daily_summary_enabled: boolean;
  is_trial: boolean;
  trial_days: number;
  sort_order: number;
  features: string[];
}

export interface DealerSubscriptionPayment {
  id: string;
  amount: string | number;
  payment_method: string;
  payment_status: string;
  payment_date: string;
  note: string | null;
  created_at: string;
  requested_plan_id: string | null;
  requested_billing_cycle: string | null;
  source: string | null;
  requested_plan_name: string | null;
}

export async function fetchCurrentSubscription() {
  const r = await vpsJson<{ subscription: DealerSubscription | null }>(
    "/api/subscription/current",
  );
  return r.subscription;
}

export async function fetchAvailablePlans() {
  const r = await vpsJson<{ plans: PlanOption[] }>("/api/subscription/plans");
  return r.plans;
}

export async function fetchDealerSubscriptionPayments() {
  const r = await vpsJson<{ payments: DealerSubscriptionPayment[] }>(
    "/api/subscription/payments",
  );
  return r.payments;
}

export async function requestPlanUpgrade(input: {
  plan_id: string;
  billing_cycle: "monthly" | "yearly";
  payment_method?: "cash" | "bank" | "mobile_banking";
  transaction_id?: string;
  note?: string;
}) {
  return vpsJson<{ payment: { id: string } }>("/api/subscription/upgrade-request", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
