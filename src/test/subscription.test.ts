/**
 * Unit tests for subscription access logic.
 *
 * Tests cover:
 *  1. parseLocalDate  — timezone-safe date parsing from "YYYY-MM-DD" strings
 *  2. computeAccessLevel (inline re-implementation) — access matrix for all
 *     subscription states using local-date end_date comparisons
 *
 * Key invariant being tested:
 *   Access is determined by `end_date` (the source of truth), NOT by the
 *   `status` field alone. A stale "expired" status must not block a dealer
 *   whose end_date is still in the future.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseLocalDate } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a "YYYY-MM-DD" string offset by `days` from today (local time). */
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
  id: string;
  dealer_id: string;
  plan_id: string;
  status: Status;
  start_date: string;
  end_date: string | null;
}

type AccessLevel = "full" | "grace" | "readonly" | "blocked";

/**
 * Mirrors the access-level computation from AuthContext.tsx so we can test it
 * in isolation without importing React context machinery.
 *
 * Rules (matching AuthContext):
 *  - suspended              → blocked
 *  - today <= end_date      → full   (end_date is source of truth)
 *  - end_date < today <= end_date + 3 days → grace
 *  - beyond grace           → readonly
 *  - active + no end_date   → full (open-ended subscription)
 *  - expired + no end_date  → readonly
 *  - no subscription        → blocked
 */
function computeAccessLevel(sub: Subscription | null): AccessLevel {
  if (!sub) return "blocked";
  if (sub.status === "suspended") return "blocked";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDate = parseLocalDate(sub.end_date);

  if (!endDate && sub.status === "active") return "full";

  if (endDate && today <= endDate) return "full";

  if (endDate) {
    const graceEnd = new Date(endDate);
    graceEnd.setDate(graceEnd.getDate() + 3);
    if (today > endDate && today <= graceEnd) return "grace";
  }

  return "readonly";
}

// ─── Test doubles ─────────────────────────────────────────────────────────────

const baseSub: Subscription = {
  id: "sub-1",
  dealer_id: "dealer-1",
  plan_id: "plan-1",
  status: "active",
  start_date: "2025-01-01",
  end_date: null,
};

// ═════════════════════════════════════════════════════════════════════════════
// 1. parseLocalDate
// ═════════════════════════════════════════════════════════════════════════════

describe("parseLocalDate", () => {
  it("returns null for null input", () => {
    expect(parseLocalDate(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseLocalDate(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLocalDate("")).toBeNull();
  });

  it("returns null for malformed strings", () => {
    expect(parseLocalDate("not-a-date")).toBeNull();
    expect(parseLocalDate("2024-13-01")).not.toBeNull(); // structurally valid
    expect(parseLocalDate("2024/01/15")).toBeNull();     // wrong separator
  });

  it("constructs LOCAL midnight, not UTC midnight", () => {
    const result = parseLocalDate("2025-06-15");
    expect(result).not.toBeNull();
    // Local year/month/day must match the input — the UTC equivalents may differ
    expect(result!.getFullYear()).toBe(2025);
    expect(result!.getMonth()).toBe(5); // 0-indexed June
    expect(result!.getDate()).toBe(15);
    // Hours are local midnight
    expect(result!.getHours()).toBe(0);
    expect(result!.getMinutes()).toBe(0);
    expect(result!.getSeconds()).toBe(0);
  });

  it("is immune to the UTC off-by-one bug in positive UTC offsets", () => {
    // `new Date("2025-06-15")` in UTC+6 would give June 14 at 06:00 local time.
    // parseLocalDate must return June 15 regardless of the host timezone.
    const result = parseLocalDate("2025-06-15");
    expect(result!.getDate()).toBe(15);
    expect(result!.getMonth()).toBe(5);
  });

  it("handles year boundaries correctly", () => {
    const dec31 = parseLocalDate("2024-12-31");
    expect(dec31!.getFullYear()).toBe(2024);
    expect(dec31!.getMonth()).toBe(11);
    expect(dec31!.getDate()).toBe(31);

    const jan1 = parseLocalDate("2025-01-01");
    expect(jan1!.getFullYear()).toBe(2025);
    expect(jan1!.getMonth()).toBe(0);
    expect(jan1!.getDate()).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Subscription access matrix
// ═════════════════════════════════════════════════════════════════════════════

describe("computeAccessLevel — null / no subscription", () => {
  it("returns 'blocked' when there is no subscription", () => {
    expect(computeAccessLevel(null)).toBe("blocked");
  });
});

describe("computeAccessLevel — suspended status", () => {
  it("returns 'blocked' for suspended, even with a future end_date", () => {
    const sub: Subscription = {
      ...baseSub,
      status: "suspended",
      end_date: localDateStr(30), // end_date is 30 days in the future
    };
    expect(computeAccessLevel(sub)).toBe("blocked");
  });

  it("returns 'blocked' for suspended with no end_date", () => {
    expect(computeAccessLevel({ ...baseSub, status: "suspended", end_date: null })).toBe("blocked");
  });
});

describe("computeAccessLevel — active window (end_date is source of truth)", () => {
  it("returns 'full' when status='active' and today < end_date", () => {
    const sub: Subscription = { ...baseSub, status: "active", end_date: localDateStr(10) };
    expect(computeAccessLevel(sub)).toBe("full");
  });

  it("returns 'full' when status='active' and today === end_date (last valid day)", () => {
    const sub: Subscription = { ...baseSub, status: "active", end_date: localDateStr(0) };
    expect(computeAccessLevel(sub)).toBe("full");
  });

  /**
   * KEY TEST: A stale "expired" status must NOT block access when end_date
   * is still in the future. This is the core invariant being protected.
   */
  it("returns 'full' when status='expired' but end_date is still in the future (stale status bug)", () => {
    const sub: Subscription = { ...baseSub, status: "expired", end_date: localDateStr(5) };
    expect(computeAccessLevel(sub)).toBe("full");
  });

  it("returns 'full' on the exact end_date even if status='expired'", () => {
    const sub: Subscription = { ...baseSub, status: "expired", end_date: localDateStr(0) };
    expect(computeAccessLevel(sub)).toBe("full");
  });
});

describe("computeAccessLevel — grace period (1–3 days after end_date)", () => {
  it("returns 'grace' at 1 day past end_date", () => {
    const sub: Subscription = { ...baseSub, status: "expired", end_date: localDateStr(-1) };
    expect(computeAccessLevel(sub)).toBe("grace");
  });

  it("returns 'grace' at 2 days past end_date", () => {
    const sub: Subscription = { ...baseSub, status: "expired", end_date: localDateStr(-2) };
    expect(computeAccessLevel(sub)).toBe("grace");
  });

  it("returns 'grace' on the last grace day (3 days past end_date)", () => {
    const sub: Subscription = { ...baseSub, status: "expired", end_date: localDateStr(-3) };
    expect(computeAccessLevel(sub)).toBe("grace");
  });

  it("returns 'grace' even when status='active' during grace window (stale status)", () => {
    const sub: Subscription = { ...baseSub, status: "active", end_date: localDateStr(-2) };
    expect(computeAccessLevel(sub)).toBe("grace");
  });
});

describe("computeAccessLevel — beyond grace (readonly)", () => {
  it("returns 'readonly' at 4 days past end_date (just outside grace)", () => {
    const sub: Subscription = { ...baseSub, status: "expired", end_date: localDateStr(-4) };
    expect(computeAccessLevel(sub)).toBe("readonly");
  });

  it("returns 'readonly' at 30 days past end_date", () => {
    const sub: Subscription = { ...baseSub, status: "expired", end_date: localDateStr(-30) };
    expect(computeAccessLevel(sub)).toBe("readonly");
  });

  it("returns 'full' when status is active and end_date is null (open-ended)", () => {
    const sub: Subscription = { ...baseSub, status: "active", end_date: null };
    expect(computeAccessLevel(sub)).toBe("full");
  });

  it("returns 'readonly' when status is expired and end_date is null", () => {
    const sub: Subscription = { ...baseSub, status: "expired", end_date: null };
    expect(computeAccessLevel(sub)).toBe("readonly");
  });
});

describe("computeAccessLevel — multi-tenant isolation (distinct dealer_ids)", () => {
  it("each dealer's subscription is evaluated independently", () => {
    const activeDealer: Subscription = {
      ...baseSub,
      dealer_id: "dealer-A",
      status: "active",
      end_date: localDateStr(20),
    };
    const expiredDealer: Subscription = {
      ...baseSub,
      dealer_id: "dealer-B",
      status: "expired",
      end_date: localDateStr(-10),
    };

    expect(computeAccessLevel(activeDealer)).toBe("full");
    expect(computeAccessLevel(expiredDealer)).toBe("readonly");
  });

  it("suspended dealer does not affect another dealer's access", () => {
    const suspendedDealer: Subscription = {
      ...baseSub,
      dealer_id: "dealer-C",
      status: "suspended",
      end_date: localDateStr(30),
    };
    const healthyDealer: Subscription = {
      ...baseSub,
      dealer_id: "dealer-D",
      status: "active",
      end_date: localDateStr(10),
    };

    expect(computeAccessLevel(suspendedDealer)).toBe("blocked");
    expect(computeAccessLevel(healthyDealer)).toBe("full");
  });
});
