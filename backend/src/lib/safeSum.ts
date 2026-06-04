/**
 * safeSum — the structural fix that prevents the next silent-zero bug
 * (Track 1 Phase 1).
 *
 * Wraps a single SQL aggregation in a try/catch that:
 *   1. Returns the resolved number on success.
 *   2. On failure, returns 0 but ALSO:
 *        • emits a structured stderr log line via logRouteError, and
 *        • appends a human-readable warning string into the supplied
 *          `warnings` array so the API response can surface it.
 *
 * This replaces every prior `.catch(() => null)` and
 * `catch { /* ignore *​/ }` in financials.ts. The behaviour change is:
 *
 *   BEFORE:  silent zero → P&L showed inflated profit, no operator signal.
 *   AFTER :  visible zero + log line + user-facing warning entry.
 *
 * The helper is intentionally tiny and dependency-free so it can be unit
 * tested without spinning up a Postgres test DB.
 */

import { logRouteError } from './logger';

export interface SafeSumOptions {
  /** Dotted route path, e.g. "financials.pnl.cogs". */
  route: string;
  /** Human label included in the warning string, e.g. "COGS". */
  label: string;
  /** Mutable warnings array — caller passes it in and reads it back. */
  warnings: string[];
  /** Extra context for structured logs (dealerId, date range, etc.). */
  context?: Record<string, unknown>;
}

/**
 * Run `fn` and coerce its result to a finite number. On error: log, warn,
 * and return 0. NEVER throws.
 */
export async function safeSum(
  opts: SafeSumOptions,
  fn: () => Promise<number | null | undefined>,
): Promise<number> {
  try {
    const raw = await fn();
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    logRouteError(opts.route, err, opts.context);
    const msg = err instanceof Error ? err.message : String(err);
    opts.warnings.push(`${opts.label} computation failed: ${msg}`);
    return 0;
  }
}

/**
 * Same shape as safeSum but for queries that return an array (e.g., GROUP BY).
 * On failure, returns the supplied fallback (typically []).
 */
export async function safeQuery<T>(
  opts: SafeSumOptions,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logRouteError(opts.route, err, opts.context);
    const msg = err instanceof Error ? err.message : String(err);
    opts.warnings.push(`${opts.label} query failed: ${msg}`);
    return fallback;
  }
}
