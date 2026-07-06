import { describe, expect, it } from 'vitest';
import { computeAvailabilityFromInputs, computeBatchAvailabilityFromInputs } from './availabilityService';

describe('computeAvailabilityFromInputs (V2 Sprint 3C Availability Engine)', () => {
  it('with no reservations/display/pending, available equals current stock', () => {
    const r = computeAvailabilityFromInputs({
      productId: 'p1',
      unitType: 'piece',
      piecesPerBox: 1,
      currentStockNetPieces: 100,
      displayQtyNative: 0,
      activeReservations: [],
      pendingDeliveryQtyNative: 0,
    });
    expect(r.current_stock_pieces).toBe(100);
    expect(r.available_pieces).toBe(100);
  });

  it('subtracts reserved and allocated separately (source_type discriminates them)', () => {
    const r = computeAvailabilityFromInputs({
      productId: 'p1',
      unitType: 'piece',
      piecesPerBox: 1,
      currentStockNetPieces: 100,
      displayQtyNative: 0,
      activeReservations: [
        { source_type: 'manual', reserved_qty: 20, fulfilled_qty: 0, released_qty: 0 },
        { source_type: 'allocation', reserved_qty: 15, fulfilled_qty: 0, released_qty: 0 },
      ],
      pendingDeliveryQtyNative: 0,
    });
    expect(r.reserved_pieces).toBe(20);
    expect(r.allocated_pieces).toBe(15);
    expect(r.available_pieces).toBe(65);
  });

  it('only counts the REMAINING qty on a reservation (reserved - fulfilled - released)', () => {
    const r = computeAvailabilityFromInputs({
      productId: 'p1',
      unitType: 'piece',
      piecesPerBox: 1,
      currentStockNetPieces: 100,
      displayQtyNative: 0,
      activeReservations: [
        { source_type: 'manual', reserved_qty: 20, fulfilled_qty: 5, released_qty: 5 },
      ],
      pendingDeliveryQtyNative: 0,
    });
    expect(r.reserved_pieces).toBe(10);
    expect(r.available_pieces).toBe(90);
  });

  it('display stock does NOT double-subtract from current stock (it is already net of display)', () => {
    // stock.total_pieces (currentStockNetPieces) is already net of display —
    // this is the regression this test guards: naively subtracting display
    // stock a second time would under-count availability.
    const r = computeAvailabilityFromInputs({
      productId: 'p1',
      unitType: 'piece',
      piecesPerBox: 1,
      currentStockNetPieces: 80, // 100 total, 20 already moved to display
      displayQtyNative: 20,
      activeReservations: [],
      pendingDeliveryQtyNative: 0,
    });
    expect(r.current_stock_pieces).toBe(100); // gross figure shown for transparency
    expect(r.display_stock_pieces).toBe(20);
    expect(r.available_pieces).toBe(80); // NOT 60 — display isn't subtracted twice
  });

  it('subtracts pending delivery', () => {
    const r = computeAvailabilityFromInputs({
      productId: 'p1',
      unitType: 'piece',
      piecesPerBox: 1,
      currentStockNetPieces: 100,
      displayQtyNative: 0,
      activeReservations: [],
      pendingDeliveryQtyNative: 30,
    });
    expect(r.pending_delivery_pieces).toBe(30);
    expect(r.available_pieces).toBe(70);
  });

  it('incoming purchase defaults to 0 and is added on top for the "including incoming" figure', () => {
    const r = computeAvailabilityFromInputs({
      productId: 'p1',
      unitType: 'piece',
      piecesPerBox: 1,
      currentStockNetPieces: 100,
      displayQtyNative: 0,
      activeReservations: [],
      pendingDeliveryQtyNative: 0,
    });
    expect(r.incoming_purchase_pieces).toBe(0);
    expect(r.available_including_incoming_pieces).toBe(r.available_pieces);
  });

  it('converts box_sft quantities to pieces using pieces_per_box', () => {
    const r = computeAvailabilityFromInputs({
      productId: 'p1',
      unitType: 'box_sft',
      piecesPerBox: 10,
      currentStockNetPieces: 100, // 10 boxes worth, already in pieces
      displayQtyNative: 2, // 2 boxes on display
      activeReservations: [
        { source_type: 'manual', reserved_qty: 3, fulfilled_qty: 0, released_qty: 0 }, // 3 boxes
      ],
      pendingDeliveryQtyNative: 1, // 1 box pending delivery
    });
    expect(r.display_stock_pieces).toBe(20);
    expect(r.reserved_pieces).toBe(30);
    expect(r.pending_delivery_pieces).toBe(10);
    expect(r.available_pieces).toBe(60); // 100 - 30 - 0 - 10
  });

  it('never returns a negative available figure even if oversold', () => {
    const r = computeAvailabilityFromInputs({
      productId: 'p1',
      unitType: 'piece',
      piecesPerBox: 1,
      currentStockNetPieces: 10,
      displayQtyNative: 0,
      activeReservations: [
        { source_type: 'manual', reserved_qty: 50, fulfilled_qty: 0, released_qty: 0 },
      ],
      pendingDeliveryQtyNative: 0,
    });
    expect(r.available_pieces).toBe(0);
  });
});

describe('computeBatchAvailabilityFromInputs (Shade/Lot/Batch/Caliber availability)', () => {
  it('computes available as total - reserved - allocated for a piece-unit batch', () => {
    const r = computeBatchAvailabilityFromInputs(
      {
        id: 'b1',
        batch_no: 'B-001',
        shade_code: 'S1',
        caliber: 'C1',
        lot_no: 'L1',
        total_pieces: 100,
        reserved_box_qty: 0,
        reserved_piece_qty: 20,
      },
      'piece',
      1,
      10, // allocated
    );
    expect(r.reserved_pieces).toBe(20);
    expect(r.allocated_pieces).toBe(10);
    expect(r.available_pieces).toBe(70);
  });

  it('converts reserved_box_qty to pieces for a box_sft-unit batch', () => {
    const r = computeBatchAvailabilityFromInputs(
      {
        id: 'b1',
        batch_no: 'B-001',
        shade_code: null,
        caliber: null,
        lot_no: null,
        total_pieces: 100,
        reserved_box_qty: 3,
        reserved_piece_qty: 0,
      },
      'box_sft',
      10,
      0,
    );
    expect(r.reserved_pieces).toBe(30);
    expect(r.available_pieces).toBe(70);
  });

  it('never returns a negative available figure', () => {
    const r = computeBatchAvailabilityFromInputs(
      {
        id: 'b1',
        batch_no: 'B-001',
        shade_code: null,
        caliber: null,
        lot_no: null,
        total_pieces: 10,
        reserved_box_qty: 0,
        reserved_piece_qty: 15,
      },
      'piece',
      1,
      0,
    );
    expect(r.available_pieces).toBe(0);
  });
});
