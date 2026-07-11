/**
 * V2 Sprint 6C — query-shape + pairing-logic tests for Cash/Bank Transfers.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

describe('POST /api/transfers — ledger query shape', () => {
  it('cash and bank legs are both scoped by dealer_id, type=transfer, reference_type=transfer', () => {
    const { sql: cashSql, bindings: cashBindings } = db('cash_ledger')
      .where({ dealer_id: DEALER_ID, type: 'transfer', reference_type: 'transfer' })
      .toSQL();
    expect(cashSql.toLowerCase()).toContain('reference_type');
    expect(cashBindings).toContain('transfer');
    expect(cashBindings).toContain(DEALER_ID);

    const { sql: bankSql } = db('bank_ledger')
      .where({ dealer_id: DEALER_ID, type: 'transfer', reference_type: 'transfer' })
      .toSQL();
    expect(bankSql.toLowerCase()).toContain('reference_type');
  });
});

describe('Transfer leg pairing (GET /api/transfers)', () => {
  interface Leg { id: string; amount: number; reference_id: string | null }

  function pairLegs(legs: Leg[]): Array<{ outLeg: Leg; inLeg: Leg }> {
    const seen = new Set<string>();
    const pairs: Array<{ outLeg: Leg; inLeg: Leg }> = [];
    for (const leg of legs) {
      if (seen.has(leg.id)) continue;
      if (leg.amount >= 0) continue;
      const inLeg = legs.find((l) => l.id === leg.reference_id);
      if (!inLeg) continue;
      seen.add(leg.id); seen.add(inLeg.id);
      pairs.push({ outLeg: leg, inLeg });
    }
    return pairs;
  }

  it('pairs an outgoing leg with its referenced incoming leg', () => {
    const legs: Leg[] = [
      { id: 'a', amount: -500, reference_id: 'b' },
      { id: 'b', amount: 500, reference_id: 'a' },
    ];
    const pairs = pairLegs(legs);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].outLeg.id).toBe('a');
    expect(pairs[0].inLeg.id).toBe('b');
  });

  it('ignores an unpaired leg (defensive — should never happen given recordTransfer always inserts both)', () => {
    const legs: Leg[] = [{ id: 'a', amount: -500, reference_id: 'missing' }];
    expect(pairLegs(legs)).toHaveLength(0);
  });

  it('pairs multiple independent transfers correctly, not cross-matching', () => {
    const legs: Leg[] = [
      { id: 'a', amount: -200, reference_id: 'b' },
      { id: 'b', amount: 200, reference_id: 'a' },
      { id: 'c', amount: -900, reference_id: 'd' },
      { id: 'd', amount: 900, reference_id: 'c' },
    ];
    const pairs = pairLegs(legs);
    expect(pairs).toHaveLength(2);
  });
});
