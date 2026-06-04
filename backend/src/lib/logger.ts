/**
 * Backend structured logger.
 *
 * Pure stderr output for now (no external transport). Each line is a single
 * JSON object so log aggregators (or simple `grep | jq`) can parse them.
 *
 * Designed to REPLACE the silent `.catch(() => null)` and
 * `catch { /* ignore *​/ }` patterns that previously hid critical bugs in
 * financial reporting endpoints (Track 1 Phase 1).
 *
 * Usage:
 *   import { logRouteError } from '../lib/logger';
 *   try { ... } catch (err) {
 *     logRouteError('financials.pnl.cogs', err, { dealerId, from, to });
 *     // continue with degraded result + user-visible warning
 *   }
 */

export interface RouteErrorContext {
  [key: string]: unknown;
}

function safeMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || 'unknown error';
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unserializable error';
  }
}

function safeStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return err.stack;
  return undefined;
}

/**
 * Log a structured, single-line JSON record for a route-level error.
 * The `route` arg is a free-form dotted path (e.g. "financials.pnl.cogs").
 * Context fields are stringified but never thrown — logging must never crash
 * the response.
 */
export function logRouteError(
  route: string,
  err: unknown,
  context: RouteErrorContext = {},
): void {
  try {
    const record = {
      level: 'error',
      ts: new Date().toISOString(),
      route,
      message: safeMessage(err),
      stack: safeStack(err),
      ...context,
    };
    // Single line, JSON. stderr so it doesn't mix with response bodies.
    process.stderr.write(JSON.stringify(record) + '\n');
  } catch {
    // Defensive: never let logging crash the caller.
  }
}

/**
 * Convenience for warnings that should be surfaced to ops but do not represent
 * a thrown error (e.g., "12 sales have NULL cogs and were excluded").
 */
export function logRouteWarn(
  route: string,
  message: string,
  context: RouteErrorContext = {},
): void {
  try {
    const record = {
      level: 'warn',
      ts: new Date().toISOString(),
      route,
      message,
      ...context,
    };
    process.stderr.write(JSON.stringify(record) + '\n');
  } catch {
    /* never throw from logger */
  }
}
