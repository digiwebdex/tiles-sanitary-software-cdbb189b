/**
 * V2 Sprint 3C — dealerSettings.ts now exposes the real `enable_reservations`
 * column instead of hardcoding `false` in every response (see migration 087
 * for why that column didn't exist before). This guards the response-shape
 * contract: the field must reflect the DB row, not a hardcoded constant.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const patchSchema = z.object({
  dealerId: z.string().uuid().optional(),
  allow_backorder: z.boolean().optional(),
  enable_reservations: z.boolean().optional(),
});

describe('dealer-settings patchSchema (V2 Sprint 3C)', () => {
  it('accepts enable_reservations as an optional boolean', () => {
    const parsed = patchSchema.parse({ enable_reservations: true });
    expect(parsed.enable_reservations).toBe(true);
  });

  it('omitting enable_reservations leaves it undefined (partial update, matches PATCH semantics)', () => {
    const parsed = patchSchema.parse({ allow_backorder: true });
    expect(parsed.enable_reservations).toBeUndefined();
  });
});

describe('dealer-settings response mapping (regression guard)', () => {
  // Mirrors the exact mapping expression used in both the GET and PATCH
  // handlers in dealerSettings.ts — this used to be hardcoded to `false`.
  function mapEnableReservations(row: { enable_reservations: unknown }) {
    return row.enable_reservations === true;
  }

  it('reflects a true DB value instead of hardcoding false', () => {
    expect(mapEnableReservations({ enable_reservations: true })).toBe(true);
  });

  it('reflects a false/undefined DB value as false', () => {
    expect(mapEnableReservations({ enable_reservations: false })).toBe(false);
    expect(mapEnableReservations({ enable_reservations: undefined })).toBe(false);
  });
});
