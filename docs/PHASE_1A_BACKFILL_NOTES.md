# Phase 1A — Historical Data Audit & Backfill Decision

> **Status:** decision document. The backfill itself is **not** part of
> Phase 1A. Phase 1A fixes the math going forward and adds a sentinel
> column (`sales.cogs_method`) so the legacy state is visible.
> Whether to run a backfill at all is a Phase 1B decision.

---

## The bug

Defect summary (verified against the schema and the live code paths):

- For sales with `products.unit_type = 'box_sft'`, the COGS calculation
  on the pre-Phase-1A `routes/sales.ts` lines 512 (POST) and 975 (PUT)
  was dimensionally wrong: `boxes × ৳/sft`.
- The revenue calculation on the same code path was correct because it
  performed an explicit boxes → sft conversion before multiplying by
  the per-sft `sale_rate`.
- Net effect: `sales.cogs`, `sales.gross_profit`, `sales.net_profit`,
  and (by extension) the legacy `sales.profit` field were all
  understated by a factor of `per_box_sft` (typically 4 to 25) for
  every tile sale.

Confirmation example (per the brutal review):
- `per_box_sft = 20`, `purchase = 200 ৳/sft`, `sale = 5 boxes`.
- Stored `sales.cogs = 5 × 200 = ৳1,000`.
- Correct value = `5 × 20 × 200 = ৳20,000`.
- Understatement factor = 20 (i.e., `1 / per_box_sft`).

Piece-unit (sanitary) sales are unaffected.

## Quantifying impact per dealer

Run on a read-only restore of the production database:

```sql
SELECT
  s.dealer_id,
  COUNT(*) FILTER (WHERE p.unit_type = 'box_sft' AND s.cogs_method = 'legacy_pre_fix')
                                                                      AS legacy_tile_sale_count,
  SUM(s.cogs) FILTER (WHERE p.unit_type = 'box_sft' AND s.cogs_method = 'legacy_pre_fix')
                                                                      AS stored_legacy_tile_cogs,
  SUM(si.quantity * p.per_box_sft * st.average_cost_per_unit)
       FILTER (WHERE p.unit_type = 'box_sft' AND s.cogs_method = 'legacy_pre_fix')
                                                                      AS approx_correct_tile_cogs,
  COUNT(*) FILTER (WHERE p.unit_type = 'piece')                       AS sanitary_sale_count,
  SUM(s.cogs) FILTER (WHERE p.unit_type = 'piece')                    AS sanitary_cogs_unchanged
FROM sales s
JOIN sale_items si ON si.sale_id = s.id
JOIN products    p ON p.id = si.product_id
JOIN stock       st ON st.product_id = p.id AND st.dealer_id = s.dealer_id
GROUP BY s.dealer_id
ORDER BY legacy_tile_sale_count DESC;
```

Expected per-dealer ratio:
`stored_legacy_tile_cogs / approx_correct_tile_cogs ≈ 1 / per_box_sft`
(typically 0.04 to 0.25). The approximation `approx_correct_tile_cogs`
uses the *current* `average_cost_per_unit` rather than the value at
each sale's timestamp; see the next section for why exact
reconstruction is impossible.

## Can the true historical COGS be recovered? — No, only approximately.

A truly correct historical COGS at sale time would be:

```
true_cogs = effectiveQty_at_sale × perBoxSft_at_sale × avgCost_at_sale
```

Recoverability of each input:

| Input | Recoverable? | Notes |
|---|---|---|
| `effectiveQty_at_sale` | Yes, exactly | `sale_items.quantity` or `box_qty + piece_qty / pieces_per_box`. |
| `perBoxSft_at_sale` | Approximately | No per-row snapshot. `products.per_box_sft` may have been edited, but in BD shops this is rare (it is a physical tile property). |
| `avgCost_at_sale` | **Not exactly** | `stock.average_cost_per_unit` is mutated on every purchase. No point-in-time snapshot exists. Walking `purchase_items` + `stock_ledger` forward in time can approximate it, but historical adjustments (stock corrections, broken-stock dialogs) corrupt the chain. |

So a perfect historical reconstruction is impossible without a
breaking schema change. The best practical correction is the
"current-value approximation" formula:

```
backfilled_cogs = stored_cogs × current_per_box_sft
```

This corrects the unit error exactly, but bakes in any drift between
the cost at sale time and the current cost. For dealers whose tile
catalogue cost has been stable, the approximation is excellent. For
dealers with volatile import costs, it can still be off by ±10–30%.

## Backfill options considered

| Option | Description | Accuracy | Operational risk |
|---|---|---|---|
| A | Multiply `legacy_pre_fix` rows' `cogs` by current `products.per_box_sft`. | High for stable products; approximate for volatile ones. | Low. Reversible (we keep the original value in an audit table). |
| B | Recompute fully using current `average_cost_per_unit` × `per_box_sft` × `effectiveQty`. | Same accuracy as A; ignores the original cost-at-sale-time. | Same as A. |
| C | Walk `stock_ledger` / `purchase_items` backwards to reconstruct WAC at each sale's timestamp. | Highest possible accuracy. | High complexity; brittle to historical adjustments; weeks of work to ship safely. |
| D | Leave legacy rows untouched. Surface them honestly via `warnings[]`. | Zero correction; 100% honest. | None. |

## Decision for Phase 1A: **Option D.**

Phase 1A intentionally does NOT modify any existing `sales.cogs`
value. Every legacy row retains `cogs_method = 'legacy_pre_fix'` and
its original (understated) value. The P&L and Trial Balance endpoints
detect such rows in the queried period and append a precise warning
to the response's `warnings[]` array. The frontend's existing
"Data quality notes" banner (from PR #1) renders that warning.

### Why not auto-backfill

1. **Trust.** Dealers see one number change (new sales onward) instead
   of two (new sales + a silent historical rewrite). One sticker shock
   is easier to communicate than two.
2. **Disputes.** Some dealers may have already closed books for past
   months on the old numbers. Silently rewriting their history
   creates audit-trail problems even if the rewrite is more accurate.
3. **Provenance.** Option A is approximate. Approximate corrections
   must be deliberately invoked, not silently applied.

## Plan for Phase 1B (separate decision, separate PR)

If, after Phase 1A is live for a release cycle, dealer support is
flooded with "fix my history too" requests, ship an opt-in tool with
these properties:

- Per-dealer button in admin settings: "Recompute my historical
  cost-of-goods".
- Uses **Option A** (`cogs *= current per_box_sft`) with a clear
  on-screen explanation that the result is approximate.
- For each row touched, writes a provenance entry to a new
  `sales_cogs_backfill_audit` table containing the original `cogs`,
  the new value, the `per_box_sft` used, and the timestamp.
- Flips `cogs_method` from `'legacy_pre_fix'` to
  `'recomputed_approx'`. The P&L `warnings[]` text for that state
  becomes: "N sales were recomputed approximately on `<date>`.
  Drill-down available."
- Idempotent and reversible — running the tool twice on the same row
  is a no-op; an "undo backfill" flips it back.

## Communication template (dealer-facing)

For the **forward-only** banner (always shown after Phase 1A deploy):

> Cost-of-goods on tile sales was updated on `<deploy-date>`. Tile
> profit is now reported correctly. Past months will continue to use
> the older calculation until you choose to recompute them — contact
> support if you need historical numbers updated.

For the **period-dependent** banner (rendered only when the selected
range contains `legacy_pre_fix` rows):

> N tile sales in this period were recorded before the cost-of-goods
> correction. Their cost is approximate (understated) and the profit
> shown for those rows is therefore conservative-high. A re-calculation
> tool will be available shortly.

Both strings come from the backend `warnings[]` array; no UI work is
required in Phase 1A — the banner already exists from PR #1.
