/**
 * Minimal in-memory Knex transaction mock for service unit tests.
 */
import type { Knex } from 'knex';

type Row = Record<string, unknown>;

export function createMockTrx(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const ledger: Row[] = [];

  const fn = { now: () => new Date().toISOString() };

  function table(name: string) {
    if (!tables[name]) tables[name] = [];

    const state = {
      table: name,
      filters: [] as Array<[string, unknown]>,
      orderCol: null as string | null,
      locked: false,
      countMode: false,
    };

    const api: any = {
      where(cond: Record<string, unknown>) {
        Object.entries(cond).forEach(([k, v]) => state.filters.push([k, v]));
        return api;
      },
      forUpdate() {
        state.locked = true;
        return api;
      },
      orderBy(col: string) {
        state.orderCol = col;
        return api;
      },
      select(..._cols: string[]) {
        return api;
      },
      first(..._cols: string[]) {
        const row = matchOne();
        return Promise.resolve(row ?? undefined);
      },
      update(data: Record<string, unknown>) {
        const row = matchOne();
        if (!row) return Promise.resolve(0);
        Object.assign(row, data);
        return Promise.resolve(1);
      },
      insert(data: Row | Row[]) {
        const rows = Array.isArray(data) ? data : [data];
        if (state.table === 'stock_ledger') {
          ledger.push(...rows);
          return {
            returning: () => Promise.resolve(rows),
            then: (resolve: (v: Row[]) => void) => resolve(rows),
          };
        }
        const inserted = rows.map((r, i) => ({
          id: `${state.table}-${tables[state.table].length + i + 1}`,
          box_qty: 0,
          piece_qty: 0,
          sft_qty: 0,
          total_pieces: 0,
          ...r,
        }));
        tables[state.table].push(...inserted);
        return {
          returning: () => Promise.resolve(inserted),
          then: (resolve: (v: Row[]) => void) => resolve(inserted),
        };
      },
      then(resolve: (v: Row | Row[]) => void, reject?: (e: unknown) => void) {
        try {
          const rows = matchAll();
          // Terminal await on a filtered batch list returns all matches
          resolve(rows.length === 1 && state.table !== 'product_batches' ? rows[0] : rows);
        } catch (e) {
          reject?.(e);
        }
      },
    };

    function matchOne(): Row | null {
      const rows = matchAll();
      return rows[0] ?? null;
    }

    function matchAll(): Row[] {
      let rows = [...tables[state.table]];
      for (const [k, v] of state.filters) {
        rows = rows.filter((r) => r[k] === v);
      }
      if (state.orderCol) {
        rows.sort((a, b) =>
          String(a[state.orderCol!]).localeCompare(String(b[state.orderCol!])),
        );
      }
      return rows;
    }

    return api;
  }

  const trx = ((name: string) => table(name)) as unknown as Knex.Transaction;
  (trx as any).fn = fn;

  return {
    trx,
    tables,
    ledger,
  };
}
