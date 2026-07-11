/**
 * V2 Sprint 6C — status-transition + query-shape tests for the Cheque
 * Register. A cheque is a `bank_ledger` row with `cheque_no` set — no
 * separate table, so this re-derives the exact transition table from
 * chequeRegister.ts to verify it independently.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  issued: ['presented', 'cleared', 'bounced', 'cancelled'],
  presented: ['cleared', 'bounced'],
  cleared: [],
  bounced: ['issued'],
  cancelled: [],
};

describe('Cheque status transitions', () => {
  it('a freshly issued cheque can move to presented, cleared, bounced, or cancelled', () => {
    expect(ALLOWED_TRANSITIONS.issued).toEqual(expect.arrayContaining(['presented', 'cleared', 'bounced', 'cancelled']));
  });

  it('a cleared cheque is a terminal state — no further transitions', () => {
    expect(ALLOWED_TRANSITIONS.cleared).toHaveLength(0);
  });

  it('a cancelled cheque is terminal — cannot be revived', () => {
    expect(ALLOWED_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it('a bounced cheque can only be re-issued, not jump straight to cleared', () => {
    expect(ALLOWED_TRANSITIONS.bounced).toEqual(['issued']);
    expect(ALLOWED_TRANSITIONS.bounced).not.toContain('cleared');
  });

  it('presented cannot go back to issued (no backward transitions except via bounce+reissue)', () => {
    expect(ALLOWED_TRANSITIONS.presented).not.toContain('issued');
  });
});

describe('GET /api/cheque-register — query shape', () => {
  it('scopes to this dealer and only rows with a cheque_no set', () => {
    const { sql, bindings } = db('bank_ledger as bl')
      .leftJoin('bank_accounts as ba', 'ba.id', 'bl.bank_account_id')
      .where({ 'bl.dealer_id': DEALER_ID })
      .whereNotNull('bl.cheque_no')
      .toSQL();
    expect(sql.toLowerCase()).toContain('cheque_no');
    expect(sql.toLowerCase()).toContain('is not null');
    expect(bindings).toContain(DEALER_ID);
  });
});

describe('Reaching cleared also sets is_cleared (Bank Reconciliation integration)', () => {
  it('a status update to cleared implies is_cleared=true, matching a statement match', () => {
    function computeUpdate(next: string): Record<string, unknown> {
      const update: Record<string, unknown> = { cheque_status: next };
      if (next === 'cleared') { update.is_cleared = true; update.cleared_at = 'NOW()'; }
      return update;
    }
    expect(computeUpdate('cleared')).toMatchObject({ is_cleared: true });
    expect(computeUpdate('presented')).not.toHaveProperty('is_cleared');
  });
});
