import type { Knex } from 'knex';

/**
 * V2 Sprint 3C — Reservation, Backorder & Availability Engine.
 *
 * CRITICAL FIX FIRST: `backend/src/routes/reservations.ts` has called
 * `create_stock_reservation` / `release_stock_reservation` /
 * `expire_stale_reservations` via `db.raw(...)` since Phase 3R, but those
 * three PL/pgSQL functions were only ever defined in the old Supabase
 * migration history (`supabase/migrations/20260415191130_*.sql`) and were
 * NEVER ported to this Knex/VPS chain — the same class of gap migration
 * 057 already fixed for the sale-side RPCs (`allocate_sale_batches` etc.,
 * see that file's own header comment). Left as-is, every Reserve/Release/
 * Expire call in production would fail with "function does not exist".
 * This migration ports all three verbatim (no logic changes) so Sprint 3C's
 * very first requirement — Reserve Stock / Release Reservation — actually
 * works. Same for `dealers.enable_reservations`, which was added in the same
 * Supabase migration but never ported either; `dealerSettings.ts` currently
 * hardcodes the API response to `false` because the column didn't exist.
 *
 * Everything below this point is purely ADDITIVE: new nullable columns on
 * `stock_reservations` (location scoping + allocation priority). No existing
 * column is renamed/retyped/dropped, and no default changes behaviour for
 * existing rows — every reservation created before this migration keeps
 * working exactly as before (new columns default to NULL/0).
 *
 * Deliberately NOT added here (reused instead — see docs/SPRINT3C_*.md):
 *   - "Stock Allocation"     → reuses `stock_reservations` with
 *                              `source_type = 'allocation'` (already a free
 *                              -text column, no CHECK constraint — no schema
 *                              change needed for this discriminator).
 *   - "Display Stock"        → already fully built (`display_stock`,
 *                              `sample_issues`, `adjustSellableStock`,
 *                              `DisplaySampleStockPage.tsx`) — untouched.
 *   - "Supplier Backorder"   → reuses the existing `purchase_shortage_links`
 *                              table (already links a sale_item's shortage
 *                              to the purchase raised to cover it).
 */
export async function up(knex: Knex): Promise<void> {
  // ── Port the missing Supabase-era reservation RPCs to VPS (verbatim) ──
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.create_stock_reservation(
      _dealer_id uuid,
      _product_id uuid,
      _batch_id uuid,
      _customer_id uuid,
      _qty numeric,
      _unit_type text,
      _reason text DEFAULT NULL,
      _expires_at timestamptz DEFAULT NULL,
      _created_by uuid DEFAULT NULL
    )
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    DECLARE
      _reservation_id uuid;
      _batch record;
      _stock record;
    BEGIN
      IF _qty <= 0 THEN
        RAISE EXCEPTION 'Reserved quantity must be positive';
      END IF;

      IF _batch_id IS NOT NULL THEN
        SELECT box_qty, piece_qty, reserved_box_qty, reserved_piece_qty
        INTO _batch
        FROM public.product_batches
        WHERE id = _batch_id AND dealer_id = _dealer_id AND product_id = _product_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Batch not found for this product and dealer';
        END IF;

        IF _unit_type = 'box_sft' THEN
          IF (_batch.box_qty - _batch.reserved_box_qty) < _qty THEN
            RAISE EXCEPTION 'Insufficient free batch stock. Available: %, Requested: %',
              (_batch.box_qty - _batch.reserved_box_qty), _qty;
          END IF;
          UPDATE public.product_batches
            SET reserved_box_qty = reserved_box_qty + _qty
            WHERE id = _batch_id;
        ELSE
          IF (_batch.piece_qty - _batch.reserved_piece_qty) < _qty THEN
            RAISE EXCEPTION 'Insufficient free batch stock. Available: %, Requested: %',
              (_batch.piece_qty - _batch.reserved_piece_qty), _qty;
          END IF;
          UPDATE public.product_batches
            SET reserved_piece_qty = reserved_piece_qty + _qty
            WHERE id = _batch_id;
        END IF;
      END IF;

      SELECT reserved_box_qty, reserved_piece_qty INTO _stock
      FROM public.stock
      WHERE product_id = _product_id AND dealer_id = _dealer_id
      FOR UPDATE;

      IF FOUND THEN
        IF _unit_type = 'box_sft' THEN
          UPDATE public.stock SET reserved_box_qty = reserved_box_qty + _qty
          WHERE product_id = _product_id AND dealer_id = _dealer_id;
        ELSE
          UPDATE public.stock SET reserved_piece_qty = reserved_piece_qty + _qty
          WHERE product_id = _product_id AND dealer_id = _dealer_id;
        END IF;
      END IF;

      INSERT INTO public.stock_reservations (
        dealer_id, product_id, batch_id, customer_id,
        reserved_qty, reason, expires_at, created_by
      ) VALUES (
        _dealer_id, _product_id, _batch_id, _customer_id,
        _qty, _reason, _expires_at, _created_by
      ) RETURNING id INTO _reservation_id;

      RETURN _reservation_id;
    END;
    $$;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.release_stock_reservation(
      _reservation_id uuid,
      _dealer_id uuid,
      _release_reason text
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    DECLARE
      _res record;
      _remaining numeric;
      _unit text;
    BEGIN
      SELECT * INTO _res
      FROM public.stock_reservations
      WHERE id = _reservation_id AND dealer_id = _dealer_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found';
      END IF;

      IF _res.status <> 'active' THEN
        RAISE EXCEPTION 'Only active reservations can be released';
      END IF;

      _remaining := _res.reserved_qty - _res.fulfilled_qty - _res.released_qty;

      IF _remaining <= 0 THEN
        RAISE EXCEPTION 'No remaining quantity to release';
      END IF;

      UPDATE public.stock_reservations SET
        released_qty = released_qty + _remaining,
        release_reason = _release_reason,
        status = 'released'
      WHERE id = _reservation_id;

      SELECT unit_type INTO _unit FROM public.products WHERE id = _res.product_id;

      IF _res.batch_id IS NOT NULL THEN
        IF _unit = 'box_sft' THEN
          UPDATE public.product_batches SET reserved_box_qty = GREATEST(0, reserved_box_qty - _remaining)
          WHERE id = _res.batch_id;
        ELSE
          UPDATE public.product_batches SET reserved_piece_qty = GREATEST(0, reserved_piece_qty - _remaining)
          WHERE id = _res.batch_id;
        END IF;
      END IF;

      IF _unit = 'box_sft' THEN
        UPDATE public.stock SET reserved_box_qty = GREATEST(0, reserved_box_qty - _remaining)
        WHERE product_id = _res.product_id AND dealer_id = _dealer_id;
      ELSE
        UPDATE public.stock SET reserved_piece_qty = GREATEST(0, reserved_piece_qty - _remaining)
        WHERE product_id = _res.product_id AND dealer_id = _dealer_id;
      END IF;
    END;
    $$;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.expire_stale_reservations(_dealer_id uuid)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    DECLARE
      _res record;
      _remaining numeric;
      _unit text;
      _count integer := 0;
    BEGIN
      FOR _res IN
        SELECT * FROM public.stock_reservations
        WHERE dealer_id = _dealer_id
          AND status = 'active'
          AND expires_at IS NOT NULL
          AND expires_at < now()
        FOR UPDATE
      LOOP
        _remaining := _res.reserved_qty - _res.fulfilled_qty - _res.released_qty;

        UPDATE public.stock_reservations SET
          released_qty = released_qty + _remaining,
          release_reason = 'Auto-expired',
          status = 'expired'
        WHERE id = _res.id;

        SELECT unit_type INTO _unit FROM public.products WHERE id = _res.product_id;

        IF _res.batch_id IS NOT NULL THEN
          IF _unit = 'box_sft' THEN
            UPDATE public.product_batches SET reserved_box_qty = GREATEST(0, reserved_box_qty - _remaining)
            WHERE id = _res.batch_id;
          ELSE
            UPDATE public.product_batches SET reserved_piece_qty = GREATEST(0, reserved_piece_qty - _remaining)
            WHERE id = _res.batch_id;
          END IF;
        END IF;

        IF _unit = 'box_sft' THEN
          UPDATE public.stock SET reserved_box_qty = GREATEST(0, reserved_box_qty - _remaining)
          WHERE product_id = _res.product_id AND dealer_id = _dealer_id;
        ELSE
          UPDATE public.stock SET reserved_piece_qty = GREATEST(0, reserved_piece_qty - _remaining)
          WHERE product_id = _res.product_id AND dealer_id = _dealer_id;
        END IF;

        _count := _count + 1;
      END LOOP;

      RETURN _count;
    END;
    $$;
  `);

  // ── Port the missing enable_reservations dealer flag (default false — no
  //    behaviour change; the API previously hardcoded this to false anyway) ──
  const hasEnableReservations = await knex.schema.hasColumn('dealers', 'enable_reservations');
  if (!hasEnableReservations) {
    await knex.schema.alterTable('dealers', (t) => {
      t.boolean('enable_reservations').notNullable().defaultTo(false);
    });
  }

  // ── Sprint 3C additive columns on stock_reservations ──
  await knex.schema.alterTable('stock_reservations', (t) => {
    t.uuid('warehouse_id').references('id').inTable('warehouses').onDelete('SET NULL');
    t.uuid('godown_id').references('id').inTable('godowns').onDelete('SET NULL');
    t.uuid('rack_id').references('id').inTable('racks').onDelete('SET NULL');
    t.integer('priority').notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('stock_reservations', (t) => {
    t.index(['dealer_id', 'warehouse_id'], 'idx_stock_reservations_warehouse');
    t.index(['dealer_id', 'source_type', 'status'], 'idx_stock_reservations_source_type');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('stock_reservations', (t) => {
    t.dropIndex(['dealer_id', 'warehouse_id'], 'idx_stock_reservations_warehouse');
    t.dropIndex(['dealer_id', 'source_type', 'status'], 'idx_stock_reservations_source_type');
    t.dropColumn('warehouse_id');
    t.dropColumn('godown_id');
    t.dropColumn('rack_id');
    t.dropColumn('priority');
  });
  await knex.schema.alterTable('dealers', (t) => {
    t.dropColumn('enable_reservations');
  });
  await knex.raw(`
    DROP FUNCTION IF EXISTS public.expire_stale_reservations(uuid);
    DROP FUNCTION IF EXISTS public.release_stock_reservation(uuid, uuid, text);
    DROP FUNCTION IF EXISTS public.create_stock_reservation(uuid, uuid, uuid, uuid, numeric, text, text, timestamptz, uuid);
  `);
}
