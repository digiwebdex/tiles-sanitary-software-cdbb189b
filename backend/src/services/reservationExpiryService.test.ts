import { describe, expect, it, vi, beforeEach } from 'vitest';

const { whereMock, selectMock, rawMock } = vi.hoisted(() => ({
  whereMock: vi.fn(),
  selectMock: vi.fn(),
  rawMock: vi.fn(),
}));

vi.mock('../db/connection', () => {
  const db: any = (_table: string) => ({
    where: whereMock,
  });
  db.raw = rawMock;
  return { db };
});

import { runReservationExpirySweep } from './reservationExpiryService';

describe('runReservationExpirySweep (V2 Sprint 3C "Reservation Expiry" cron)', () => {
  beforeEach(() => {
    whereMock.mockReset();
    selectMock.mockReset();
    rawMock.mockReset();
    whereMock.mockReturnValue({ select: selectMock });
  });

  it('sweeps every dealer with enable_reservations=true and sums the expired counts', async () => {
    selectMock.mockResolvedValueOnce([{ id: 'dealer-1' }, { id: 'dealer-2' }]);
    rawMock.mockResolvedValueOnce({ rows: [{ n: 3 }] }).mockResolvedValueOnce({ rows: [{ n: 5 }] });

    const result = await runReservationExpirySweep();

    expect(whereMock).toHaveBeenCalledWith({ enable_reservations: true });
    expect(rawMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ dealersSwept: 2, totalExpired: 8 });
  });

  it('returns zero counts when no dealer has reservations enabled', async () => {
    selectMock.mockResolvedValueOnce([]);
    const result = await runReservationExpirySweep();
    expect(rawMock).not.toHaveBeenCalled();
    expect(result).toEqual({ dealersSwept: 0, totalExpired: 0 });
  });
});
