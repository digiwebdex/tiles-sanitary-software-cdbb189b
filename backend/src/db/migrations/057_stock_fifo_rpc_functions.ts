import type { Knex } from 'knex';

/**
 * Stock FIFO RPCs required by sales.ts POST/PUT/DELETE.
 * Defined in Supabase migrations but never ported to Knex chain on VPS.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.allocate_sale_batches(
      _dealer_id uuid,
      _sale_item_id uuid,
      _product_id uuid,
      _unit_type text,
      _per_box_sft numeric,
      _allocations jsonb
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    DECLARE
      _alloc jsonb;
      _batch_id uuid;
      _qty numeric;
      _batch record;
      _new_box numeric;
      _new_piece numeric;
      _total_allocated numeric := 0;
      _ppb integer;
      _delta_pieces numeric;
      _total_delta_pieces numeric := 0;
    BEGIN
      SELECT COALESCE(pieces_per_box, 1) INTO _ppb
      FROM public.products WHERE id = _product_id;
      IF _ppb IS NULL OR _ppb < 1 THEN _ppb := 1; END IF;

      FOR _alloc IN SELECT * FROM jsonb_array_elements(_allocations)
      LOOP
        _batch_id := (_alloc->>'batch_id')::uuid;
        _qty := (_alloc->>'allocated_qty')::numeric;

        SELECT box_qty, piece_qty, sft_qty, total_pieces INTO _batch
        FROM public.product_batches
        WHERE id = _batch_id AND dealer_id = _dealer_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Batch % not found for dealer %', _batch_id, _dealer_id;
        END IF;

        IF _unit_type = 'box_sft' THEN
          _new_box := GREATEST(0, _batch.box_qty - _qty);
          _delta_pieces := _qty * _ppb;
          UPDATE public.product_batches SET
            box_qty = _new_box,
            sft_qty = _new_box * COALESCE(_per_box_sft, 0),
            total_pieces = GREATEST(0, COALESCE(total_pieces, 0) - _delta_pieces),
            status = CASE WHEN _new_box <= 0 THEN 'depleted' ELSE status END
          WHERE id = _batch_id;
        ELSE
          _new_piece := GREATEST(0, _batch.piece_qty - _qty);
          _delta_pieces := _qty;
          UPDATE public.product_batches SET
            piece_qty = _new_piece,
            total_pieces = GREATEST(0, COALESCE(total_pieces, 0) - _delta_pieces),
            status = CASE WHEN _new_piece <= 0 THEN 'depleted' ELSE status END
          WHERE id = _batch_id;
        END IF;

        INSERT INTO public.sale_item_batches (sale_item_id, batch_id, dealer_id, allocated_qty)
        VALUES (_sale_item_id, _batch_id, _dealer_id, _qty);

        _total_allocated := _total_allocated + _qty;
        _total_delta_pieces := _total_delta_pieces + _delta_pieces;
      END LOOP;

      IF _unit_type = 'box_sft' THEN
        UPDATE public.stock SET
          box_qty  = GREATEST(0, box_qty - _total_allocated),
          sft_qty  = GREATEST(0, box_qty - _total_allocated) * COALESCE(_per_box_sft, 0),
          total_pieces = GREATEST(0, COALESCE(total_pieces, 0) - _total_delta_pieces)
        WHERE product_id = _product_id AND dealer_id = _dealer_id;
      ELSE
        UPDATE public.stock SET
          piece_qty = GREATEST(0, piece_qty - _total_allocated),
          total_pieces = GREATEST(0, COALESCE(total_pieces, 0) - _total_delta_pieces)
        WHERE product_id = _product_id AND dealer_id = _dealer_id;
      END IF;

      UPDATE public.sale_items SET allocated_qty = _total_allocated
      WHERE id = _sale_item_id;
    END;
    $$;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.restore_sale_batches(
      _sale_item_id uuid,
      _product_id uuid,
      _dealer_id uuid,
      _unit_type text,
      _per_box_sft numeric
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    DECLARE
      _alloc record;
      _batch record;
      _new_box numeric;
      _new_piece numeric;
      _total_restored numeric := 0;
      _ppb integer;
      _delta_pieces numeric;
      _total_delta_pieces numeric := 0;
    BEGIN
      SELECT COALESCE(pieces_per_box, 1) INTO _ppb
      FROM public.products WHERE id = _product_id;
      IF _ppb IS NULL OR _ppb < 1 THEN _ppb := 1; END IF;

      FOR _alloc IN
        SELECT batch_id, allocated_qty
        FROM public.sale_item_batches
        WHERE sale_item_id = _sale_item_id AND dealer_id = _dealer_id
      LOOP
        SELECT box_qty, piece_qty, sft_qty, total_pieces INTO _batch
        FROM public.product_batches
        WHERE id = _alloc.batch_id
        FOR UPDATE;

        IF NOT FOUND THEN CONTINUE; END IF;

        IF _unit_type = 'box_sft' THEN
          _new_box := _batch.box_qty + _alloc.allocated_qty;
          _delta_pieces := _alloc.allocated_qty * _ppb;
          UPDATE public.product_batches SET
            box_qty = _new_box,
            sft_qty = _new_box * COALESCE(_per_box_sft, 0),
            total_pieces = COALESCE(total_pieces, 0) + _delta_pieces,
            status = 'active'
          WHERE id = _alloc.batch_id;
        ELSE
          _new_piece := _batch.piece_qty + _alloc.allocated_qty;
          _delta_pieces := _alloc.allocated_qty;
          UPDATE public.product_batches SET
            piece_qty = _new_piece,
            total_pieces = COALESCE(total_pieces, 0) + _delta_pieces,
            status = 'active'
          WHERE id = _alloc.batch_id;
        END IF;

        _total_restored := _total_restored + _alloc.allocated_qty;
        _total_delta_pieces := _total_delta_pieces + _delta_pieces;
      END LOOP;

      DELETE FROM public.sale_item_batches
      WHERE sale_item_id = _sale_item_id AND dealer_id = _dealer_id;

      IF _total_restored > 0 THEN
        IF _unit_type = 'box_sft' THEN
          UPDATE public.stock SET
            box_qty = box_qty + _total_restored,
            sft_qty = (box_qty + _total_restored) * COALESCE(_per_box_sft, 0),
            total_pieces = COALESCE(total_pieces, 0) + _total_delta_pieces
          WHERE product_id = _product_id AND dealer_id = _dealer_id;
        ELSE
          UPDATE public.stock SET
            piece_qty = piece_qty + _total_restored,
            total_pieces = COALESCE(total_pieces, 0) + _total_delta_pieces
          WHERE product_id = _product_id AND dealer_id = _dealer_id;
        END IF;
      END IF;
    END;
    $$;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.deduct_stock_unbatched(
      _product_id uuid,
      _dealer_id uuid,
      _unit_type text,
      _per_box_sft numeric,
      _quantity numeric
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    DECLARE
      _ppb integer;
      _delta_pieces numeric;
    BEGIN
      SELECT COALESCE(pieces_per_box, 1) INTO _ppb
      FROM public.products WHERE id = _product_id;
      IF _ppb IS NULL OR _ppb < 1 THEN _ppb := 1; END IF;

      IF _unit_type = 'box_sft' THEN
        _delta_pieces := _quantity * _ppb;
        UPDATE public.stock SET
          box_qty  = GREATEST(0, box_qty - _quantity),
          sft_qty  = GREATEST(0, box_qty - _quantity) * COALESCE(_per_box_sft, 0),
          total_pieces = GREATEST(0, COALESCE(total_pieces, 0) - _delta_pieces)
        WHERE product_id = _product_id AND dealer_id = _dealer_id;
      ELSE
        _delta_pieces := _quantity;
        UPDATE public.stock SET
          piece_qty = GREATEST(0, piece_qty - _quantity),
          total_pieces = GREATEST(0, COALESCE(total_pieces, 0) - _delta_pieces)
        WHERE product_id = _product_id AND dealer_id = _dealer_id;
      END IF;
    END;
    $$;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.consume_reservation_for_sale(
      _reservation_id uuid,
      _dealer_id uuid,
      _sale_item_id uuid,
      _consume_qty numeric
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
      IF _consume_qty <= 0 THEN
        RAISE EXCEPTION 'Consume quantity must be positive';
      END IF;

      SELECT * INTO _res
      FROM public.stock_reservations
      WHERE id = _reservation_id AND dealer_id = _dealer_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found';
      END IF;

      IF _res.status <> 'active' THEN
        RAISE EXCEPTION 'Only active reservations can be consumed';
      END IF;

      _remaining := _res.reserved_qty - _res.fulfilled_qty - _res.released_qty;

      IF _consume_qty > _remaining THEN
        RAISE EXCEPTION 'Cannot consume % — only % remaining on reservation', _consume_qty, _remaining;
      END IF;

      UPDATE public.stock_reservations SET
        fulfilled_qty = fulfilled_qty + _consume_qty,
        source_type = 'sale',
        source_id = _sale_item_id,
        status = CASE
          WHEN (fulfilled_qty + _consume_qty + released_qty) >= reserved_qty THEN 'fulfilled'
          ELSE 'active'
        END
      WHERE id = _reservation_id;

      SELECT unit_type INTO _unit FROM public.products WHERE id = _res.product_id;

      IF _res.batch_id IS NOT NULL THEN
        IF _unit = 'box_sft' THEN
          UPDATE public.product_batches
          SET reserved_box_qty = GREATEST(0, reserved_box_qty - _consume_qty)
          WHERE id = _res.batch_id;
        ELSE
          UPDATE public.product_batches
          SET reserved_piece_qty = GREATEST(0, reserved_piece_qty - _consume_qty)
          WHERE id = _res.batch_id;
        END IF;
      END IF;

      IF _unit = 'box_sft' THEN
        UPDATE public.stock SET reserved_box_qty = GREATEST(0, reserved_box_qty - _consume_qty)
        WHERE product_id = _res.product_id AND dealer_id = _dealer_id;
      ELSE
        UPDATE public.stock SET reserved_piece_qty = GREATEST(0, reserved_piece_qty - _consume_qty)
        WHERE product_id = _res.product_id AND dealer_id = _dealer_id;
      END IF;
    END;
    $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP FUNCTION IF EXISTS public.consume_reservation_for_sale(uuid, uuid, uuid, numeric);
    DROP FUNCTION IF EXISTS public.deduct_stock_unbatched(uuid, uuid, text, numeric, numeric);
    DROP FUNCTION IF EXISTS public.restore_sale_batches(uuid, uuid, uuid, text, numeric);
    DROP FUNCTION IF EXISTS public.allocate_sale_batches(uuid, uuid, uuid, text, numeric, jsonb);
  `);
}
