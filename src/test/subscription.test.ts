/**
 * Unit tests for subscription access logic.
 */

import { describe, it, expect } from "vitest";
import { parseLocalDate } from "@/lib/utils";
import {
  computeDealerSubscriptionAccess,
  dealerNeedsRenewal,
  resolveDealerPostLoginPath,
} from "@/lib/subscriptionAccess";

function localDateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Status = "active" | "expired" | "suspended";

interface Subscription {
  status: Status;
  end_date: string | null;
}

describe("parseLocalDate", () => {
  it("returns null for null input", () => {
    expect(parseLocalDate(null)).toBeNull();
  });

  it("constructs LOCAL midnight", () => {
    const result = parseLocalDate("2025-06-15");
    expect(result!.getFullYear()).toBe(2025);
    expect(result!.getMonth()).toBe(5);
    expect(result!.getDate()).toBe(15);
  });
});

describe("computeDealerSubscriptionAccess", () => {
  it("returns blocked when there is no subscription", () => {
    expect(computeDealerSubscriptionAccess(null)).toBe("blocked");
  });

  it("returns blocked for suspended", () => {
    expect(
      computeDealerSubscriptionAccess({
        status: "suspended",
        end_date: localDateStr(30),
      }),
    ).toBe("blocked");
  });

  it("returns full when today <= end_date", () => {
    expect(
      computeDealerSubscriptionAccess({
        status: "active",
        end_date: localDateStr(10),
      }),
    ).toBe("full");
  });

  it("returns full when status expired but end_date is future", () => {
    expect(
      computeDealerSubscriptionAccess({
        status: "expired",
        end_date: localDateStr(5),
      }),
    ).toBe("full");
  });

  it("returns grace 1–3 days past end_date", () => {
    expect(
      computeDealerSubscriptionAccess({
        status: "expired",
        end_date: localDateStr(-2),
      }),
    ).toBe("grace");
  });

  it("returns blocked beyond grace", () => {
    expect(
      computeDealerSubscriptionAccess({
        status: "expired",
        end_date: localDateStr(-4),
      }),
    ).toBe("blocked");
  });

  it("returns full for active with null end_date", () => {
    expect(
      computeDealerSubscriptionAccess({
        status: "active",
        end_date: null,
      }),
    ).toBe("full");
  });

  it("returns blocked for expired with null end_date", () => {
    expect(
      computeDealerSubscriptionAccess({
        status: "expired",
        end_date: null,
      }),
    ).toBe("blocked");
  });
});

describe("resolveDealerPostLoginPath", () => {
  it("sends super admin to super-admin", () => {
    expect(
      resolveDealerPostLoginPath({
        isSuperAdmin: true,
        isDealerRole: false,
        subscription: null,
      }),
    ).toBe("/super-admin");
  });

  it("sends expired dealer to renewal page", () => {
    const sub: Subscription = { status: "expired", end_date: localDateStr(-10) };
    expect(
      resolveDealerPostLoginPath({
        isSuperAdmin: false,
        isDealerRole: true,
        subscription: sub,
      }),
    ).toBe("/subscription-blocked");
  });

  it("sends active dealer to dashboard", () => {
    expect(
      resolveDealerPostLoginPath({
        isSuperAdmin: false,
        isDealerRole: true,
        subscription: { status: "active", end_date: localDateStr(10) },
      }),
    ).toBe("/dashboard");
  });
});

describe("dealerNeedsRenewal", () => {
  it("is true only for blocked access", () => {
    expect(dealerNeedsRenewal("blocked")).toBe(true);
    expect(dealerNeedsRenewal("grace")).toBe(false);
    expect(dealerNeedsRenewal("full")).toBe(false);
  });
});
