# Production-Readiness Audit & Fixes — July 2026

End-to-end QA/security audit of the ERP (app.sanitileserp.com / api.sanitileserp.com)
covering login, all modules, workflows, permissions, validation, performance,
and error handling — followed by the fixes applied.

- **Method:** live API probing + full source review (backend Express/Knex + React
  frontend), verified against the code.
- **Result of fixes:** all P0 + P1 + safe P2/P3 items implemented. Backend and
  frontend both build for production (`tsc` and `vite build` pass).
- **Deploy steps:** see `docs/DEPLOY_THESE_FIXES.md`.

Severity legend: 🔴 Critical · 🟠 High · 🟡 Medium.

---

## Fixed — money & data integrity (P0)

| Sev | Issue | Fix |
|-----|-------|-----|
| 🔴 | Concurrent sales oversold stock (availability read without a lock; deduct RPC floored at 0) | Re-read stock `FOR UPDATE` inside the transaction and re-validate before deducting; reject when backorder off |
| 🔴 | A reversed/cancelled sale could be returned again → double refund + phantom stock | Block returns against reversed/cancelled sales |
| 🔴 | Two simultaneous returns bypassed the over-return cap | Moved over-return + cumulative-refund checks inside the tx under a sale row lock |
| 🔴 | Manual ledger endpoint wrote one-sided entries; salesman-accessible | Admin-only; block direct cash writes; customer/supplier limited to adjustments |
| 🔴 | Commission payout posted positive → cash inflated ~2× per payout | Store payout as a negative cash entry |
| 🔴 | Credit-limit gate ignored the new sale amount and raced | Check `outstanding + saleTotal`; lock customer row during the sale |

## Fixed — access control & availability (P0/High)

| Sev | Issue | Fix |
|-----|-------|-----|
| 🟠 | Rate limiting was a no-op behind Cloudflare (counters never decremented) | Key limiters on `CF-Connecting-IP` |
| 🟠 | Subscription expiry enforced only in the browser | Server-side paywall middleware blocks writes when expired/suspended |
| 🟠 | Payroll (salary-component) writes had no role check | Added `dealer_admin`/`manager` guard |
| 🟠 | Cost price leaked to salesmen via auto-PO suggestions | Admin-gated the endpoint |
| 🟠 | Async errors could hang requests / crash the process | Process-level handlers, async wrappers, safeParse; malformed JSON now 400 not 500 |

## Fixed — financial correctness (P1)

| Sev | Issue | Fix |
|-----|-------|-----|
| 🟠 | Reversed sales still counted in P&L / balance sheet / trial balance | Excluded reversed sales everywhere |
| 🟠 | Revenue was VAT-inclusive; VAT had no liability account | Revenue reported ex-tax; VAT/SD split into Payable liabilities; profit on the taxable base (no change for VAT-off dealers) |
| 🟠 | Challan item-edit dropped VAT and could go negative | Routed through the VAT engine; clamped at 0 |
| 🟠 | Journal entries were hard-deleted (audit trail destroyed) | Soft-void (migration 066); excluded from balances |
| 🟠 | convert-invoice silently masked reservation drift | Assert reservation covers the invoiced quantity |
| 🟡 | No DB backstop on invoice/challan/delivery numbers | Partial UNIQUE indexes (migration 067) |

## Fixed — hardening (P2) & frontend (P3)

| Sev | Issue | Fix |
|-----|-------|-----|
| 🟡 | Over-discount produced negative totals | Reject discount > subtotal; clamp due ≥ 0 |
| 🟡 | Warehouse transfer request/receive not admin-gated | Added admin guard |
| 🟡 | Commission upsert had no guard/ceiling | Admin-only + cannot exceed the sale total |
| 🟡 | Unbounded HR list endpoints (DoS) | Safety caps + optional pagination on attendance/salary/advances |
| 🟡 | Raw Zod validation errors leaked on login | Clean `{error, issues}` shape |
| 🟡 | Failed data loads looked like empty lists | Global query-error toast |
| 🟡 | Double-click posted duplicate money records (HR) | Submit guards + disabled buttons |

---

## Deliberately NOT changed (needs a decision or a real-browser pass)

- **Broken-return COGS:** current behaviour is correct (destroyed goods keep
  their cost as the loss); adding a write-off would double-count. Only an
  optional "breakage expense" reporting line is missing — a business decision.
- **i18n (Bengali UI):** the app has Bengali only on print templates; a real
  translation framework is a separate project.
- **Accessibility (labels), replacing native confirm() dialogs, HR loading
  spinners:** high-volume UI polish that needs visual QA in a browser.
- **Refresh token in localStorage → HttpOnly cookie, and a Content-Security-
  Policy:** need a coordinated frontend change and nginx config; do with testing.
- **Money stored as floating point:** systemic; convert to integer minor units
  with a full test pass.
- **Display/sample stock uses a separate `current_stock` column:** should point
  at the canonical stock table; needs testing to avoid breaking that feature.

## Known follow-ups
- Delivery/challan numbering still uses `COUNT(*)+1`; the new UNIQUE index makes a
  collision fail loudly instead of silently duplicating — move to the sequence
  RPC in a controlled change.
- After deploy, validate on staging: rate limiter decrements, subscription
  paywall, and the concurrent-sale / return locks under load.
