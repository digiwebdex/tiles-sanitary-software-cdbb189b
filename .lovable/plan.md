# Purchase Form Upgrade Plan

Keep everything strong about the current form (tile SFT↔Box, landed cost, batch/lot/shade/caliber, last-rate hints, supplier advisory, atomic backorder allocation). Add the genuinely useful ideas from the BanglaERP screenshot.

## What you'll see in the UI

```text
┌──────────────────────────────────────────────────┬──────────────────────┐
│ Supplier · Reference · Date · Notes              │  PURCHASE SUMMARY    │
├──────────────────────────────────────────────────┤  (sticky on scroll)  │
│ 🔍 Product search   📷 Barcode scan              │                      │
├──────────────────────────────────────────────────┤  Lines        3      │
│ # Product   Qty  Rate  Disc%  Total   [▾] [🗑]   │  Subtotal  12,400    │
│   ▼ expanded: Transport/Labor/Other,             │  Transport    400    │
│     Batch · Lot · Shade · Caliber,               │  Labor        100    │
│     Tile SFT toggle, Landed cost / SFT           │  Other        ─      │
│ # Product …                                      │  Voucher Disc 200    │
├──────────────────────────────────────────────────┤  ─────────────       │
│ [+ Add Product]                                  │  Net Payable 12,700  │
│                                                  │  Paid Now    5,000   │
│ Voucher Discount: [______]  Paid Now: [______]   │  Total Due   7,700   │
│                                                  │                      │
│ [Save as Draft]            [Submit Purchase]     │  [Submit Purchase]   │
└──────────────────────────────────────────────────┴──────────────────────┘
```

Layout: **hybrid table** — compact row by default (Product, Qty, Rate, Disc%, Total, actions), click chevron to expand and reveal landed-cost fields, batch/lot/shade/caliber, and the tile SFT↔Box toggle. Card-per-item layout is replaced.

## Scope (in order)

1. **Hybrid table + expand row layout** in `PurchaseForm.tsx`. All existing inputs preserved, just reorganized. Mobile falls back to stacked rows.
2. **Sticky right-side Purchase Summary panel.** Live-recomputed from `watch()`. Shows: line count, subtotal, transport, labor, other, voucher discount, net payable, paid now, total due. Sticky on `lg+`, collapses to a bottom sheet on mobile.
3. **Voucher-level discount + Paid Now.** New form fields; backend stores discount and creates an immediate cash/bank ledger entry for the paid amount.
4. **Barcode scanner input** beside product search. Buffers keystrokes, resolves SKU/barcode against `/api/products`, auto-appends a line, plays a soft beep, clears for next scan.
5. **Save as Draft.** Persist the in-progress purchase to a new `purchase_drafts` table; reload on demand from a "Drafts" dropdown on the page.

## Backend changes

**Migration `050_purchases_discount_paid_drafts.ts`:**

- `ALTER TABLE purchases ADD COLUMN voucher_discount numeric(14,2) NOT NULL DEFAULT 0`
- `ALTER TABLE purchases ADD COLUMN paid_on_create numeric(14,2) NOT NULL DEFAULT 0`
- `ALTER TABLE purchases ADD COLUMN paid_account_id uuid NULL` (FK `cash_accounts` for which cash/bank was debited)
- New table `purchase_drafts (id, dealer_id, created_by, payload jsonb, updated_at)` with dealer-scoped composite index. No RLS — backend enforces `req.dealerId` like every other table.

**Endpoint changes** in `backend/src/routes/purchases.ts`:

- `POST /api/purchases` — accept `voucher_discount`, `paid_on_create`, `paid_account_id`. In the same transaction that already handles items + batches + stock + avg cost + ledger + backorder (Phase 3K), also:
  - subtract `voucher_discount` from supplier payable ledger entry
  - if `paid_on_create > 0`: insert a cash ledger entry (debit cash account, credit supplier) and a payment receipt row reusing the existing Base36 receipt generator
- `GET /api/purchases/drafts?dealerId=` — list drafts for current user
- `POST /api/purchases/drafts` — upsert draft (id optional)
- `DELETE /api/purchases/drafts/:id`
- Salesman role blocked from drafts + paid_on_create (consistent with existing access-constraints memory).

## Frontend changes

- `src/modules/purchases/purchaseSchema.ts` — add `voucher_discount`, `paid_on_create`, `paid_account_id` (all optional, default 0, `z.coerce.number()`).
- `src/modules/purchases/PurchaseForm.tsx` — full reorganize into hybrid table + sticky `PurchaseSummaryPanel` subcomponent. All existing logic (`calcBaseCost`, `calcLandedCost`, `calcTotalSft`, tile SFT toggle, `lastPurchaseMap`, `avgCostMap`, `SupplierAdvisoryHint`) preserved.
- New components in `src/modules/purchases/`:
  - `PurchaseSummaryPanel.tsx` — pure presentational, takes computed totals.
  - `BarcodeScanInput.tsx` — keystroke-buffered input, `Enter` triggers resolve.
  - `PurchaseDraftMenu.tsx` — dropdown to load/delete drafts.
- `src/services/purchaseService.ts` — pass new fields in `create()`; add `listDrafts`, `saveDraft`, `deleteDraft`.
- `src/pages/purchases/CreatePurchase.tsx` — wire Save-as-Draft mutation and load-draft handling; no structural change.

## What's intentionally NOT included (per earlier comparison)

- Payment-method dropdown on the form (we already have Cashbook + Collections — `paid_account_id` covers the "I paid X right now" case).
- Per-line warehouse picker (defer until multi-warehouse becomes a real ask).
- Bengali toggle (UI is English-only per Language Policy).
- "Invoice Process Data / Import Selected" block (cosmetic, no real workflow).
- File attachments (separate ask — already have file-manager service).

## Acceptance checks

- Existing purchase create flow (without discount/paid) behaves identically — same ledger, same batches, same backorder allocation, same audit log.
- New purchase with voucher discount + paid_on_create produces: 1 supplier ledger entry (net payable), 1 cash ledger entry (paid), 1 payment receipt. Sum reconciles.
- Save draft → reload page → reopen draft → all fields, items, tile SFT toggles restored.
- Barcode scan: typing `TILE-001` + Enter adds the matching product line; duplicate scan is a no-op with toast.
- Salesman role: drafts hidden, `paid_on_create` field hidden, voucher discount hidden.
- Tile SFT→Box rounding, last-rate hint, avg-cost hint, supplier advisory all still work.

## Rollout

Single deploy: migration `050_*` + backend route changes + frontend changes. Idempotent — old purchases get `voucher_discount=0, paid_on_create=0` defaults. Documented as **VPS Migration Phase 3U-31** in `mem://migration/`.
