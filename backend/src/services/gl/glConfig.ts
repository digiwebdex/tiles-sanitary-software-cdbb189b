import { env } from '../../config/env';

/**
 * True unless USE_GL_SPINE is explicitly set to a falsy value (false|0).
 * Default ON as of V2 Sprint 6A, once the mapper bugs found during Phase 6
 * review were fixed (docs/ACCOUNTING_V2_ARCHITECTURE.md §1.0) — the env var
 * remains as an emergency kill-switch only.
 */
export function isGlSpineEnabled(): boolean {
  const v = (env.USE_GL_SPINE ?? '').toLowerCase();
  if (v === 'false' || v === '0') return false;
  return true;
}
