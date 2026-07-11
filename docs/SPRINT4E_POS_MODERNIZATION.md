# V2 Sprint 4E — POS Modernization (Completion Report)

**Branch:** `v2/sprint-4e-pos-modernization` (based on `v2/sprint-4d-returns-exchange`, tip `b969d4a`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Sprints 2 through 4D are frozen — no file any of those sprints created or modified was touched. Zero backend/database changes. No new business features. No POS workflow changes — this sprint replaces *how* POS fetches data, not *what* POS does with it.

---

## 1. Inspection — what already existed vs. what was genuinely Supabase-dependent

The project's own `docs/ERP_V2_IMPLEMENTATION_ROADMAP.md` (§"F2. Supabase Removal") explicitly flagged **"POS product lookup (POSSalePage) — currently broken in prod"** as a known, real production risk from an incomplete Supabase-removal migration — this sprint closes that specific gap, not a hypothetical one.

Inspection of `src/pages/sales/POSSalePage.tsx` (432 lines, read in full) found exactly two remaining Supabase call sites, both read-only lookups feeding the POS screen's product search and customer picker. Everything else in the file was already fully ported:

| Data flow | Status before this sprint |
|---|---|
| Product search/lookup | ❌ Still a direct `supabase.from("products")` query |
| Customer picker | ❌ Still a direct `supabase.from("customers")` query |
| Sale submission (checkout) | ✅ Already VPS-backed via `salesService.create()` — zero changes needed |
| Bank account list (for cash/bank payment) | ✅ Already VPS-backed via `bankAccountService` |

No other POS-specific file exists anywhere in the codebase (`find src -iname "*pos*"` returns only `POSSalePage.tsx` plus unrelated `posting*` files). `ChallanPage.tsx`'s own Supabase usage (a `show_price` toggle) is a separate, non-POS module and was correctly left untouched, as was the shared Supabase client itself (`src/integrations/supabase/client.ts`) and its ~8 other non-POS consumers.

---

## 2. What Sprint 4E changed

Both Supabase queries were replaced with the **existing** VPS-backed services already used by every other module — `productService.list()` and `customerService.list()` — reusing the same `GET /api/products` and `GET /api/customers` endpoints, with zero new backend routes, migrations, or endpoints.

### Behavior-parity work (not new features — reproducing exact prior behavior on a new transport)

The two originals had subtly different shapes than what the shared services exposed out of the box, so preserving "do not change POS business workflows" required two small, backward-compatible extensions rather than a drop-in swap:

- **Products** — the original query was `.eq(active,true).order("name").limit(20)`, optionally `.or()`-filtered by search across `name`/`sku`/`barcode`. `productService.list()` already accepted an `active` filter and a search that ORs across those same 3 columns plus 2 more (`series`, `collection_name` — a strict superset, so it can only match *more*, never fewer, of what the old search matched), but had no way to override its hardcoded `orderBy: created_at desc` / 25-row page. A first pass sorted the returned page client-side by name and sliced to 20 — but that's **not** equivalent to "the alphabetically-first 20" when more than one page of active products matches a search (or matches nothing, i.e. "browse all"): it would silently return "20 of the 25 most-recently-created matches, sorted," not "the true first 20 alphabetically." Caught and fixed before committing by extending `productService.list()` with two new optional trailing parameters, `orderBy` and `pageSize`, both defaulting to the pre-existing behavior (`{ column: "created_at", direction: "desc" }`, 25) — every other call site (Damage, Pricing Tiers, CommandPalette, QuotationForm, AreaCalculatorDialog, ProductList) is unaffected. POS now calls it with `orderBy: { column: "name", direction: "asc" }, pageSize: 20`, so the database itself returns the correct alphabetically-first 20 rows, exactly reproducing `.order("name").limit(20)`.
- **Customers** — the original query had **no limit at all**: it fetched every active customer for the dealer. `customerService.list()`'s default page size is 25, which would have silently truncated the POS customer dropdown for any dealer with more than 25 active customers — a real regression risk. Extended `customerService.list()` with two new optional trailing parameters, `statusFilter` and `pageSize`, both defaulting to the pre-existing behavior (no status filter, 25-row page) — every existing call site unaffected. POS now calls it with `statusFilter: "active", pageSize: 200` (the backend's own hard ceiling on `GET /api/customers` — the same ceiling every other paginated list in the app already respects, not a POS-specific limitation).
- **`enabled: !!dealerId`** was added to the customers query (the products and bank-account queries in this same file already had it). The original Supabase query silently returned nothing if fired before `dealerId` resolved; the VPS call would instead send a request with a literal `dealerId=undefined` and likely fail visibly. This guard is a defensive, non-behavior-changing addition consistent with the rest of the file, not a new business rule.
- Both responses now carry the full product/customer row (`SELECT *` on the backend) instead of the original's narrow column list (`id, name, sku, unit_type, per_box_sft, default_sale_rate, barcode` / `id, name, price_tier_id`) — more data per row, not less. Confirmed by direct backend code inspection that `stripCostForSalesman()` (used for the salesman role, who uses POS) strips only cost-price fields, never `default_sale_rate` or any customer field, so nothing sensitive is newly exposed and POS still receives everything it needs.

### Files changed

| File | Change |
|---|---|
| `src/pages/sales/POSSalePage.tsx` | Removed the `supabase` client import; added `productService`/`customerService` imports; replaced both `useQuery` data-fetching bodies with calls into those services. Cart logic, checkout (`salesService.create()`), and all UI rendering are byte-for-byte unchanged. |
| `src/services/productService.ts` | +2 new optional trailing parameters on `list()`: `orderBy`, `pageSize` — both default to the pre-existing values. |
| `src/services/customerService.ts` | +2 new optional trailing parameters on `list()`: `statusFilter`, `pageSize` — both default to the pre-existing values. |

**Deliberately NOT touched:** `src/integrations/supabase/client.ts` (still required by `ChallanPage.tsx`, `PortalUsersPage.tsx`, `DealerUsersOverview.tsx`, `SARevenuePage.tsx`, `SACmsPage.tsx`, `SADealerPaymentsPage.tsx`, `portalService.ts`, `useCmsContent.ts`, and `dataClient`'s Supabase adapter fallback); any backend route, migration, or service; the cart/checkout logic in `POSSalePage.tsx` itself.

---

## 3. Database Impact

**None.** Zero migrations, zero schema changes. This sprint touches only frontend data-fetching code.

## 4. API Impact

**None.** No new endpoint, no changed endpoint contract. Both `GET /api/products` and `GET /api/customers` already supported every parameter this sprint now sends (`f.active`, `f.status`, `search`, `orderBy`, `orderDir`, `pageSize` capped at 200) before this sprint began — only the frontend service wrappers gained new *optional* parameters to actually reach those already-existing capabilities.

## 5. Testing Results

- **Backend:** zero backend files touched. `npx vitest run` — **230/230 pass**, unchanged from Sprint 4D. `npx tsc` (backend build) — only the same pre-existing Sprint 3B `warehouseTransferStock.test.ts` TS18048 issue every prior sprint's report has documented; not new, not related to this sprint.
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the same pre-existing `portalService.ts` issue). `npx vitest run` — **333/333 pass** (5 new + 328 prior): 2 new in `productsServiceRewire.test.ts` (orderBy/pageSize default-preservation and override), 3 new in `customerService.sprint4e.test.ts` (statusFilter/pageSize default-preservation and override). `npm run build` succeeds cleanly (same pre-existing chunk-size warning as every prior sprint — not new).
- **Not performed in this environment:** live interactive POS click-through testing (no browser available here). The Manual QA checklist below should be run against a real dealer account before this is considered fully verified in prod.

## 6. Manual QA Checklist

- [ ] **Product search (regression)** — open POS, confirm the initial (empty-search) product list shows up to 20 active products in alphabetical order, identical to before.
- [ ] **Product search with a query** — type a product name, SKU, or barcode; confirm matching active products still appear, still capped at 20, still alphabetical.
- [ ] **Product search — series/collection (new, superset-only)** — confirm a search term that matches a product's series or collection name (but not its name/sku/barcode) now also surfaces that product — this is a strict superset of the old search, never a regression.
- [ ] **Customer dropdown (regression)** — for a dealer with more than 25 active customers, confirm the full active-customer list still appears in the POS customer picker (not truncated at 25).
- [ ] **Checkout (regression)** — complete a POS sale end-to-end (product + customer selection, quantity, payment mode, submit); confirm it posts exactly as before — this code path was not touched.
- [ ] **Cost price not leaked** — log in as a salesman-role user, confirm the POS product list still does not expose `cost_price`.
- [ ] Confirm no console errors referencing Supabase appear when using POS.

## 7. Rollback Plan

1. **Not yet merged/deployed** — safe to discard the branch entirely if needed.
2. **After merge:** `git revert` the sprint commit — every change is additive (new optional parameters with pre-existing defaults) or a like-for-like data-source swap; no existing route, component, or business rule was altered.
3. **DB rollback:** not applicable — no migration in this sprint.
4. **Partial rollback:** not needed — the two `useQuery` bodies in `POSSalePage.tsx` are independent of each other and of the rest of the file; either can be reverted alone without affecting checkout or the other lookup.

## 8. Explicitly out of scope (per Sprint 4E instructions — not done)

- No POS business-workflow changes — cart, discounting, payment-mode handling, and checkout logic are untouched.
- No new business features.
- No backend, database, or API changes — this is a pure frontend infrastructure swap reusing already-existing VPS endpoints.
- The shared Supabase client and its other ~8 non-POS consumers — untouched; Supabase is not being removed from the app as a whole, only from the POS module.
- Live browser click-through testing — not performed in this environment; captured as a Manual QA checklist above instead.
