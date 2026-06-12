import { parseLocalDate } from "@/lib/utils";

export type SubscriptionStatus = "active" | "expired" | "suspended";

export interface SubscriptionLike {
  status: SubscriptionStatus;
  end_date: string | null;
}

export type DealerSubscriptionAccess = "full" | "blocked";

/**
 * Dealer subscription access from end_date + status.
 * Once end_date has passed → blocked immediately (no grace-period ERP access).
 */
export function computeDealerSubscriptionAccess(
  sub: SubscriptionLike | null,
): DealerSubscriptionAccess {
  if (!sub) return "blocked";
  if (sub.status === "suspended") return "blocked";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDate = parseLocalDate(sub.end_date);

  if (!endDate && sub.status === "active") return "full";
  if (endDate && today <= endDate) return "full";

  return "blocked";
}

export function dealerNeedsRenewal(access: DealerSubscriptionAccess): boolean {
  return access === "blocked";
}

export function resolveDealerPostLoginPath(input: {
  isSuperAdmin: boolean;
  isDealerRole: boolean;
  subscription: SubscriptionLike | null;
}): string {
  if (input.isSuperAdmin) return "/super-admin";
  if (
    input.isDealerRole &&
    dealerNeedsRenewal(computeDealerSubscriptionAccess(input.subscription))
  ) {
    return "/subscription";
  }
  return "/dashboard";
}
