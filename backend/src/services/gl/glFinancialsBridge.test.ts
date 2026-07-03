import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => vi.fn());
vi.mock('../../db/connection', () => ({ db: mockDb }));

vi.mock('./glConfig', () => ({
  isGlSpineEnabled: vi.fn(() => true),
}));

import { isGlSpineEnabled } from './glConfig';
import { dealerHasGlJournals, shouldUseGlTrialBalance } from './glFinancialsBridge';

describe('glFinancialsBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ id: 'je1' }),
    });
  });

  it('uses GL when source=gl', async () => {
    const use = await shouldUseGlTrialBalance('d1', 'gl');
    expect(use).toBe(true);
  });

  it('skips GL when source=legacy', async () => {
    const use = await shouldUseGlTrialBalance('d1', 'legacy');
    expect(use).toBe(false);
  });

  it('auto mode requires spine enabled and journal rows', async () => {
    const use = await shouldUseGlTrialBalance('d1', 'auto');
    expect(use).toBe(true);
    expect(dealerHasGlJournals).toBeDefined();
  });

  it('auto mode is false when spine disabled', async () => {
    vi.mocked(isGlSpineEnabled).mockReturnValueOnce(false);
    const use = await shouldUseGlTrialBalance('d1', 'auto');
    expect(use).toBe(false);
  });
});
